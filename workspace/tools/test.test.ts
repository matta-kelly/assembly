import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Run } from "../../factory/line/step.ts";
import { type Context, keep } from "../../factory/runs/runs.ts";
import { runListed } from "../../factory/runs/listed.ts";
import { test } from "./test.ts";

vi.mock("../../factory/runs/listed.ts", () => ({
  runListed: vi.fn(),
  runnable: "*.test.ts",
}));

const run = { name: "is-b", n: 2, test: "scripts/check.sh all" } as Run;
const context: Context = {
  item: "is-b",
  agent: "da-nail",
  folder: join(mkdtempSync(join(tmpdir(), "test-tool-")), "cl", "b"),
  readOnly: false,
};
// the conversation's attempt going on, as the runner writes it before the run
keep(context, run);

const a = { file: "a.test.ts", name: "a" };
const b = { file: "b.test.ts", name: "b" };

/** Calls `test` as que-pasa does, on `tests`, with each run giving back the result `results` names. */
async function called(
  tests: { file: string; name: string }[],
  results: { listed: boolean; code: number; out: string }[],
) {
  vi.mocked(runListed).mockResolvedValue({
    results: tests.map((t, i) => ({
      test: { ...t, kind: "kept" as const },
      ...(results[i] as { listed: boolean; code: number; out: string }),
    })),
    check: undefined,
  });
  return (test.run as (i: unknown, r: unknown) => Promise<string>)(
    test.schema.parse({ tests }),
    { context, use: vi.fn() },
  );
}

describe("test", () => {
  it("runs the tests it is given on the conversation's attempt going on, and answers each one's exit code", async () => {
    const answer = await called(
      [a, b],
      [
        { listed: true, code: 0, out: "ok" },
        { listed: true, code: 1, out: "expected 2, got 1" },
      ],
    );
    expect(runListed).toHaveBeenCalledWith(run, [
      { ...a, kind: "kept" },
      { ...b, kind: "kept" },
    ]);
    expect(answer).toMatch(/exit 0: a \(a.test.ts\)/);
    expect(answer).toMatch(/exit 1: b \(b.test.ts\)/);
    expect(answer).toMatch(/== b \(b.test.ts\)\nexpected 2, got 1/);
    expect(answer).toMatch(/\[Command failed with exit code 1\]$/);
  });

  it("says when a test does not build or is not found", async () => {
    const answer = await called(
      [a],
      [{ listed: false, code: 1, out: "undefined: a" }],
    );
    expect(answer).toMatch(/does not build or is not found: a \(a.test.ts\)/);
  });

  it("answers 0 when every test passes", async () => {
    const answer = await called([a], [{ listed: true, code: 0, out: "ok" }]);
    expect(answer).not.toMatch(/failed/);
  });
});
