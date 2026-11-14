import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Run } from "../../process/step.ts";
import { type Context, keep } from "../../effects/runs.ts";
import { maxAnswer } from "@mku1tra/que-pasa/sandbox";
import { runRed, runTests } from "../../effects/tests.ts";
import { test } from "./test.ts";

vi.mock("../../effects/tests.ts", () => ({
  runTests: vi.fn(),
  runRed: vi.fn(),
}));

const run = {
  name: "is-b",
  n: 2,
  test: "node --test test/b.test.ts",
  tests: ["test/b.test.ts", "test/c.test.ts"],
} as Run;
const folder = join(mkdtempSync(join(tmpdir(), "test-tool-")), "cl", "b");

/** The conversation of `agent` on the cl, its attempt going on written as the runner writes it before the run. */
const contextOf = (agent: string): Context => {
  const c = { item: "is-b", agent, folder, readOnly: false };
  keep(c, run);
  return c;
};

/** Calls `test` as que-pasa does for `agent`, with either run giving back `out` and `code`. */
async function called(out: string, code: number | null, agent = "da-hammer") {
  const t = { out, code: code as number, check: {} as never };
  vi.mocked(runTests).mockResolvedValue(t);
  vi.mocked(runRed).mockResolvedValue(t);
  return (test.run as (i: unknown, r: unknown) => Promise<string>)(
    test.schema.parse({}),
    { context: contextOf(agent), use: vi.fn() },
  );
}

describe("test", () => {
  it("runs da-hammer's tests through runTests, on the worktree, and gives back its output and exit code", async () => {
    const answer = await called("AssertionError\n", 1);
    expect(runTests).toHaveBeenCalledWith(run);
    expect(answer).toBe("AssertionError\n[Command failed with exit code 1]");
  });

  it("runs da-nail's tests as its check does: without the cl's code, its test files and the ones its command names", async () => {
    vi.mocked(runTests).mockClear();
    await called("AssertionError\n", 1, "da-nail");
    expect(runRed).toHaveBeenCalledWith(run, [
      "test/b.test.ts",
      "test/c.test.ts",
    ]);
    expect(runTests).not.toHaveBeenCalled();
  });

  it("says when its run was killed, and keeps only the tail of a long output, as execute does", async () => {
    const answer = await called(`${"x".repeat(maxAnswer)}end`, null);
    expect(answer).toMatch(/end\n\[Command was killed\]/);
    expect(answer).not.toMatch(/^x{80000}/);
  });
});
