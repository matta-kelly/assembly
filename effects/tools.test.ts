import { describe, expect, it, vi } from "vitest";
import type { Run } from "../process/step.ts";
import { maxAnswer } from "@mku1tra/que-pasa/sandbox";
import { runTests } from "./tests.ts";
import { test } from "./tools.ts";

vi.mock("./tests.ts", () => ({ runTests: vi.fn() }));

const run = { name: "is-b", test: "node --test test/b.test.ts" } as Run;

/** Calls `test` as que-pasa does, with runTests giving back `out` and `code`. */
async function called(out: string, code: number | null) {
  vi.mocked(runTests).mockResolvedValue({
    out,
    code: code as number,
    check: {} as never,
  });
  return (test.run as (i: unknown, r: unknown) => Promise<string>)(
    test.schema.parse({}),
    { context: { run, readOnly: false }, use: vi.fn() },
  );
}

describe("test", () => {
  it("runs the cl's tests through runTests, the step's own test op, and gives back its output and exit code", async () => {
    const answer = await called("AssertionError\n", 1);
    expect(runTests).toHaveBeenCalledWith(run);
    expect(answer).toBe("AssertionError\n[Command failed with exit code 1]");
  });

  it("says when its run was killed, and keeps only the tail of a long output, as execute does", async () => {
    const answer = await called(`${"x".repeat(maxAnswer)}end`, null);
    expect(answer).toMatch(/end\n\[Command was killed\]/);
    expect(answer).not.toMatch(/^x{80000}/);
  });
});
