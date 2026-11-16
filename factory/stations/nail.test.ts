import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Run } from "../line/step.ts";
import { notesRepo } from "../repos/notes.fixture.ts";
import type { Ledger } from "../line/ledger.ts";
import {
  changeOf,
  promises,
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

describe("judge, a behavior cl", () => {
  it("passes a run that fails at an assertion", () => {
    expect(
      judge(1, "AssertionError: expected 1 to be 2", "behavior").word,
    ).toBe("pass");
    expect(
      judge(1, "AssertionError [ERR_ASSERTION]: 0 !== 2", "behavior").word,
    ).toBe("pass");
    expect(judge(1, "expect(received).toBe(expected)", "behavior").word).toBe(
      "pass",
    );
    // a test about a SyntaxError is not one that failed to load
    expect(
      judge(
        1,
        "AssertionError: expected [Function] to throw SyntaxError",
        "behavior",
      ).word,
    ).toBe("pass");
  });

  it("retries a test that throws before it asserts, though the run counts it failed", () => {
    expect(
      judge(1, "TypeError: x is not a function\n Tests  1 failed", "behavior")
        .word,
    ).toBe("retry");
  });

  it("passes a run that passes as met, and a red one not", () => {
    expect(judge(0, "Tests 3 passed", "behavior")).toMatchObject({
      word: "pass",
      met: true,
    });
    expect(judge(1, "AssertionError: x", "behavior").met).toBeUndefined();
  });

  it("retries a run that fails before any assertion", () => {
    expect(
      judge(1, "Error: Cannot find module './a.ts'", "behavior"),
    ).toMatchObject({
      word: "retry",
      reason: /before any assertion/,
    });
  });

  it("retries a failure that shows no assertion", () => {
    expect(judge(1, "segfault", "behavior")).toMatchObject({
      word: "retry",
      reason: /no assertion failure/,
    });
  });
});

describe("judge, a structure cl", () => {
  it("passes a run that passes to da-hammer, not as met: the behavior is pinned, for the refactor", () => {
    const m = judge(0, "Tests 3 passed", "structure");
    expect(m).toMatchObject({ word: "pass", reason: /pinned/ });
    expect(m.met).toBeUndefined();
  });

  it("retries a run red at an assertion: a characterization test passes on the code as it is", () => {
    expect(
      judge(1, "AssertionError: expected 1 to be 2", "structure"),
    ).toMatchObject({
      word: "retry",
      cause: "check_failed",
      reason: /pin the code as it is/,
    });
  });

  it("retries a run that fails before any assertion, or shows none, as a behavior cl's", () => {
    expect(
      judge(1, "Error: Cannot find module './a.ts'", "structure"),
    ).toMatchObject({ word: "retry", reason: /before any assertion/ });
    expect(judge(1, "segfault", "structure")).toMatchObject({
      word: "retry",
      reason: /no assertion failure/,
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
