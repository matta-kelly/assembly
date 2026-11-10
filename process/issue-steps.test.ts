import { describe, expect, it } from "vitest";
import { accept } from "./accept.ts";
import { planReview } from "./plan-review.ts";
import { resultOf, type Run } from "./step.ts";
import type { Ledger } from "../orchestrator/ledger.ts";
import { fakeWorktree, ran } from "./fake-worktree.ts";

const r = { test: "npm test" } as Run;
const ledger = {} as Ledger;
const done = { word: "done" } as const;
const back = (about: string) => ({
  word: "back",
  findings: [
    { about, what: "cut two needs cut one's export", where: "cut two" },
  ],
});

describe("the plan review's check", () => {
  it("passes an approve", async () => {
    expect((await planReview.check(r, done, fakeWorktree(), ledger)).word).toBe(
      "pass",
    );
  });

  it("takes findings back about the plan or the issue, and nothing below them", () => {
    const result = resultOf(planReview);
    expect(result.safeParse(back("plan")).success).toBe(true);
    expect(result.safeParse(back("issue")).success).toBe(true);
    expect(result.safeParse(back("code")).success).toBe(false);
  });
});

describe("the accept step's check", () => {
  it("passes an accept on a green full suite", async () => {
    expect((await accept.check(r, done, fakeWorktree(), ledger)).word).toBe(
      "pass",
    );
  });

  it("sends the issue back to the planner on a red full suite, with the finding", async () => {
    expect(
      await accept.check(
        r,
        done,
        fakeWorktree({ test: ran(1, "AssertionError") }),
        ledger,
      ),
    ).toMatchObject({
      word: "back",
      cause: "check_failed",
      reason: expect.stringMatching(/full suite is red/),
      findings: [{ about: "plan", where: "npm test" }],
    });
  });

  it("takes findings back about the plan or the issue", () => {
    const result = resultOf(accept);
    expect(result.safeParse(back("plan")).success).toBe(true);
    expect(result.safeParse(back("issue")).success).toBe(true);
    expect(result.safeParse(back("cl")).success).toBe(false);
  });

  it("reads the worktree only", () => {
    expect([planReview.worktree, accept.worktree]).toEqual(["ro", "ro"]);
  });
});
