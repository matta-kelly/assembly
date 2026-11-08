/**
 * The inner loop's tools: the file and command tools of LangChain's Deep Agents (ls, read_file, write_file, edit_file,
 * glob, grep, execute), and test, as que-pasa tools. Each one execs into its attempt's sandbox, which it reads from the
 * run's context, so the sandbox's mounts are the wall: a tool reaches only /work. A path is passed as an argument and
 * a file's content over stdin, so neither is read by the shell. Each call is a line in the attempt's log.
 *
 * A bound step's run has a view in its context (view.ts): its cut's files. Its file tools reach only those, and to them
 * nothing else exists: a path outside the view gets the answer a missing path gets. Its writes reach only the change
 * files, and the path a tool checks is the path it hands the sandbox. It gets no execute, since a shell reaches any
 * path (Deep Agents: a virtual root "provides no security with shell access"); test runs its cl's tests instead. Code
 * its tests run can still write anywhere in /work, so the loop fails an attempt whose worktree changed a file outside
 * the change files, and commits only those. A run with no view (the planner, the reviews) sees the worktree.
 *
 * A call a crash cut off runs again when its run is taken up only if running it twice is the same as once: ls,
 * read_file, write_file, glob and grep. edit_file (a second replace finds nothing, or replaces twice), execute (any
 * command) and test (a test run may write) do not: the model gets que-pasa's `interrupted` result, and decides.
 */

import { posix } from "node:path";
import { defineTool, type Runtime } from "@mku1tra/que-pasa/define";
import { z } from "zod";
import type { Run, View } from "../../process/step.ts";
import { log } from "../runs.ts";
import { exec } from "../sandbox.ts";
import type { Ran } from "../sh.ts";
import { files, fromRoot, sees, under, writes } from "./view.ts";

/** What a run of the inner loop gives its tools: the attempt. JSON, so que-pasa keeps it with the run. */
export type Context = {
  run: Run;
  view?: View; // a bound step's: its cut's files. None: the whole worktree
};

/** The most of a command's output a tool gives back: its tail, where a failure is. */
const limit = 20_000;

const shown = (r: Pick<Ran, "code" | "out">) => {
  const out =
    r.out.length > limit
      ? `[first ${r.out.length - limit} characters cut]\n${r.out.slice(-limit)}`
      : r.out;
  return r.code === 0 ? out : `exit ${r.code}\n${out}`;
};

async function sandboxed(
  runtime: Runtime<Context>,
  tool: string,
  input: unknown,
  script: string,
  args: string[],
  stdin?: string,
) {
  const { run } = runtime.context;
  const r = await exec(run, script, args, stdin);
  log(run, `${tool} ${JSON.stringify(input).slice(0, 300)} -> exit ${r.code}`);
  return r;
}

/** A tool call its view answers without the sandbox: logged like the rest. */
function answered(
  runtime: Runtime<Context>,
  tool: string,
  input: unknown,
  answer: string,
) {
  log(
    runtime.context.run,
    `${tool} ${JSON.stringify(input).slice(0, 300)} -> ${answer.split("\n")[0]}`,
  );
  return answer;
}

const path = z
  .string()
  .describe("a path in the worktree, from /work, or relative to it");

/** The path a tool hands the sandbox: with a view, the one the view checked, from the repo's root. */
const at = (runtime: Runtime<Context>, p: string) =>
  runtime.context.view ? fromRoot(p) || "." : p;

/** What ls says for a path that is not there; a path outside the view is not there. */
const noFolder = (p: string) =>
  shown({
    code: 2,
    out: `ls: cannot access '${p}': No such file or directory\n`,
  });
/** What read_file says for a file that is not there. */
const noFile = (p: string) => shown({ code: 1, out: `no such file: ${p}\n` });
/** What a write outside the change files gets: not written, and which files it may write. */
const notChanged = (p: string, v: View) =>
  `${p} is not a file this cl changes: it changes ${v.change.join(", ")}. Nothing was written`;

