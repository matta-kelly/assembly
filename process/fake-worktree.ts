/** A fake attempt's worktree, for the tests only: a check asks it, and it touches nothing. */

import type { TestRun, Worktree } from "./step.ts";

/** A test run, as the worktree gives it back. */
export const ran = (code: number, out: string): TestRun => ({
  code,
  out,
  check: {
    command: "t",
    image: "img",
    tree: "4b825dc",
    input: "abc",
    code,
    at: 0,
    ms: 5,
  },
});

/**
 * A worktree whose test run gives `test`, whose red run gives `red` (else `test`), whose changed files are `changed`,
 * and which holds `files`. It counts its test runs, and keeps what `changed` and `red` were asked.
 */
export function fakeWorktree(
  o: {
    test?: TestRun;
    red?: TestRun;
    changed?: string[];
    files?: string[];
    touched?: string[];
  } = {},
): Worktree & { runs: number; asked: string[][]; reds: string[][] } {
  const at = {
    runs: 0,
    asked: [] as string[][],
    reds: [] as string[][],
    test: async () => {
      at.runs++;
      return o.test ?? ran(0, "ok");
    },
    changed: async (files: string[]) => {
      at.asked.push(files);
      return (o.changed ?? []).filter((f) => files.includes(f));
    },
    touched: async () => o.touched ?? o.changed ?? [],
    red: async (files: string[]) => {
      at.reds.push(files);
      return o.red ?? o.test ?? ran(0, "ok");
    },
    exists: (files: string[]) =>
      files.filter((f) => (o.files ?? []).includes(f)),
  };
  return at;
}
