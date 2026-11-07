import { describe, expect, it } from "vitest";
import { review } from "./review.ts";
import type { Run } from "./step.ts";
import { fakeWorktree, ran } from "./fake-worktree.ts";

const r = {} as Run;
const finding = { what: "b2 is not tested at its edge", where: "a.test.ts:12" };
const done = (decision: "approve" | "tests" | "code", findings = [finding]) =>
  ({ word: "done", decision, findings }) as const;

describe("the review step's check", () => {
  it("passes an approve with no findings, on green", async () => {
    expect(await review.check(r, done("approve", []), fakeWorktree())).toEqual({
      word: "pass",
      reason: "approved",
    });
  });

  it("turns a send-back into its word", async () => {
    expect((await review.check(r, done("tests"), fakeWorktree())).word).toBe(
      "to-tests",
    );
    expect((await review.check(r, done("code"), fakeWorktree())).word).toBe(
      "to-code",
    );
  });

  it("retries a decision its findings disagree with", async () => {
    expect(
      await review.check(r, done("approve"), fakeWorktree()),
    ).toMatchObject({
      word: "retry",
      reason: /approve with findings/,
    });
    expect(
      await review.check(r, done("code", []), fakeWorktree()),
    ).toMatchObject({
      word: "retry",
      reason: /no findings/,
    });
  });

  it("retries when the tests are no longer green", async () => {
    const at = fakeWorktree({ test: ran(1, "AssertionError") });
    expect(await review.check(r, done("approve", []), at)).toMatchObject({
      word: "retry",
      reason: /not green at review/,
    });
  });

  it("mounts the worktree read-only for the reviewer", () => {
    expect(review.worktree).toBe("ro");
  });
});