/** Which of `paths` are there, files or folders; a folder ends in a slash. In the order asked. */
async function present(runtime: Runtime<Context>, paths: string[]) {
  if (!paths.length) return [];
  const r = await exec(
    runtime.context.run,
    'for f; do if [ -d "$f" ]; then echo "$f/"; elif [ -e "$f" ]; then echo "$f"; fi; done',
    paths.map((p) => p.replace(/\/$/, "")),
  );
  return r.stdout.split("\n").filter(Boolean);
}

/**
 * The files under a folder an agent can reach, from the repo's root: the view's that are there, or the worktree's.
 * None for a folder outside the worktree.
 */
async function filesUnder(runtime: Runtime<Context>, folder: string) {
  const { view, run } = runtime.context;
  const root = fromRoot(folder);
  if (root === undefined) return [];
  if (view) {
    const inside = files(view).filter(
      (f) => !root || f === root || f.startsWith(`${root}/`),
    );
    return (await present(runtime, inside)).filter((f) => !f.endsWith("/"));
  }
  const r = await exec(
    run,
    'find "$1" -type f -not -path "*/.git/*" -not -name .git | sed "s|^\\./||"',
    [root || "."],
  );
  return r.stdout.split("\n").filter(Boolean);
}

export const ls = defineTool({
  name: "ls",
  // it only reads
  replay: "safe",
  description: "List a folder of the worktree.",
  schema: z.object({ path: path.default(".") }),
  run: async (input, runtime: Runtime<Context>) => {
    const { view } = runtime.context;
    if (!view)
      return shown(
        await sandboxed(runtime, "ls", input, 'ls -la -- "$1"', [input.path]),
      );
    const there = sees(view, input.path)
      ? await present(runtime, [
          at(runtime, input.path),
          ...under(view, input.path),
        ])
      : [];
    const [self, ...inside] = there;
    if (!self) return answered(runtime, "ls", input, noFolder(input.path));
    // a file lists as itself, as ls does
    if (!self.endsWith("/")) return answered(runtime, "ls", input, self);
    return answered(runtime, "ls", input, inside.join("\n") || "(empty)");
  },
});

