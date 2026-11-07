import { ran } from "./ran.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runTests } from "../orchestrator/start.ts";
import { accept } from "./accept.ts";
import { planReview } from "./plan-review.ts";
import type { Run } from "./step.ts";

vi.mock("../orchestrator/start.ts", () => ({ runTests: vi.fn() }));

const r = {} as Run;
const finding = { what: "cut two needs cut one's export", where: "cut two" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(runTests).mockResolvedValue(ran(0, "ok"));
});

describe("the plan review's check", () => {
  it("passes an approve with no findings, and sends a plan back with findings", async () => {
    expect(
      (
        await planReview.check(r, {
          word: "done",
          decision: "approve",
          findings: [],
        })
      ).word,
    ).toBe("pass");
    expect(
      (
        await planReview.check(r, {
          word: "done",
          decision: "plan",
          findings: [finding],
        })
      ).word,
    ).toBe("to-plan");
  });

  it("retries a decision its findings disagree with", async () => {
    expect(
      (
        await planReview.check(r, {
          word: "done",
          decision: "approve",
          findings: [finding],
        })
      ).word,
    ).toBe("retry");
    expect(
      (
        await planReview.check(r, {
          word: "done",
          decision: "plan",
          findings: [],
        })
      ).word,
    ).toBe("retry");
  });
});

describe("the accept step's check", () => {
  it("passes an accept on a green full suite", async () => {
    expect(
      (
        await accept.check(r, {
          word: "done",
          decision: "accept",
          findings: [],
        })
      ).word,
    ).toBe("pass");
  });

  it("sends the issue back to the planner on a red full suite, even on an accept", async () => {
    vi.mocked(runTests).mockResolvedValue(ran(1, "AssertionError"));
    expect(
      await accept.check(r, { word: "done", decision: "accept", findings: [] }),
    ).toMatchObject({
      word: "to-plan",
      reason: expect.stringMatching(/full suite is red/),
    });
  });

  it("sends the issue back on a send-back, and retries a decision its findings disagree with", async () => {
    expect(
      (
        await accept.check(r, {
          word: "done",
          decision: "plan",
          findings: [finding],
        })
      ).word,
    ).toBe("to-plan");
    expect(
      (
        await accept.check(r, {
          word: "done",
          decision: "accept",
          findings: [finding],
        })
      ).word,
    ).toBe("retry");
  });

  it("reads the worktree only", () => {
    expect([planReview.worktree, accept.worktree]).toEqual(["ro", "ro"]);
  });
});
