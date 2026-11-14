import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Run } from "./step.ts";
import { notesRepo } from "../effects/notes.fixture.ts";
import type { Ledger } from "../orchestrator/ledger.ts";
import {
  promises,
  judge,
  nail as tests,
  testFilesOf,
  testsOf,
} from "./nail.ts";
import { fakeWorktree, ran } from "./fake-worktree.ts";
import { pathsIn } from "./plan.ts";

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

const t = (promise: number, file = "a.test.ts") => ({
  promise,
  file,
  name: `b${promise}`,
});

describe("promises", () => {
  it("are the top-level items of the cl's Promises list", () => {
    expect(promises(cl)).toEqual([
      "- given a, when b, then c",
      "- given d, when e, then f",
    ]);
  });
});

describe("da-nail's tests, as the steps after it read them", () => {
  it("are its last passed result's: the files once each, and each test by promise", () => {
    const ledger = {
      passed: () => ({ word: "done", tests: [t(1), t(2), t(3, "b.test.ts")] }),
    } as unknown as Ledger;
    expect(testFilesOf(ledger, "x")).toEqual(["a.test.ts", "b.test.ts"]);
    expect(testsOf(ledger, "x")).toContain("- promise 3: `b.test.ts`, b3");
  });

  it("are none before da-nail passed", () => {
    const ledger = { passed: () => undefined } as unknown as Ledger;
    expect(testFilesOf(ledger, "x")).toEqual([]);
  });
});

describe("the nail step's check runs the tests without the cl's code", () => {
  const both = { word: "done" as const, tests: [t(1), t(2, "b.test.ts")] };
  it("asks the red run for the hand-in's test files and the ones its test command names, and passes red at an assertion", async () => {
    const w = fakeWorktree({
      files: ["a.test.ts", "b.test.ts"],
      red: ran(1, "AssertionError: expected 2 mounts"),
    });
    expect((await tests.check(r, both, w, none)).word).toBe("pass");
    expect(w.reds).toEqual([
      [...new Set(["a.test.ts", "b.test.ts", ...pathsIn(r.test)])],
    ]);
  });

  it("retries tests that pass without the cl's code: they test nothing it adds", async () => {
    const w = fakeWorktree({ files: ["a.test.ts", "b.test.ts"] });
    expect(await tests.check(r, both, w, none)).toMatchObject({
      word: "retry",
      reason: /nothing is red/,
    });
  });
});

describe("the nail step's check, before red", () => {
  it("retries when a promise has no test", async () => {
    const v = await tests.check(r, { word: "done", tests: [t(1)] }, at, none);
    expect(v).toEqual({
      word: "retry",
      cause: "invalid_output",
      reason: "promise 2 has no test",
      findings: [],
    });
  });

  it("retries when a test names a promise the cl does not have", async () => {
    const v = await tests.check(
      r,
      { word: "done", tests: [t(1), t(2), t(3)] },
      at,
      none,
    );
    expect(v.word).toBe("retry");
    expect(v.reason).toMatch(/promises the cl does not have: 3/);
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

describe("judge", () => {
  it("passes a run that fails at an assertion", () => {
    expect(judge(1, "AssertionError: expected 1 to be 2").word).toBe("pass");
    expect(judge(1, "AssertionError [ERR_ASSERTION]: 0 !== 2").word).toBe(
      "pass",
    );
    expect(judge(1, "expect(received).toBe(expected)").word).toBe("pass");
    // a test about a SyntaxError is not one that failed to load
    expect(
      judge(1, "AssertionError: expected [Function] to throw SyntaxError").word,
    ).toBe("pass");
  });

  it("retries a test that throws before it asserts, though the run counts it failed", () => {
    expect(
      judge(1, "TypeError: x is not a function\n Tests  1 failed").word,
    ).toBe("retry");
  });

  it("retries a run that passes", () => {
    expect(judge(0, "Tests 3 passed")).toMatchObject({
      word: "retry",
      reason: /nothing is red/,
    });
  });

  it("retries a run that fails before any assertion", () => {
    expect(judge(1, "Error: Cannot find module './a.ts'")).toMatchObject({
      word: "retry",
      reason: /before any assertion/,
    });
  });

  it("retries a failure that shows no assertion", () => {
    expect(judge(1, "segfault")).toMatchObject({
      word: "retry",
      reason: /no assertion failure/,
    });
  });
});
