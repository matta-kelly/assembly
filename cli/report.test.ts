import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compose } from "../main.ts";
import { blocked, explain, status } from "./report.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "factory-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

const issue = {
  name: "is",
  path: "/work/is.md",
  repo: "/repo",
  image: "img",
  test: "suite",
};

describe("the factory's reports", () => {
  it("status: each item and its state, the open attempts, and the spend", () => {
    const { ledger } = compose({ home });
    ledger.addIssue(issue);
    ledger.apply(
      "is",
      { word: "retry", reason: "r", findings: [] },
      { attempt: ledger.begin("is"), ...{ usage: { cost: 0.5 } } },
    );
    ledger.begin("is");
    expect(status(ledger)).toEqual([
      "is  open",
      "",
      "open attempts: is/2 (open)",
      "spent: $0.5000",
    ]);
  });

  it("status: each issue's cls under it, whatever order they came in", () => {
    const { ledger } = compose({ home });
    ledger.addIssue(issue);
    ledger.addIssue({ ...issue, name: "two" });
    ledger.addCl({ ...issue, name: "is-one", issue: "is", seq: 1 }, "ready");
    expect(status(ledger).slice(0, 3)).toEqual([
      "is  open",
      "  is-one  ready",
      "two  open",
    ]);
  });

  it("blocked: the raised and escalated items, with the reason of their last move", () => {
    const { ledger } = compose({ home });
    expect(blocked(ledger)).toEqual(["nothing is blocked"]);
    ledger.addIssue(issue);
    ledger.apply(
      "is",
      {
        word: "back",
        reason: "back, about the issue",
        findings: [{ about: "issue", what: "no intent", where: "Intent" }],
      },
      { attempt: ledger.begin("is") },
    );
    expect(blocked(ledger)).toEqual(["is  raised: back, about the issue"]);
  });

  it("explain: an item's messages with their findings, and each attempt with where its trace is", () => {
    const f = compose({ home });
    f.ledger.addIssue(issue);
    f.ledger.apply(
      "is",
      { word: "pass", reason: "the plan lints", findings: [] },
      { attempt: f.ledger.begin("is"), ...{ usage: { cost: 0.01 } } },
    );
    f.ledger.apply(
      "is",
      {
        word: "back",
        reason: "back, about the plan",
        findings: [
          { about: "plan", what: "cut two needs cut one", where: "cut two" },
        ],
      },
      { attempt: f.ledger.begin("is") },
    );
    const lines = explain(f.ledger, f.runs, "is");
    expect(lines[0]).toBe("is (issue)  open");
    expect(lines).toContainEqual("     plan: cut two needs cut one (cut two)");
    expect(lines).toContainEqual(
      expect.stringMatching(/open -pass-> planned: the plan lints/),
    );
    expect(lines).toContainEqual("  1  open  pass: the plan lints  $0.0100");
    expect(lines).toContainEqual(
      `     trace: ${join(home, "runs", "is", "issue", "1", "trace.jsonl")}`,
    );
  });

  it("explain: names the commit a submitted issue's spec was read at, and shows none for a spec the planner made", () => {
    const f = compose({ home });
    const a = "a".repeat(40);
    const b = "0123456789abcdef".repeat(2) + "01234567";
    f.ledger.addIssue(issue);
    f.ledger.addIssue({ ...issue, name: "two" });
    f.ledger.addIssue({ ...issue, name: "planned" });
    f.ledger.keepSpec("is", { cls: [] }, "matt", a);
    f.ledger.keepSpec("two", { cls: [] }, "matt", b);
    const text = (name: string) => explain(f.ledger, f.runs, name).join("\n");
    expect(text("is")).toContain(a);
    expect(text("is")).not.toContain(b);
    expect(text("two")).toContain(b);
    expect(text("two")).not.toContain(a);
    expect(text("planned")).not.toMatch(/[0-9a-f]{40}/);
    expect(text("planned")).not.toMatch(/commit/i);
  });
});
