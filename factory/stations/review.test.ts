import { describe, expect, it } from "vitest";
import { review } from "./review.ts";
import { resultOf, type Run } from "../line/step.ts";
import type { Ledger } from "../line/ledger.ts";
import { fakeWorktree, ran } from "./fake-worktree.ts";

const r = {} as Run;
const ledger = {} as Ledger;
const done = { word: "done" } as const;

describe("the review step's check", () => {
  it("passes an approve on green", async () => {
    expect(await review.check(r, done, fakeWorktree(), ledger)).toEqual({
      word: "pass",
      reason: "approved",
      findings: [],
    });
  });

  it("carries the reviewer's notes in its message", async () => {
    expect(
      (await review.check(r, { ...done, notes: "n" }, fakeWorktree(), ledger))
        .notes,
    ).toBe("n");
  });

  it("retries when the tests are no longer green", async () => {
    const at = fakeWorktree({ test: ran(1, "AssertionError") });
    expect(await review.check(r, done, at, ledger)).toMatchObject({
      word: "retry",
      cause: "check_failed",
      reason: expect.stringMatching(/not green at review/),
    });
  });

  it("takes findings back about the tests, the code, the cl, its plan and its issue", () => {
    const result = resultOf(review);
    for (const about of ["tests", "code", "cl", "plan", "issue"])
      expect(
        result.safeParse({
          word: "back",
          findings: [
            {
              about,
              what: "b2 is not tested at its edge",
              where: "a.test.ts:12",
            },
          ],
        }).success,
      ).toBe(true);
    expect(result.safeParse({ word: "back", findings: [] }).success).toBe(
      false,
    );
  });

  it("mounts the worktree read-only for the reviewer", () => {
    expect(review.worktree).toBe("ro");
  });
});
