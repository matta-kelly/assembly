import { beforeEach, describe, expect, it, vi } from "vitest";
import { hammer } from "./hammer.ts";
import type { Run } from "../line/step.ts";
import type { Ledger } from "../line/ledger.ts";
import { fakeWorktree, ran } from "./fake-worktree.ts";

vi.mock("./nail.ts", () => ({ testsOf: vi.fn(() => "") }));

let files: string[];
const runOf = () => ({ test: "scripts/check.sh all", tests: files }) as Run;
const d = { word: "done" as const, changed: ["src/a.ts"] };
const ledger = {} as Ledger;

beforeEach(() => {
  files = ["a.test.ts"];
});

describe("the hammer step's check", () => {
  it("retries when da-nail wrote no test file", async () => {
    files = [];
    expect(
      await hammer.check(runOf(), d, fakeWorktree(), ledger),
    ).toMatchObject({
      word: "retry",
      reason: /wrote no test file/,
    });
  });

  it("gates a done: no test of da-nail's changed, and the change is exactly the files listed", async () => {
    files = ["a.test.ts", "old.test.ts"];
    const view = fakeWorktree({
      changed: ["old.test.ts"],
      touched: ["old.test.ts", "src/a.ts", "probe_test.go"],
    });
    const problems = await hammer.gate!(runOf(), d, view);
    expect(problems).toEqual([
      {
        what: "old.test.ts is da-nail's test, which you may not change: put it back as it was",
        cause: "scope_exceeds_change",
      },
      {
        what: "old.test.ts is changed in the worktree but not in your list: remove it if it is scratch, or list it",
        cause: "invalid_output",
      },
      {
        what: "probe_test.go is changed in the worktree but not in your list: remove it if it is scratch, or list it",
        cause: "invalid_output",
      },
    ]);
  });

  it("retries when the repo's check is red, with its output's tail: da-nail's tests, format, lint and every other test are hammer's", async () => {
    const at = fakeWorktree({ test: ran(1, "gofmt: not formatted") });
    expect(await hammer.check(runOf(), d, at, ledger)).toMatchObject({
      word: "retry",
      cause: "check_failed",
      reason: "red: the check fails: exit 1: gofmt: not formatted",
    });
  });

  it("passes when no test changed and the repo's check is green, run once", async () => {
    const at = fakeWorktree();
    expect(await hammer.check(runOf(), d, at, ledger)).toEqual({
      word: "pass",
      reason: "green",
      findings: [],
    });
    expect(at.runs).toBe(1);
  });
});
