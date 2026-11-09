import { describe, expect, it, vi } from "vitest";
import type { Run } from "../process/step.ts";
import { maxAnswer } from "@mku1tra/que-pasa/sandbox";
import { Container, test } from "./tools.ts";

const run = { name: "is-b", test: "node --test test/b.test.ts" } as Run;

/** Calls `test` as que-pasa does, on a box whose execute gives back `output` and `exitCode`. */
async function called(output: string, exitCode: number | null) {
  const execute = vi.fn(async () => ({ output, exitCode, truncated: false }));
  const use = vi.fn(async () => ({ execute }));
  const answer = await (
    test.run as (i: unknown, r: unknown) => Promise<string>
  )(test.schema.parse({}), {
    context: { run, readOnly: false },
    use,
  });
  return { answer, execute, use };
}

describe("test", () => {
  it("runs the cl's test command in the attempt's box itself, and gives back its output and exit code", async () => {
    const { answer, execute, use } = await called("AssertionError\n", 1);
    expect(use).toHaveBeenCalledWith(Container);
    expect(execute).toHaveBeenCalledWith("node --test test/b.test.ts");
    expect(answer).toBe("AssertionError\n[Command failed with exit code 1]");
  });

  it("says when its run was killed, and keeps only the tail of a long output, as execute does", async () => {
    const { answer } = await called(`${"x".repeat(maxAnswer)}end`, null);
    expect(answer).toMatch(/end\n\[Command was killed\]/);
    expect(answer).not.toMatch(/^x{80000}/);
  });
});
