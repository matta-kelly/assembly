import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { open } from "./ledger.ts";

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
    l.end("is", n, { word: "pass", reason: "the plan lints" }, "planned", {
      usage: { tokens: 9, input: 7, output: 2, cached: 5, cost: 0.01 },
      result: { word: "done", cuts: [] },
    });
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
    l.end(
      "is",
      l.begin("is"),
      {
        word: "retry",
        cause: "contract_invalid",
        reason: "two cuts share a name",
      },
      "open",
    );
    expect(l.attempt("is", 1)).toMatchObject({ cause: "contract_invalid" });
    expect(l.events("is").at(-1)).toMatchObject({ cause: "contract_invalid" });
    expect(() =>
      l.end(
        "is",
        l.begin("is"),
        { word: "retry", cause: "bad_luck" as never, reason: "?" },
        "open",
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
    l.end("is", l.begin("is"), { word: "pass", reason: "green" }, "planned", {
      ran: check,
    });
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
    l.end("is", l.begin("is"), { word: "pass", reason: "r" }, "planned", {
      result: { v: 1 },
    });
    l.end("is", l.begin("is"), { word: "to-plan", reason: "r" }, "open", {
      result: { v: 2 },
    });
    l.end("is", l.begin("is"), { word: "pass", reason: "r" }, "planned", {
      result: { v: 3 },
    });
    expect(l.passed("is", "open")).toEqual({ v: 3 });
    expect(l.passed("is", "built")).toBeUndefined();
  });

  it("moves items with no attempt, and counts a state's attempts again from the move", () => {
    const l = open(file);
    l.addIssue(issue);
    l.end("is", l.begin("is"), { word: "retry", reason: "r" }, "open");
    l.end("is", l.begin("is"), { word: "pass", reason: "r" }, "planned");
    l.move([{ name: "is", to: "open", reason: "a cl raised" }]);
    expect(l.item("is").state).toBe("open");
    expect(l.events("is").at(-1)).toMatchObject({
      n: 2,
      from_state: "planned",
      word: null,
      to_state: "open",
    });
    l.begin("is");
    expect(l.attempts("is", "open")).toBe(1);
  });

  it("counts a review's send-backs, of every kind", () => {
    const l = open(file);
    l.addIssue(issue);
    l.addCl(cl("is-a", 1), "green");
    l.end("is-a", l.begin("is-a"), { word: "to-code", reason: "r" }, "red");
    l.end("is-a", l.begin("is-a"), { word: "pass", reason: "r" }, "green");
    l.end("is-a", l.begin("is-a"), { word: "to-tests", reason: "r" }, "ready");
    expect(l.rounds("is-a")).toBe(2);
    l.end("is", l.begin("is"), { word: "pass", reason: "r" }, "planned");
    l.end("is", l.begin("is"), { word: "to-plan", reason: "r" }, "open");
    expect(l.rounds("is")).toBe(1);
  });

  it("keeps everything after it is opened again", () => {
    const l = open(file);
    l.addIssue(issue);
    l.end("is", l.begin("is"), { word: "retry", reason: "r" }, "open");
    l.begin("is");
    const again = open(file);
    expect(again.item("is").state).toBe("open");
    expect(again.open()).toEqual([{ name: "is", n: 2, step: "open" }]);
    expect(again.attempts("is", "open")).toBe(2);
  });
});
