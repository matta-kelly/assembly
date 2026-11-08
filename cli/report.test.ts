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
    ledger.end(
      "is",
      ledger.begin("is"),
      { word: "retry", reason: "r" },
      "open",
      { usage: { cost: 0.5 } },
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
    ledger.end(
      "is",
      ledger.begin("is"),
      { word: "raise", cause: "missing_context", reason: "no intent" },
      "raised",
    );
    expect(blocked(ledger)).toEqual([
      "is  raised [missing_context]: no intent",
    ]);
  });

  it("explain: an item's moves, and each attempt with where its trace is", () => {
    const f = compose({ home });
    f.ledger.addIssue(issue);
    f.ledger.end(
      "is",
      f.ledger.begin("is"),
      { word: "pass", reason: "the plan lints" },
      "planned",
      { usage: { cost: 0.01 } },
    );
    const lines = explain(f.ledger, f.runs, "is");
    expect(lines[0]).toBe("is (issue)  planned");
    expect(lines).toContainEqual(
      expect.stringMatching(/open -pass-> planned: the plan lints/),
    );
    expect(lines).toContainEqual("  1  open  pass: the plan lints  $0.0100");
    expect(lines).toContainEqual(
      `     trace: ${join(home, "runs", "is", "issue", "1", "trace.jsonl")}`,
    );
  });
});
