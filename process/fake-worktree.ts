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
 * A worktree whose test run gives `test`, whose changed files are `changed`, and which holds `files`. It counts its
 * test runs and keeps what `changed` was asked.
 */
export function fakeWorktree(
  o: { test?: TestRun; changed?: string[]; files?: string[] } = {},
): Worktree & { runs: number; asked: string[][] } {
  const at = {
    runs: 0,
    asked: [] as string[][],
    test: async () => {
      at.runs++;
      return o.test ?? ran(0, "ok");
    },
    changed: async (files: string[]) => {
      at.asked.push(files);
      return (o.changed ?? []).filter((f) => files.includes(f));
    },
    exists: (files: string[]) =>
      files.filter((f) => (o.files ?? []).includes(f)),
  };
  return at;
}
