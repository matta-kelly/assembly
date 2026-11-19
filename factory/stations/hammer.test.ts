import { beforeEach, describe, expect, it, vi } from "vitest";
import { hammer } from "./hammer.ts";
import type { Run } from "../line/step.ts";
import type { Ledger } from "../line/ledger.ts";
import { fakeWorktree, ran } from "./fake-worktree.ts";

vi.mock("./nail.ts", () => ({
  testFilesOf: vi.fn(() => files),
  testsOf: vi.fn(() => ""),
}));

let files: string[];
const r = { test: "scripts/check.sh all" } as Run;
const d = { word: "done" as const, changed: ["src/a.ts"] };
const ledger = {} as Ledger;

beforeEach(() => {
  files = ["a.test.ts"];
});

describe("the hammer step's check", () => {
  it("retries when da-nail wrote no test file", async () => {
    files = [];
    expect(await hammer.check(r, d, fakeWorktree(), ledger)).toMatchObject({
      word: "retry",
      reason: /wrote no test file/,
    });
  });

  it("retries when a test was changed, and does not run the tests", async () => {
    const at = fakeWorktree({ changed: ["a.test.ts"] });
    expect(await hammer.check(r, d, at, ledger)).toMatchObject({
      word: "retry",
      reason: /a test was changed: a.test.ts/,
    });
    expect(at.runs).toBe(0);
  });

  it("retries when any test file da-nail listed was changed", async () => {
    files = ["a.test.ts", "old.test.ts"];
    const at = fakeWorktree({ changed: ["old.test.ts"] });
    expect(await hammer.check(r, d, at, ledger)).toMatchObject({
      word: "retry",
      cause: "scope_exceeds_change",
      reason: /a test was changed: old.test.ts/,
    });
  });

  it("retries when the repo's check is red, with its output's tail: da-nail's tests, format, lint and every other test are hammer's", async () => {
    const at = fakeWorktree({ test: ran(1, "gofmt: not formatted") });
    expect(await hammer.check(r, d, at, ledger)).toMatchObject({
      word: "retry",
      cause: "check_failed",
      reason: "red: the check fails: exit 1: gofmt: not formatted",
    });
  });

  it("passes when no test changed and the repo's check is green, run once", async () => {
    const at = fakeWorktree();
    expect(await hammer.check(r, d, at, ledger)).toEqual({
      word: "pass",
      reason: "green",
      findings: [],
    });
    expect(at.asked).toEqual([["a.test.ts"]]);
    expect(at.runs).toBe(1);
  });
});
