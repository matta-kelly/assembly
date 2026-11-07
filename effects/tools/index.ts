/**
 * The inner loop's tools: the file and command tools of LangChain's Deep Agents (ls, read_file, write_file, edit_file,
 * execute), as que-pasa tools. Each one execs into its attempt's sandbox, which it reads from the run's context, so
 * the sandbox's mounts are the wall: a tool reaches only /work. A path is passed as an argument and a file's content
 * over stdin, so neither is read by the shell. Each call is a line in the attempt's log.
 *
 * A call a crash cut off runs again when its run is taken up only if running it twice is the same as once: ls,
 * read_file and write_file. edit_file (a second replace finds nothing, or replaces twice) and execute (any command)
 * do not: the model gets que-pasa's `interrupted` result, and decides.
 */

import { defineTool, type Runtime } from "que-pasa/define";
import { z } from "zod";
import type { Run } from "../../process/step.ts";
import { log } from "../runs.ts";
import { exec } from "../sandbox.ts";
import type { Ran } from "../sh.ts";

/** What a run of the inner loop gives its tools: the attempt. JSON, so que-pasa keeps it with the run. */
export type Context = {
  run: Run;
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

const path = z
  .string()
  .describe("a path in the worktree, from /work, or relative to it");

export const ls = defineTool({
  name: "ls",
  // it only reads
  replay: "safe",
  description: "List a folder of the worktree.",
  schema: z.object({ path: path.default(".") }),
  run: async (input, runtime: Runtime<Context>) =>
    shown(
      await sandboxed(runtime, "ls", input, 'ls -la -- "$1"', [input.path]),
    ),
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
  run: async (input, runtime: Runtime<Context>) =>
    shown(
      await sandboxed(
        runtime,
        "read_file",
        input,
        'test -f "$1" || { echo "no such file: $1"; exit 1; }; awk -v o="$2" -v l="$3" \'NR>o && NR<=o+l { printf "%6d\\t%s\\n", NR, $0 }\' "$1"',
        [input.path, String(input.offset), String(input.limit)],
      ),
    ),
});

export const write_file = defineTool({
  name: "write_file",
  // it writes the whole file, so a second run leaves the same file
  replay: "safe",
  description:
    "Write a file of the worktree, whole, making its folder if it has none. It replaces what was there.",
  schema: z.object({ path, content: z.string() }),
  run: async (input, runtime: Runtime<Context>) =>
    shown(
      await sandboxed(
        runtime,
        "write_file",
        { path: input.path },
        'mkdir -p -- "$(dirname -- "$1")" && cat > "$1"',
        [input.path],
        input.content,
      ),
    ) || `wrote ${input.path}`,
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
    const { run } = runtime.context;
    const read = await exec(run, 'cat -- "$1"', [input.path]);
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
      [input.path],
      text,
    );
    return shown(r) || `replaced ${input.all ? count : 1} in ${input.path}`;
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
