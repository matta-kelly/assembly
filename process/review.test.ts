import { ran } from "./ran.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runTests } from "../orchestrator/start.ts";
import { review } from "./review.ts";
import type { Run } from "./step.ts";

vi.mock("../orchestrator/start.ts", () => ({
  runTests: vi.fn(),
  changed: vi.fn(),
}));

const r = {} as Run;
const finding = { what: "b2 is not tested at its edge", where: "a.test.ts:12" };
const done = (decision: "approve" | "tests" | "code", findings = [finding]) =>
  ({ word: "done", decision, findings }) as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(runTests).mockResolvedValue(ran(0, "ok"));
});

describe("the review step's check", () => {
  it("passes an approve with no findings, on green", async () => {
    expect(await review.check(r, done("approve", []))).toEqual({
      word: "pass",
      reason: "approved",
      ran: ran(0, "ok").check,
    });
  });

  it("turns a send-back into its word", async () => {
    expect((await review.check(r, done("tests"))).word).toBe("to-tests");
    expect((await review.check(r, done("code"))).word).toBe("to-code");
  });

  it("retries a decision its findings disagree with", async () => {
    expect(await review.check(r, done("approve"))).toMatchObject({
      word: "retry",
      reason: /approve with findings/,
    });
    expect(await review.check(r, done("code", []))).toMatchObject({
      word: "retry",
      reason: /no findings/,
    });
  });

  it("retries when the tests are no longer green", async () => {
    vi.mocked(runTests).mockResolvedValue(ran(1, "AssertionError"));
    expect(await review.check(r, done("approve", []))).toMatchObject({
      word: "retry",
      reason: /not green at review/,
    });
  });

  it("mounts the worktree read-only for the reviewer", () => {
    expect(review.worktree).toBe("ro");
  });
});
