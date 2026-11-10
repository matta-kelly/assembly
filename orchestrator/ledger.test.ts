import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { open } from "./ledger.ts";
import type { Finding } from "../process/step.ts";

const f = (about: Finding["about"]): Finding => ({
  about,
  what: "w",
  where: "x",
});

const at = { repo: "/repo", image: "img" };
const issue = { name: "is", path: "/is.md", test: "suite", ...at };
const cl = (name: string, seq: number) => ({
  name,
  issue: "is",
  seq,
  path: `/${name}.md`,
  test: "t",
  ...at,
});

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ledger-"));
  file = join(dir, "ledger.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ledger", () => {
  it("adds an issue at open, and its cls in their plan's order, each with one event", () => {
    const l = open(file);
    l.addIssue(issue);
    l.addCl(cl("is-b", 2), "waiting");
    l.addCl(cl("is-a", 1), "ready");
    expect(l.item("is")).toMatchObject({
      kind: "issue",
      issue: "is",
      state: "open",
    });
    expect(l.cls("is").map((c) => [c.name, c.state])).toEqual([
      ["is-a", "ready"],
      ["is-b", "waiting"],
    ]);
    expect(l.events("is-b")).toHaveLength(1);
  });

  it("opens an attempt, and an item with an open attempt is not waiting", () => {
    const l = open(file);
    l.addIssue(issue);
    expect(l.begin("is")).toBe(1);
    expect(l.open()).toEqual([{ name: "is", n: 1, step: "open" }]);
    expect(l.waiting(["open"])).toEqual([]);
  });

  it("ends an attempt with its result, moves the item and writes one event, together", () => {
    const l = open(file);
    l.addIssue(issue);
    const n = l.begin("is");
    l.apply(
      "is",
      { word: "pass", reason: "the plan lints", findings: [] },
      {
        attempt: n,
        ...{
          usage: { tokens: 9, input: 7, output: 2, cached: 5, cost: 0.01 },
          result: { word: "done", cuts: [] },
        },
      },
    );
    expect(l.attempt("is", n)).toMatchObject({
      tokens: 9,
      tokens_in: 7,
      tokens_out: 2,
      cached_in: 5,
      cost: 0.01,
      duration_ms: expect.any(Number),
    });
    expect(l.item("is").state).toBe("planned");
    expect(l.open()).toEqual([]);
    expect(l.passed("is", "open")).toEqual({ word: "done", cuts: [] });
    expect(l.events("is").at(-1)).toMatchObject({
      n: 1,
      from_state: "open",
      word: "pass",
      to_state: "planned",
    });
  });

  it("records a failure's cause on its attempt and its event, and refuses one not on the list", () => {
    const l = open(file);
    l.addIssue(issue);
    l.apply(
      "is",
      {
        word: "retry",
        cause: "contract_invalid",
        reason: "two cuts share a name",
        findings: [],
      },
      { attempt: l.begin("is") },
    );
    expect(l.attempt("is", 1)).toMatchObject({ cause: "contract_invalid" });
    expect(l.events("is").at(-1)).toMatchObject({ cause: "contract_invalid" });
    expect(() =>
      l.apply(
        "is",
        {
          word: "retry",
          cause: "bad_luck" as never,
          reason: "?",
          findings: [],
        },
        { attempt: l.begin("is") },
      ),
    ).toThrow(/CHECK constraint/);
  });

  it("records the check's test run with its attempt", () => {
    const l = open(file);
    l.addIssue(issue);
    const check = {
      command: "suite",
      image: "img",
      tree: "4b825dc",
      input: "abc",
      code: 0,
      at: Date.parse("2026-11-07T00:00:00Z"),
      ms: 1200,
    };
    l.apply(
      "is",
      { word: "pass", reason: "green", findings: [] },
      {
        attempt: l.begin("is"),
        ...{
          ran: check,
        },
      },
    );
    const db = new DatabaseSync(file);
    expect(db.prepare("SELECT * FROM check_runs").all()).toEqual([
      expect.objectContaining({
        name: "is",
        n: 1,
        step: "open",
        command: "suite",
        input_hash: "abc",
        code: 0,
        at: "2026-11-07T00:00:00.000Z",
        duration_ms: 1200,
      }),
    ]);
    db.close();
  });

  it("gives the last passed result of a step, and none for a step that never passed", () => {
    const l = open(file);
    l.addIssue(issue);
    l.apply(
      "is",
      { word: "pass", reason: "r", findings: [] },
      {
        attempt: l.begin("is"),
        ...{
          result: { v: 1 },
        },
      },
    );
    l.apply(
      "is",
      { word: "back", reason: "r", findings: [f("plan")] },
      {
        attempt: l.begin("is"),
        ...{
          result: { v: 2 },
        },
      },
    );
    l.apply(
      "is",
      { word: "pass", reason: "r", findings: [] },
      {
        attempt: l.begin("is"),
        ...{
          result: { v: 3 },
        },
      },
    );
    expect(l.passed("is", "open")).toEqual({ v: 3 });
    expect(l.passed("is", "built")).toBeUndefined();
  });

  it("moves items with no attempt, by the orchestrator or Matt, and counts a state's attempts again from the move", () => {
    const l = open(file);
    l.addIssue(issue);
    l.apply(
      "is",
      { word: "retry", reason: "r", findings: [] },
      { attempt: l.begin("is") },
    );
    l.apply(
      "is",
      { word: "pass", reason: "r", findings: [] },
      { attempt: l.begin("is") },
    );
    l.apply(
      "is",
      { word: "back", reason: "a cl raised", findings: [f("plan")] },
      "orchestrator",
    );
    expect(l.item("is").state).toBe("open");
    expect(l.events("is").at(-1)).toMatchObject({
      n: 2,
      by: "orchestrator",
      from_state: "planned",
      word: "back",
      to_state: "open",
    });
    l.begin("is");
    expect(l.attempts("is", "open")).toBe(1);
  });

  it("counts the sends back for another round, and never a raise", () => {
    const l = open(file);
    l.addIssue(issue);
    l.addCl(cl("is-a", 1), "green");
    const back = (about: Finding["about"]) => ({
      word: "back" as const,
      reason: "r",
      findings: [f(about)],
    });
    l.apply("is-a", back("code"), { attempt: l.begin("is-a") });
    l.apply(
      "is-a",
      { word: "pass", reason: "r", findings: [] },
      { attempt: l.begin("is-a") },
    );
    l.apply("is-a", back("tests"), { attempt: l.begin("is-a") });
    l.apply("is-a", back("cl"), { attempt: l.begin("is-a") });
    expect(l.rounds("is-a")).toBe(2);
    l.apply(
      "is",
      { word: "pass", reason: "r", findings: [] },
      { attempt: l.begin("is") },
    );
    l.apply("is", back("plan"), { attempt: l.begin("is") });
    expect(l.rounds("is")).toBe(1);
  });

  it("keeps each message's findings and notes on its event", () => {
    const l = open(file);
    l.addIssue(issue);
    l.apply(
      "is",
      { word: "pass", reason: "r", findings: [], notes: "n" },
      { attempt: l.begin("is") },
    );
    l.apply(
      "is",
      { word: "back", reason: "r", findings: [f("plan")] },
      { attempt: l.begin("is") },
    );
    expect(l.events("is").slice(-2)).toMatchObject([
      { word: "pass", findings: [], notes: "n" },
      { word: "back", findings: [f("plan")], notes: null },
    ]);
  });

  it("gives an attempt's inbox: the message that brought the item to its state, and each since", () => {
    const l = open(file);
    l.addIssue(issue);
    expect(l.inbox("is", "open")).toEqual([]);
    l.apply(
      "is",
      { word: "pass", reason: "planned", findings: [] },
      { attempt: l.begin("is") },
    );
    l.apply(
      "is",
      { word: "back", reason: "back", findings: [f("plan")] },
      { attempt: l.begin("is") },
    );
    l.apply(
      "is",
      { word: "retry", reason: "no lint", findings: [] },
      { attempt: l.begin("is") },
    );
    expect(l.inbox("is", "open").map((e) => e.reason)).toEqual([
      "back",
      "no lint",
    ]);
    l.apply(
      "is",
      { word: "pass", reason: "Matt planned it", findings: [] },
      "matt",
    );
    expect(l.inbox("is", "planned")).toMatchObject([
      { by: "matt", word: "pass", reason: "Matt planned it" },
    ]);
  });

  it("keeps everything after it is opened again", () => {
    const l = open(file);
    l.addIssue(issue);
    l.apply(
      "is",
      { word: "retry", reason: "r", findings: [] },
      { attempt: l.begin("is") },
    );
    l.begin("is");
    const again = open(file);
    expect(again.item("is").state).toBe("open");
    expect(again.open()).toEqual([{ name: "is", n: 2, step: "open" }]);
    expect(again.attempts("is", "open")).toBe(2);
  });

  it("applies a message by the table: the orchestrator's moves have rows, and a word with no row throws for them", () => {
    const l = open(file);
    l.addIssue(issue);
    l.addCl(cl("is-a", 1), "waiting");
    const say = (word: "pass" | "drop" | "escalate" | "replan") => ({
      word,
      reason: "r",
      findings: [],
    });
    expect(l.apply("is-a", say("pass"), "orchestrator")).toBe("ready");
    expect(() => l.apply("is-a", say("replan"), "orchestrator")).toThrow(
      /no transition/,
    );
    expect(l.apply("is-a", say("drop"), "orchestrator")).toBe("dropped");
    expect(l.apply("is", say("escalate"), "orchestrator")).toBe("escalated");
    expect(l.apply("is", say("replan"), "matt")).toBe("open");
  });

  it("escalates an attempt whose word the table has no row for, with why, and ends the attempt", () => {
    const l = open(file);
    l.addIssue(issue);
    const n = l.begin("is");
    expect(
      l.apply(
        "is",
        { word: "back", reason: "r", findings: [f("code")] },
        { attempt: n },
      ),
    ).toBe("escalated");
    expect(l.open()).toEqual([]);
    expect(l.events("is").at(-1)?.reason).toMatch(/no owner of code for issue/);
  });

  it("keeps an issue's spec with who made it, and lets it go", () => {
    const l = open(file);
    l.addIssue(issue);
    expect(l.spec("is")).toBeUndefined();
    l.keepSpec("is", { cls: [] }, "matt");
    expect(l.spec("is")).toEqual({ spec: { cls: [] }, by: "matt" });
    l.dropSpec("is");
    expect(l.spec("is")).toBeUndefined();
  });

  it("keeps a cl's phase, and a lone cl's is 1", () => {
    const l = open(file);
    l.addIssue(issue);
    l.addCl({ ...cl("is-a", 1), phase: 2 }, "waiting");
    l.addCl(cl("is-b", 2), "ready");
    expect(l.cls("is").map((c) => [c.name, c.phase])).toEqual([
      ["is-a", 2],
      ["is-b", 1],
    ]);
  });
});