export const read_file = defineTool({
  name: "read_file",
  // it only reads
  replay: "safe",
  description:
    "Read a file of the worktree, with line numbers. offset skips lines; limit caps how many are read.",
  schema: z.object({
    path,
    offset: z.number().int().min(0).default(0).describe("lines to skip"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .default(2000)
      .describe("lines to read"),
  }),
  run: async (input, runtime: Runtime<Context>) => {
    const { view } = runtime.context;
    if (view && !sees(view, input.path))
      return answered(runtime, "read_file", input, noFile(input.path));
    return shown(
      await sandboxed(
        runtime,
        "read_file",
        input,
        'test -f "$1" || { echo "no such file: $1"; exit 1; }; awk -v o="$2" -v l="$3" \'NR>o && NR<=o+l { printf "%6d\\t%s\\n", NR, $0 }\' "$1"',
        [at(runtime, input.path), String(input.offset), String(input.limit)],
      ),
    );
  },
});

export const write_file = defineTool({
  name: "write_file",
  // it writes the whole file, so a second run leaves the same file
  replay: "safe",
  description:
    "Write a file of the worktree, whole, making its folder if it has none. It replaces what was there.",
  schema: z.object({ path, content: z.string() }),
  run: async (input, runtime: Runtime<Context>) => {
    const { view } = runtime.context;
    if (view && !writes(view, input.path))
      return answered(
        runtime,
        "write_file",
        { path: input.path },
        notChanged(input.path, view),
      );
    return (
      shown(
        await sandboxed(
          runtime,
          "write_file",
          { path: input.path },
          'mkdir -p -- "$(dirname -- "$1")" && cat > "$1"',
          [at(runtime, input.path)],
          input.content,
        ),
      ) || `wrote ${input.path}`
    );
  },
});

export const edit_file = defineTool({
  name: "edit_file",
  description:
    "Replace text in a file of the worktree. old must occur exactly once, unless all is true, which replaces each one.",
  schema: z.object({
    path,
    old: z.string().min(1),
    new: z.string(),
    all: z.boolean().default(false).describe("replace each one"),
  }),
  run: async (input, runtime: Runtime<Context>) => {
    const { run, view } = runtime.context;
    if (view && !writes(view, input.path))
      return answered(
        runtime,
        "edit_file",
        { path: input.path },
        notChanged(input.path, view),
      );
    const file = at(runtime, input.path);
    const read = await exec(run, 'cat -- "$1"', [file]);
    if (read.code !== 0) return shown(read);
    const count = read.stdout.split(input.old).length - 1;
    if (count === 0) return `old does not occur in ${input.path}`;
    if (count > 1 && !input.all)
      return `old occurs ${count} times in ${input.path}: give more of the text, or set all`;
    const text = input.all
      ? read.stdout.split(input.old).join(input.new)
      : read.stdout.replace(input.old, () => input.new);
    const r = await sandboxed(
      runtime,
      "edit_file",
      { path: input.path, count },
      'cat > "$1"',
      [file],
      text,
    );
    return shown(r) || `replaced ${input.all ? count : 1} in ${input.path}`;
  },
});

export const glob = defineTool({
  name: "glob",
  // it only reads
  replay: "safe",
  description:
    "Find the files of the worktree whose path matches a glob (** for any folders), under a folder. Paths from the repo's root.",
  schema: z.object({
    pattern: z.string().min(1).describe("a glob, such as **/*.test.ts"),
    path: path.default("."),
  }),
  run: async (input, runtime: Runtime<Context>) => {
    const root = fromRoot(input.path) ?? "";
    const pattern = root ? `${root}/${input.pattern}` : input.pattern;
    const found = (await filesUnder(runtime, input.path)).filter((f) =>
      posix.matchesGlob(f, pattern),
    );
    return answered(
      runtime,
      "glob",
      input,
      found.join("\n") || "no files match",
    );
  },
});

export const grep = defineTool({
  name: "grep",
  // it only reads
  replay: "safe",
  description:
    "Find the lines of the worktree's files that hold a text, as is (not a pattern), under a folder: file, line number, line.",
  schema: z.object({
    text: z.string().min(1).describe("the text to find, as is"),
    path: path.default("."),
  }),
  run: async (input, runtime: Runtime<Context>) => {
    const root = fromRoot(input.path);
    if (root === undefined)
      return answered(runtime, "grep", input, "no matches");
    // exit 1 is no match, not a failure
    if (!runtime.context.view)
      return (
        shown(
          await sandboxed(
            runtime,
            "grep",
            input,
            'grep -rn -F --exclude-dir=.git -e "$1" -- "$2"; [ $? -le 1 ]',
            [input.text, root || "."],
          ),
        ) || "no matches"
      );
    const inside = await filesUnder(runtime, input.path);
    if (!inside.length) return answered(runtime, "grep", input, "no matches");
    return (
      shown(
        await sandboxed(
          runtime,
          "grep",
          input,
          't="$1"; shift; grep -n -H -F -e "$t" -- "$@"; [ $? -le 1 ]',
          [input.text, ...inside],
        ),
      ) || "no matches"
    );
  },
});

export const test = defineTool({
  name: "test",
  description:
    "Run this cl's tests: its test command, which the plan set, in the worktree. Gives back the exit code and the output.",
  schema: z.object({}),
  run: async (input, runtime: Runtime<Context>) => {
    const r = await sandboxed(
      runtime,
      "test",
      input,
      runtime.context.run.test,
      [],
    );
    return `exit ${r.code}\n${shown({ code: 0, out: r.out })}`;
  },
});

export const execute = defineTool({
  name: "execute",
  description:
    "Run a shell command in the worktree, with no network, and get its exit code and output. Use it to run tests, grep and find.",
  schema: z.object({ command: z.string().min(1) }),
  run: async (input, runtime: Runtime<Context>) => {
    const r = await sandboxed(runtime, "execute", input, input.command, []);
    return `exit ${r.code}\n${shown({ code: 0, out: r.out })}`;
  },
});
