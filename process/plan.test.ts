import { describe, expect, it } from "vitest";
import { cutOf, lint, pathsIn, type Plan, planText, viewOf } from "./plan.ts";
import { fakeWorktree } from "./fake-worktree.ts";

const cut = (name: string, traces: number[], read = ["src/a.ts"]) => ({
  name,
  intent: `${name} works`,
  behaviors: ["given x, when y, then z"],
  seam: "the export of src/a.ts",
  files: { change: ["src/a.ts", "src/a.test.ts"], read },
  grounds: ["src/a.ts:1"],
  test: "node --test src/a.test.ts",
  traces,
});
const plan = (...cuts: ReturnType<typeof cut>[]): Plan => ({
  word: "done",
  seams: [{ name: "a", what: "src/a.ts's export" }],
  cuts,
});
const o = {
  checks: 2,
  exists: fakeWorktree({ files: ["src/a.ts"] }).exists,
  taken: () => false,
};

describe("plan lint", () => {
  it("passes a plan whose cuts carry every Check item and read files that are there", () => {
    expect(lint(plan(cut("one", [1]), cut("two", [2])), o).word).toBe("pass");
  });

  it("retries two cuts of one name, or a name a cl of the issue has", () => {
    expect(lint(plan(cut("one", [1]), cut("one", [2])), o).reason).toMatch(
      /share a name: one/,
    );
    expect(
      lint(plan(cut("one", [1, 2])), { ...o, taken: (c) => c === "one" })
        .reason,
    ).toMatch(/already has the name: one/);
  });

  it("retries a file outside the repo, and a file to read that is not there", () => {
    expect(lint(plan(cut("one", [1, 2], ["../etc/passwd"])), o).reason).toMatch(
      /outside the repo/,
    );
    expect(lint(plan(cut("one", [1, 2], ["src/gone.ts"])), o).reason).toMatch(
      /not in the repo: src\/gone.ts/,
    );
  });

  it("retries a Check item no cut carries, and one the issue does not have", () => {
    expect(lint(plan(cut("one", [1])), o).reason).toMatch(
      /carries the issue's Check items: 2/,
    );
    expect(lint(plan(cut("one", [1, 2, 3])), o).reason).toMatch(
      /does not have: 3/,
    );
  });

  it("retries a plan for an issue with no Check", () => {
    expect(lint(plan(cut("one", [1])), { ...o, checks: 0 }).reason).toMatch(
      /does not have: 1|no items to trace/,
    );
  });

  it("reads as text with each cut, in order", () => {
    const text = planText(plan(cut("one", [1]), cut("two", [2])));
    expect(text.indexOf("1. one")).toBeLessThan(text.indexOf("2. two"));
    expect(text).toContain("traces Check items: 2");
  });
});

describe("a cut's files to read", () => {
  it("may be a file an earlier cut makes, and not one a later cut makes", () => {
    const one = {
      ...cut("one", [1]),
      files: { change: ["src/new.ts", "src/a.test.ts"], read: [] },
    };
    const two = cut("two", [2], ["src/new.ts"]);
    expect(lint(plan(one, two), o).word).toBe("pass");
    expect(lint(plan(two, one), o).reason).toMatch(
      /cut two: files to read are not in the repo: src\/new.ts/,
    );
  });
});

describe("a cut's test command", () => {
  it("names its files by path, after the program, past its flags", () => {
    expect(pathsIn("node --test test/a.test.mjs b.test.ts")).toEqual([
      "test/a.test.mjs",
      "b.test.ts",
    ]);
    expect(pathsIn("npm test")).toEqual([]);
    expect(pathsIn("npx vitest run --reporter=dot src/x.test.ts")).toEqual([
      "src/x.test.ts",
    ]);
  });

  it("runs only files the cut names among its files", () => {
    const c = {
      ...cut("one", [1, 2]),
      test: "node --test src/a.test.ts test/other.test.ts",
    };
    expect(lint(plan(c), o).reason).toMatch(
      /cut one: its test command runs files it does not name in its files: test\/other.test.ts/,
    );
  });
});

describe("a cl's cut", () => {
  const ledger = (p: Plan | undefined) =>
    ({ passed: () => p }) as unknown as Parameters<typeof cutOf>[0];

  it("is found in its issue's plan by the cl's name, and gives the cl's view", () => {
    const p = plan(cut("one", [1]), cut("two", [2]));
    expect(cutOf(ledger(p), { name: "is-two", issue: "is" }).name).toBe("two");
    expect(viewOf(ledger(p), { name: "is-one", issue: "is" })).toEqual({
      read: ["src/a.ts"],
      change: ["src/a.ts", "src/a.test.ts"],
    });
  });

  it("is an error for a cl its issue's plan does not have", () => {
    expect(() =>
      cutOf(ledger(undefined), { name: "is-one", issue: "is" }),
    ).toThrow(/is-one is not a cut of is's plan/);
  });
});
