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
const r = { test: "node --test a.test.ts old.test.ts" } as Run;
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

  it("retries when an existing test file the cl's command runs was changed", async () => {
    const at = fakeWorktree({ changed: ["old.test.ts"] });
    expect(await hammer.check(r, d, at, ledger)).toMatchObject({
      word: "retry",
      cause: "scope_exceeds_change",
      reason: /a test was changed: old.test.ts/,
    });
  });

  it("retries when the tests are still red", async () => {
    const at = fakeWorktree({ test: ran(1, "AssertionError") });
    expect(await hammer.check(r, d, at, ledger)).toMatchObject({
      word: "retry",
      reason: /red: exit 1/,
    });
  });

  it("passes when no test changed and the tests are green", async () => {
    const at = fakeWorktree();
    expect(await hammer.check(r, d, at, ledger)).toEqual({
      word: "pass",
      reason: "green",
      findings: [],
    });
    expect(at.asked).toEqual([["a.test.ts", "old.test.ts"]]);
    expect(at.runs).toBe(1);
  });
});
