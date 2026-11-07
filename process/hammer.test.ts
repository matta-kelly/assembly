import { ran } from "./ran.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changed, runTests } from "../orchestrator/start.ts";
import { hammer } from "./hammer.ts";
import type { Run } from "./step.ts";

vi.mock("../orchestrator/start.ts", () => ({
  changed: vi.fn(),
  runTests: vi.fn(),
}));
vi.mock("./nail.ts", () => ({ testFiles: vi.fn(() => files) }));

let files: string[];
const r = { path: "/cl.md" } as Run;
const d = { word: "done" as const, changed: ["src/a.ts"] };

beforeEach(() => {
  vi.resetAllMocks();
  files = ["a.test.ts"];
  vi.mocked(changed).mockResolvedValue([]);
});

describe("the hammer step's check", () => {
  it("retries when the cl's Tests section names no test file", async () => {
    files = [];
    expect(await hammer.check(r, d)).toMatchObject({
      word: "retry",
      reason: /names no test file/,
    });
  });

  it("retries when a test was changed, and does not run the tests", async () => {
    vi.mocked(changed).mockResolvedValue(["a.test.ts"]);
    expect(await hammer.check(r, d)).toMatchObject({
      word: "retry",
      reason: /a test was changed: a.test.ts/,
    });
    expect(runTests).not.toHaveBeenCalled();
  });

  it("retries when the tests are still red", async () => {
    vi.mocked(runTests).mockResolvedValue(ran(1, "AssertionError"));
    expect(await hammer.check(r, d)).toMatchObject({
      word: "retry",
      reason: /red: exit 1/,
    });
  });

  it("passes when no test changed and the tests are green", async () => {
    vi.mocked(runTests).mockResolvedValue(ran(0, "ok"));
    // The verdict carries the test run, for the ledger.
    expect(await hammer.check(r, d)).toEqual({
      word: "pass",
      reason: "green",
      ran: ran(0, "ok").check,
    });
    expect(changed).toHaveBeenCalledWith(r, ["a.test.ts"]);
  });
});
