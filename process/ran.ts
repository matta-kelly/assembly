/** A test run as runTests gives it back, for the steps' tests, which fake runTests. */

import type { CheckRun } from "./step.ts";

export const ran = (code: number, out: string) => ({
  code,
  out,
  stdout: out,
  check: {
    command: "t",
    image: "img",
    tree: "4b825dc",
    input: "abc",
    code,
    at: 0,
    ms: 5,
  } satisfies CheckRun,
});
