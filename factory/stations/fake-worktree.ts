/** A fake attempt's worktree, for the tests only: a check asks it, and it touches nothing. */

import type { TestRun, Worktree } from "../line/step.ts";
import type { Listed, Result } from "../runs/listed.ts";

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
 * A worktree whose test run gives `test`, whose listed tests exit with `codes[name]` (0 when unnamed; a name in
 * `unbuilt` does not build), whose changed files are `changed`, and which holds `files`. It counts its test runs and
 * keeps what `changed` and `listed` were asked.
 */
export function fakeWorktree(
  o: {
    test?: TestRun;
    codes?: Record<string, number>;
    unbuilt?: string[];
    changed?: string[];
    files?: string[];
    touched?: string[];
  } = {},
): Worktree & { runs: number; asked: string[][]; listedAsked: Listed[][] } {
  const at = {
    runs: 0,
    asked: [] as string[][],
    listedAsked: [] as Listed[][],
    listed: async (tests: Listed[]): Promise<Result[]> => {
      at.listedAsked.push(tests);
      return tests.map((t) => {
        const listed = !(o.unbuilt ?? []).includes(t.name);
        const code = listed ? (o.codes?.[t.name] ?? 0) : 1;
        return { test: t, listed, code, out: `${t.name}: exit ${code}` };
      });
    },
    test: async () => {
      at.runs++;
      return o.test ?? ran(0, "ok");
    },
    changed: async (files: string[]) => {
      at.asked.push(files);
      return (o.changed ?? []).filter((f) => files.includes(f));
    },
    touched: async () => o.touched ?? o.changed ?? [],
    exists: (files: string[]) =>
      files.filter((f) => (o.files ?? []).includes(f)),
  };
  return at;
}
