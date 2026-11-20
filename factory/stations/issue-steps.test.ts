import { describe, expect, it } from "vitest";
import { planReview } from "./plan-review.ts";
import { resultOf, type Run } from "../line/step.ts";
import type { Ledger } from "../line/ledger.ts";
import { fakeWorktree } from "./fake-worktree.ts";

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
