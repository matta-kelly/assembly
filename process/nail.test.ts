import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Run } from "./step.ts";
import { behaviors, judge, nail as tests, testFiles } from "./nail.ts";
import { fakeWorktree } from "./fake-worktree.ts";

const at = fakeWorktree({ files: ["a.test.ts"] });

const cl = `---
type: cl
---
Intent.

## Check

- given a, when b, then c
	- a detail, not a behavior
- given d, when e, then f

## Seam

- not a behavior
`;

let dir: string;
let r: Run;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tests-step-"));
  writeFileSync(join(dir, "cl.md"), cl);
  r = {
    name: "x",
    kind: "cl",
    issue: "i",
    seq: 1,
    n: 1,
    path: join(dir, "cl.md"),
    repo: "/repo",
    image: "img",
    test: "npm test",
    dir,
    work: join(dir, "work"),
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const t = (behavior: number, file = "a.test.ts") => ({
  behavior,
  file,
  name: `b${behavior}`,
});

describe("behaviors", () => {
  it("are the top-level items of the cl's Check list", () => {
    expect(behaviors(r.path)).toEqual([
      "- given a, when b, then c",
      "- given d, when e, then f",
    ]);
  });
});

describe("testFiles", () => {
  it("are the files the Tests section names, as the nail step renders them, once each", () => {
    writeFileSync(
      r.path,
      `${cl}\n## Tests\n\n${tests.render({ word: "done", tests: [t(1), t(2), t(3, "b.test.ts")] })}\n\n## Code\n`,
    );
    expect(testFiles(r.path)).toEqual(["a.test.ts", "b.test.ts"]);
  });
});

describe("the nail step's check, before red", () => {
  it("retries when a behavior has no test", async () => {
    const v = await tests.check(r, { word: "done", tests: [t(1)] }, at);
    expect(v).toEqual({
      word: "retry",
      cause: "invalid_output",
      reason: "behavior 2 has no test",
    });
  });

  it("retries when a test names a behavior the cl does not have", async () => {
    const v = await tests.check(
      r,
      { word: "done", tests: [t(1), t(2), t(3)] },
      at,
    );
    expect(v.word).toBe("retry");
    expect(v.reason).toMatch(/behaviors the cl does not have: 3/);
  });

  it("retries when a test file is not in the worktree", async () => {
    const v = await tests.check(
      r,
      {
        word: "done",
        tests: [t(1), t(2, "gone.test.ts")],
      },
      at,
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
