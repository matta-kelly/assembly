import { beforeEach, describe, expect, it, vi } from "vitest";
import { hammer } from "./hammer.ts";
import type { Run } from "../line/step.ts";
import type { Ledger } from "../line/ledger.ts";
import { fakeWorktree, ran } from "./fake-worktree.ts";

vi.mock("./nail.ts", () => ({
  testFilesOf: vi.fn(() => files),
  testsOf: vi.fn(() => ""),
  nailed: vi.fn(() => files.map((file) => ({ file, name: file, kind: "new" }))),
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

  it("retries when a kept test file da-nail listed was changed", async () => {
    files = ["a.test.ts", "old.test.ts"];
    const at = fakeWorktree({ changed: ["old.test.ts"] });
    expect(await hammer.check(r, d, at, ledger)).toMatchObject({
      word: "retry",
      cause: "scope_exceeds_change",
      reason: /a test was changed: old.test.ts/,
    });
  });

  it("retries when one of da-nail's tests is still red, and does not run the full suite", async () => {
    const at = fakeWorktree({ codes: { "a.test.ts": 1 } });
    expect(await hammer.check(r, d, at, ledger)).toMatchObject({
      word: "retry",
      reason: /red: a.test.ts/,
    });
    expect(at.runs).toBe(0);
  });

  it("retries when da-nail's tests pass and the full suite is red: format, lint and every other test are hammer's", async () => {
    const at = fakeWorktree({ test: ran(1, "gofmt: not formatted") });
    expect(await hammer.check(r, d, at, ledger)).toMatchObject({
      word: "retry",
      reason: /the full suite is red: exit 1/,
    });
  });

  it("passes when no test changed and the tests are green", async () => {
    const at = fakeWorktree();
    expect(await hammer.check(r, d, at, ledger)).toEqual({
      word: "pass",
      reason: "green",
      findings: [],
    });
    expect(at.asked).toEqual([["a.test.ts"]]);
    expect(at.listedAsked).toEqual([
      [{ file: "a.test.ts", name: "a.test.ts", kind: "new" }],
    ]);
    expect(at.runs).toBe(1);
  });
});
