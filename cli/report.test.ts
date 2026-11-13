import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compose } from "../main.ts";
import { main } from "./index.ts";
import { blocked, explain, status } from "./report.ts";
import * as top from "./top.ts";

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
    expect(status(ledger, "v1.2.3")).toEqual([
      "assembly v1.2.3",
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
    expect(status(ledger, "v1.2.3").slice(1, 4)).toEqual([
      "is  open",
      "  is-one  ready",
      "two  open",
    ]);
  });

  it("status: opens with `assembly <version>` and keeps the report as today", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(top, "version").mockReturnValue("v7");
    const { ledger } = compose({ home });
    ledger.addIssue(issue);
    await main(["status"], { ASSEMBLY_HOME: home });
    expect(log).toHaveBeenCalledOnce();
    const lines = log.mock.calls[0]![0].split("\n");
    expect(lines[0]).toBe("assembly v7");
    expect(lines.slice(1)).toEqual([
      "is  open",
      "",
      "open attempts: none",
      "spent: $0.0000",
    ]);
  });

  it("status: the version it opens with is the one the factory runs", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const ran = vi.spyOn(top, "version").mockReturnValue("v9.9.9");
    await main(["status"], { ASSEMBLY_HOME: home });
    expect(ran).toHaveBeenCalled();
    expect(log.mock.calls[0]![0].split("\n")[0]).toBe("assembly v9.9.9");
  });

  it("status: opens with `assembly unknown` when git cannot describe the checkout", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(top, "version").mockReturnValue("unknown");
    await main(["status"], { ASSEMBLY_HOME: home });
    expect(log.mock.calls[0]![0].split("\n")[0]).toBe("assembly unknown");
  });

  describe("blocked: how long ago each item was raised", () => {
    const T0 = Date.parse("2025-06-01T12:00:00Z");
    const SECOND = 1_000;
    const MINUTE = 60 * SECOND;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(T0);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const raise = (
      ledger: ReturnType<typeof compose>["ledger"],
      reason: string,
    ) => {
      ledger.addIssue(issue);
      ledger.apply(
        "is",
        { word: "back", reason, findings: [] },
        { attempt: ledger.begin("is") },
      );
    };

    it("says `nothing is blocked` when nothing is raised or escalated", () => {
      const { ledger } = compose({ home });
      expect(blocked(ledger)).toEqual(["nothing is blocked"]);
    });

    it("says `nothing is blocked` when an item moved on instead of waiting", () => {
      const { ledger } = compose({ home });
      ledger.addIssue(issue);
      ledger.apply(
        "is",
        { word: "pass", reason: "the plan lints", findings: [] },
        { attempt: ledger.begin("is") },
      );
      expect(blocked(ledger)).toEqual(["nothing is blocked"]);
    });

    it.each([
      ["0s", 0, "0s ago"],
      ["12s", 12 * SECOND, "12s ago"],
      ["45s", 45 * SECOND, "45s ago"],
      ["59s", 59 * SECOND, "59s ago"],
      ["1m", MINUTE, "1m ago"],
      ["4m", 4 * MINUTE, "4m ago"],
      ["59m 59s", 59 * MINUTE + 59 * SECOND, "59m ago"],
      ["1h", HOUR, "1h ago"],
      ["3h", 3 * HOUR, "3h ago"],
      ["23h 59m 59s", 23 * HOUR + 59 * MINUTE + 59 * SECOND, "23h ago"],
      ["1d", DAY, "1d ago"],
      ["2d", 2 * DAY, "2d ago"],
      ["365d", 365 * DAY, "365d ago"],
    ])(
      "ends the line with the short age of an item last moved %s ago",
      (_label, age, expected) => {
        const { ledger } = compose({ home });
        raise(ledger, "back, about the issue");
        vi.setSystemTime(T0 + age);
        expect(blocked(ledger)).toEqual([
          `is  raised: back, about the issue ${expected}`,
        ]);
      },
    );

    it("ages an item from its last move, not its first", () => {
      const { ledger } = compose({ home });
      ledger.addIssue(issue);
      ledger.apply(
        "is",
        { word: "pass", reason: "the plan lints", findings: [] },
        { attempt: ledger.begin("is") },
      );
      vi.setSystemTime(T0 + 2 * DAY);
      ledger.apply(
        "is",
        { word: "back", reason: "back, about the plan", findings: [] },
        { attempt: ledger.begin("is") },
      );
      vi.setSystemTime(T0 + 2 * DAY + 3 * HOUR);
      expect(blocked(ledger)).toEqual([
        "is  raised: back, about the plan 3h ago",
      ]);
    });

    it("keeps the cause with the state, before the age", () => {
      const { ledger } = compose({ home });
      ledger.addIssue(issue);
      ledger.apply(
        "is",
        {
          word: "back",
          reason: "back, about the issue",
          findings: [],
          cause: "check_failed",
        },
        { attempt: ledger.begin("is") },
      );
      vi.setSystemTime(T0 + 4 * MINUTE);
      expect(blocked(ledger)).toEqual([
        "is  raised [check_failed]: back, about the issue 4m ago",
      ]);
    });

    it("gives each waiting item its own line with its own age", () => {
      const { ledger } = compose({ home });
      ledger.addIssue(issue);
      ledger.apply(
        "is",
        { word: "back", reason: "back, about the issue", findings: [] },
        { attempt: ledger.begin("is") },
      );
      vi.setSystemTime(T0 + 2 * DAY);
      ledger.addIssue({ ...issue, name: "two" });
      ledger.apply(
        "two",
        { word: "back", reason: "back, about the plan", findings: [] },
        { attempt: ledger.begin("two") },
      );
      vi.setSystemTime(T0 + 2 * DAY + 4 * MINUTE);
      expect(blocked(ledger)).toEqual([
        "is  raised: back, about the issue 2d ago",
        "two  raised: back, about the plan 4m ago",
      ]);
    });
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
