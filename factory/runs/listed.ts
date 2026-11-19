/**
 * Listed tests: each test da-nail lists, run alone by its file's runner and judged by its exit code only (Bazel's test
 * contract), never by what it prints. A runner is two commands, chosen by the test file's name:
 * - list: builds the test and shows it is there. A listing that fails, or does not hold the test, is a test that does
 *   not build or does not exist, never a red
 * - run: runs that one test. Its exit code is the verdict
 * A file with no runner is refused, never guessed. A `new` test is one the cl's change makes pass (FAIL_TO_PASS), a
 * `kept` one passes before it and after (PASS_TO_PASS), after SWE-bench.
 */

import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Run, TestRun } from "../line/step.ts";
import { runIn } from "./tests.ts";

/** A test da-nail lists: its file from the repo's root, its name, and whether the change makes it pass. */
export type Listed = { file: string; name: string; kind: "new" | "kept" };

/** One listed test's run: whether its listing held it, and its run's exit code and output. */
export type Result = {
  test: Listed;
  listed: boolean;
  code: number;
  out: string;
};

/** A test file's runner: its listing and run commands, and how a listing shows the test is in it. */
type Runner = { list: string; run: string; holds: (out: string) => boolean };

/** The test files the factory runs, by name. */
export const runnable = "*.test.ts, *_test.go, *.test.sh";

/** A string as one shell word. */
const word = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** A string as a literal in a regular expression, RE2's and JavaScript's alike. */
const literal = (s: string) => s.replace(/[\\.+*?()|[\]{}^$]/g, "\\$&");

const lines = (out: string) => out.split("\n").map((l) => l.trim());

/** The folder of the nearest go.mod above `file`, from the repo's root, in the worktree `work`; "." for the root. */
function moduleOf(work: string, file: string): string | undefined {
  for (let d = dirname(file); ; d = dirname(d)) {
    if (existsSync(join(work, d, "go.mod"))) return d;
    if (d === "." || d === "/") return undefined;
  }
}

/** The runner of a test, or why it has none. */
export function runnerOf(work: string, t: Listed): Runner | string {
  if (t.file.endsWith(".test.sh"))
    return {
      list: `test -f ${word(t.file)}`,
      run: `bash ${word(t.file)}`,
      holds: () => true,
    };
  if (t.file.endsWith(".test.ts")) {
    const only = `${word(t.file)} -t ${word(`${literal(t.name)}$`)}`;
    return {
      list: `npx vitest list ${only}`,
      run: `npx vitest run ${only}`,
      holds: (out) =>
        lines(out).some((l) => l === t.name || l.endsWith(` > ${t.name}`)),
    };
  }
  if (t.file.endsWith("_test.go")) {
    if (t.name.includes("/"))
      return `${t.name}: a Go test is named by its top-level test, never a subtest`;
    const mod = moduleOf(work, t.file);
    if (mod === undefined) return `${t.file}: no go.mod above it`;
    const pkg = `./${relative(mod, dirname(t.file))}`;
    const go = (flag: string) =>
      `cd ${word(mod)} && go test -count=1 ${flag} ${word(`^${literal(t.name)}$`)} ${word(pkg)}`;
    return {
      list: go("-list"),
      run: go("-run"),
      holds: (out) => lines(out).includes(t.name),
    };
  }
  return `${t.file}: the factory runs only ${runnable}`;
}

/** Why each test that has no runner has none. */
export const unrunnable = (r: Pick<Run, "work">, tests: Listed[]): string[] =>
  tests.flatMap((t) => {
    const runner = runnerOf(r.work, t);
    return typeof runner === "string" ? [runner] : [];
  });

/**
 * Lists and runs each test alone, in the order given. A test whose listing fails or does not hold it is not run. The
 * record is the last run, or the last listing when nothing ran. It stops when `signal` aborts.
 */
export async function runListed(
  r: Run,
  tests: Listed[],
  signal?: AbortSignal,
): Promise<{ results: Result[]; check: TestRun["check"] | undefined }> {
  const results: Result[] = [];
  let check: TestRun["check"] | undefined;
  for (const t of tests) {
    const runner = runnerOf(r.work, t);
    if (typeof runner === "string") {
      results.push({ test: t, listed: false, code: 2, out: runner });
      continue;
    }
    const listing = await runIn(r, runner.list, signal);
    check = listing.check;
    if (listing.code !== 0 || !runner.holds(listing.out)) {
      results.push({
        test: t,
        listed: false,
        code: listing.code,
        out: listing.out,
      });
      continue;
    }
    const ran = await runIn(r, runner.run, signal);
    check = ran.check;
    results.push({ test: t, listed: true, code: ran.code, out: ran.out });
  }
  return { results, check };
}
