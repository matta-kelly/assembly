import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Run } from "../line/step.ts";
import { notesRepo } from "../repos/notes.fixture.ts";
import type { Ledger } from "../line/ledger.ts";
import {
  changeOf,
  judge,
  nail as tests,
  testFilesOf,
  testsOf,
} from "./nail.ts";
import { fakeWorktree, ran } from "./fake-worktree.ts";

const none = { events: () => [] } as unknown as Ledger;

const cl = `---
type: cl
---
Intent.

## Promises

- given a, when b, then c
	- a detail, not a promise
- given d, when e, then f

## Seam

- not a promise
`;

let dir: string;
let r: Run;
beforeEach(() => {
  const notes = notesRepo({ "_well/i-x.md": cl });
  dir = notes.repo;
  r = {
    name: "i-x",
    kind: "cl",
    issue: "i",
    seq: 1,
    n: 1,
    note: "_well/i-x.md",
    notes: notes.first,
    repo: "/repo",
    test: "npm test",
    tests: [],
    dir,
    work: join(dir, "work"),
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const t = (n: number, file = "a.test.ts") => ({ file, name: `b${n}` });

describe("da-nail's tests, as the steps after it read them", () => {
  it("are its last passed result's: the files once each, and each test", () => {
    const ledger = {
      passed: () => ({ word: "done", tests: [t(1), t(2), t(3, "b.test.ts")] }),
    } as unknown as Ledger;
    expect(testFilesOf(ledger, "x")).toEqual(["a.test.ts", "b.test.ts"]);
    expect(testsOf(ledger, "x")).toContain("- `b.test.ts`, b3");
  });

  it("are none before da-nail passed", () => {
    const ledger = { passed: () => undefined } as unknown as Ledger;
    expect(testFilesOf(ledger, "x")).toEqual([]);
  });
});

describe("the nail step's check, on tests that pass", () => {
  it("passes them as met, first pass or a return: the code meets them, so the cl goes to its review", async () => {
    const both = {
      word: "done" as const,
      tests: [t(1), t(2)],
      changed: ["a.test.ts"],
    };
    const passing = fakeWorktree({ files: ["a.test.ts"] });
    expect(await tests.check(r, both, passing, none)).toMatchObject({
      word: "pass",
      met: true,
    });
  });
});

describe("the nail step's check, on a structure cl", () => {
  it("passes its tests that pass to da-hammer, not as met: they pin the code, and the refactor is to come", async () => {
    const structural = cl.replace(
      "type: cl\n",
      "type: cl\nshape: { change: structure, checked: repo }\n",
    );
    const notes = notesRepo({ "_well/i-x.md": structural });
    const both = {
      word: "done" as const,
      tests: [t(1), t(2)],
      changed: ["a.test.ts"],
    };
    try {
      const m = await tests.check(
        { ...r, notes: notes.first, dir: notes.repo },
        both,
        fakeWorktree({ files: ["a.test.ts"] }),
        none,
      );
      expect(m).toMatchObject({ word: "pass", reason: /pinned/ });
      expect(m.met).toBeUndefined();
    } finally {
      rmSync(notes.repo, { recursive: true, force: true });
    }
  });
});

describe("the nail step's check, before red", () => {
  it("runs the repo's own check once, and passes a red to da-hammer: there is code to write", async () => {
    const run = fakeWorktree({
      files: ["a.test.ts"],
      test: ran(1, "b1 failed"),
    });
    const m = await tests.check(
      r,
      { word: "done", tests: [t(1), t(3)], changed: ["a.test.ts"] },
      run,
      none,
    );
    expect(run.runs).toBe(1);
    expect(m).toMatchObject({
      word: "pass",
      reason: "red: the check fails: exit 1",
    });
    expect(m.met).toBeUndefined();
  });

  it("gates a done: each listed test file is there, and the change is exactly the files listed", async () => {
    const view = fakeWorktree({
      files: ["a.test.ts"],
      touched: ["a.test.ts", "scratch.ts"],
    });
    const problems = await tests.gate!(
      r,
      {
        word: "done",
        tests: [t(1), t(2, "gone.test.ts")],
        changed: ["a.test.ts"],
      },
      view,
    );
    expect(problems.map((p) => p.what)).toEqual([
      "gone.test.ts is listed, but it is not in the worktree",
      "scratch.ts is changed in the worktree but not in your list: remove it if it is scratch, or list it",
    ]);
  });
});

describe("judge, a behavior cl", () => {
  it("passes a red check to its code: a red from an assertion or a stub alike", () => {
    const m = judge(1, "b1 failed", "behavior");
    expect(m).toMatchObject({
      word: "pass",
      reason: "red: the check fails: exit 1",
    });
    expect(m.met).toBeUndefined();
  });

  it("passes a green check as met: the code meets the tests", () => {
    expect(judge(0, "ok", "behavior")).toMatchObject({
      word: "pass",
      met: true,
    });
  });
});

describe("judge, a structure cl", () => {
  it("passes a green check to da-hammer, not as met: the behavior is pinned, for the refactor", () => {
    const m = judge(0, "ok", "structure");
    expect(m).toMatchObject({ word: "pass", reason: /pinned/ });
    expect(m.met).toBeUndefined();
  });

  it("retries a red check, with its output's tail: a characterization test passes on the code as it is", () => {
    expect(judge(1, "b1 failed", "structure")).toMatchObject({
      word: "retry",
      cause: "check_failed",
      reason:
        /pin the code as it is, so the check passes now: exit 1: b1 failed/,
    });
  });
});

describe("changeOf", () => {
  it("is structure when the cl's shape says so, and behavior otherwise", () => {
    expect(
      changeOf(
        "---\ntype: cl\nshape: { change: structure, checked: repo }\n---\nx\n",
      ),
    ).toBe("structure");
    expect(
      changeOf(
        "---\ntype: cl\nshape: { change: behavior, checked: repo }\n---\nx\n",
      ),
    ).toBe("behavior");
    expect(changeOf("---\ntype: cl\n---\nx\n")).toBe("behavior");
  });
});
