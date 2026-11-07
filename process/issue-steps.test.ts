import { describe, expect, it } from "vitest";
import { accept } from "./accept.ts";
import { planReview } from "./plan-review.ts";
import type { Run } from "./step.ts";
import { fakeWorktree, ran } from "./fake-worktree.ts";

const r = {} as Run;
const finding = { what: "cut two needs cut one's export", where: "cut two" };

describe("the plan review's check", () => {
  it("passes an approve with no findings, and sends a plan back with findings", async () => {
    expect(
      (
        await planReview.check(
          r,
          {
            word: "done",
            decision: "approve",
            findings: [],
          },
          fakeWorktree(),
        )
      ).word,
    ).toBe("pass");
    expect(
      (
        await planReview.check(
          r,
          {
            word: "done",
            decision: "plan",
            findings: [finding],
          },
          fakeWorktree(),
        )
      ).word,
    ).toBe("to-plan");
  });

  it("retries a decision its findings disagree with", async () => {
    expect(
      (
        await planReview.check(
          r,
          {
            word: "done",
            decision: "approve",
            findings: [finding],
          },
          fakeWorktree(),
        )
      ).word,
    ).toBe("retry");
    expect(
      (
        await planReview.check(
          r,
          {
            word: "done",
            decision: "plan",
            findings: [],
          },
          fakeWorktree(),
        )
      ).word,
    ).toBe("retry");
  });
});

describe("the accept step's check", () => {
  it("passes an accept on a green full suite", async () => {
    expect(
      (
        await accept.check(
          r,
          {
            word: "done",
            decision: "accept",
            findings: [],
          },
          fakeWorktree(),
        )
      ).word,
    ).toBe("pass");
  });

  it("sends the issue back to the planner on a red full suite, even on an accept", async () => {
    expect(
      await accept.check(
        r,
        { word: "done", decision: "accept", findings: [] },
        fakeWorktree({ test: ran(1, "AssertionError") }),
      ),
    ).toMatchObject({
      word: "to-plan",
      reason: expect.stringMatching(/full suite is red/),
    });
  });

  it("sends the issue back on a send-back, and retries a decision its findings disagree with", async () => {
    expect(
      (
        await accept.check(
          r,
          {
            word: "done",
            decision: "plan",
            findings: [finding],
          },
          fakeWorktree(),
        )
      ).word,
    ).toBe("to-plan");
    expect(
      (
        await accept.check(
          r,
          {
            word: "done",
            decision: "accept",
            findings: [finding],
          },
          fakeWorktree(),
        )
      ).word,
    ).toBe("retry");
  });

  it("reads the worktree only", () => {
    expect([planReview.worktree, accept.worktree]).toEqual(["ro", "ro"]);
  });
});
