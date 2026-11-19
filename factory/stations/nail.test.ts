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
import { fakeWorktree } from "./fake-worktree.ts";

const at = fakeWorktree({ files: ["a.test.ts"] });
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
    image: "img",
    test: "npm test",
    setup: "",
    dir,
    work: join(dir, "work"),
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const t = (n: number, file = "a.test.ts", kind: "new" | "kept" = "new") => ({
  file,
  name: `b${n}`,
  kind,
});

describe("da-nail's tests, as the steps after it read them", () => {
  it("are its last passed result's: the files once each, and each test", () => {
    const ledger = {
      passed: () => ({ word: "done", tests: [t(1), t(2), t(3, "b.test.ts")] }),
    } as unknown as Ledger;
    expect(testFilesOf(ledger, "x")).toEqual(["a.test.ts", "b.test.ts"]);
    expect(testsOf(ledger, "x")).toContain("- `b.test.ts`, b3 (new)");
  });

  it("are none before da-nail passed", () => {
    const ledger = { passed: () => undefined } as unknown as Ledger;
    expect(testFilesOf(ledger, "x")).toEqual([]);
  });
});

describe("the nail step's check, on tests that pass", () => {
  it("passes them as met, first pass or a return: the code meets them, so the cl goes to its review", async () => {
    const both = { word: "done" as const, tests: [t(1), t(2)] };
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
    const both = { word: "done" as const, tests: [t(1), t(2)] };
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
  it("runs each test da-nail lists, and never the full suite: whether every promise is kept is the review's", async () => {
    const run = fakeWorktree({ files: ["a.test.ts"] });
    await tests.check(r, { word: "done", tests: [t(1), t(3)] }, run, none);
    expect(run.listedAsked).toEqual([[t(1), t(3)]]);
    expect(run.runs).toBe(0);
  });

  it("retries a test file no runner runs, and runs nothing", async () => {
    const run = fakeWorktree({ files: ["a.test.ts", "a.test.mjs"] });
    const v = await tests.check(
      r,
      { word: "done", tests: [t(1), t(2, "a.test.mjs")] },
      run,
      none,
    );
    expect(v).toMatchObject({
      word: "retry",
      cause: "invalid_output",
      reason: /a.test.mjs: the factory runs only/,
    });
    expect(run.listedAsked).toEqual([]);
  });

  it("retries when a test file is not in the worktree", async () => {
    const v = await tests.check(
      r,
      {
        word: "done",
        tests: [t(1), t(2, "gone.test.ts")],
      },
      at,
      none,
    );
    expect(v.word).toBe("retry");
    expect(v.reason).toMatch(/not in the worktree: gone.test.ts/);
  });
});

/** A listed test's run: listed (built and found) unless said, with its exit code. */
const res = (
  n: number,
  code: number,
  kind: "new" | "kept" = "new",
  listed = true,
) => ({ test: t(n, "a.test.ts", kind), listed, code, out: `b${n}` });

describe("judge, a behavior cl", () => {
  it("passes to its code when a new test fails and every kept one passes: a red from an assertion or a stub alike", () => {
    const m = judge([res(1, 1), res(2, 0, "kept")], "behavior");
    expect(m).toMatchObject({ word: "pass", reason: /red: b1/ });
    expect(m.met).toBeUndefined();
  });

  it("passes as met when every test passes: the code meets them", () => {
    expect(judge([res(1, 0), res(2, 0, "kept")], "behavior")).toMatchObject({
      word: "pass",
      met: true,
    });
  });

  it("retries a kept test that fails before the change", () => {
    expect(judge([res(1, 1), res(2, 1, "kept")], "behavior")).toMatchObject({
      word: "retry",
      cause: "check_failed",
      reason: /kept tests fail before the change: b2/,
    });
  });

  it("retries a test that does not build or is not found, whatever its exit code", () => {
    expect(judge([res(1, 0, "new", false)], "behavior")).toMatchObject({
      word: "retry",
      cause: "check_failed",
      reason: /do not build or are not found: b1/,
    });
  });
});

describe("judge, a structure cl", () => {
  it("passes tests that all pass to da-hammer, not as met: the behavior is pinned, for the refactor", () => {
    const m = judge([res(1, 0), res(2, 0, "kept")], "structure");
    expect(m).toMatchObject({ word: "pass", reason: /pinned/ });
    expect(m.met).toBeUndefined();
  });

  it("retries a test that fails: a characterization test passes on the code as it is", () => {
    expect(judge([res(1, 1)], "structure")).toMatchObject({
      word: "retry",
      cause: "check_failed",
      reason: /pin the code as it is/,
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
