import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Run } from "../../process/step.ts";
import { type Context, keep } from "../../effects/runs.ts";
import { maxAnswer } from "@mku1tra/que-pasa/sandbox";
import { runTests } from "../../effects/tests.ts";
import { test } from "./test.ts";

vi.mock("../../effects/tests.ts", () => ({ runTests: vi.fn() }));

const run = { name: "is-b", n: 2, test: "node --test test/b.test.ts" } as Run;
const context: Context = {
  item: "is-b",
  agent: "da-nail",
  folder: join(mkdtempSync(join(tmpdir(), "test-tool-")), "cl", "b"),
  readOnly: false,
};
// the conversation's attempt going on, as the runner writes it before the run
keep(context, run);

/** Calls `test` as que-pasa does, with runTests giving back `out` and `code`. */
async function called(out: string, code: number | null) {
  vi.mocked(runTests).mockResolvedValue({
    out,
    code: code as number,
    check: {} as never,
  });
  return (test.run as (i: unknown, r: unknown) => Promise<string>)(
    test.schema.parse({}),
    { context, use: vi.fn() },
  );
}

describe("test", () => {
  it("runs the tests of the conversation's attempt going on through runTests, and gives back its output and exit code", async () => {
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
