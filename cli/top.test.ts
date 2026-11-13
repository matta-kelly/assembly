import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compose } from "../main.ts";
import { roleOf, screen, since, tokens } from "./top.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "factory-"));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(home, { recursive: true, force: true });
});

const issue = {
  name: "is",
  path: "/work/is.md",
  repo: "/repo",
  image: "img",
  test: "suite",
};
const cl = (name: string, seq: number, phase: number) => ({
  ...issue,
  name,
  issue: "is",
  seq,
  phase,
});

describe("factory top", () => {
  it("shows each issue's phase and spend, each cl's attempts, the open attempt, and the use by role", () => {
    vi.useFakeTimers({ now: new Date("2026-11-12T15:00:00Z") });
    const { ledger } = compose({ home });
    ledger.addIssue(issue);
    ledger.addCl(cl("is-a", 1, 1), "ready");
    ledger.addCl(cl("is-b", 2, 2), "waiting");
    ledger.addCl(cl("is-c", 3, 3), "waiting");
    // is-a: da-nail passes it to red, da-hammer passes it to green
    ledger.apply(
      "is-a",
      { word: "pass", reason: "red at an assertion", findings: [] },
      {
        attempt: ledger.begin("is-a"),
        usage: { input: 400_000, cached: 380_000, output: 21_000, cost: 0.4 },
      },
    );
    ledger.apply(
      "is-a",
      { word: "pass", reason: "green", findings: [] },
      {
        attempt: ledger.begin("is-a"),
        usage: { input: 300_000, cached: 270_000, output: 18_000, cost: 0.5 },
      },
    );
    // cl-review's attempt on is-a, open now, begun at 15:00
    ledger.begin("is-a");
    const lines = screen(ledger, new Date("2026-11-12T15:03:12Z"), "v0.1.3");

    expect(lines[0]).toBe(
      `assembly v0.1.3 · ${new Date("2026-11-12T15:03:12Z").toTimeString().slice(0, 8)} · spent $0.90`,
    );
    expect(lines).toContain("ISSUE is   open   phase 1 of 3   $0.90");
    expect(lines).toContain(
      "  phase 1   is-a   green   3 attempts   $0.90   ▶ cl-review #3, 3m12s",
    );
    expect(lines).toContain("  phase 2   is-b   waiting");
    expect(lines).toContain("  phase 3   is-c   waiting");
    const role = (r: string) => lines.find((l) => l.startsWith(`  ${r} `));
    expect(role("da-nail")?.split(/\s+/).filter(Boolean)).toEqual([
      "da-nail",
      "1",
      "400k",
      "380k",
      "21k",
      "$0.40",
    ]);
    expect(role("da-hammer")?.split(/\s+/).filter(Boolean)).toEqual([
      "da-hammer",
      "1",
      "300k",
      "270k",
      "18k",
      "$0.50",
    ]);
    // the open attempt counts, with no use reported yet
    expect(role("cl-review")?.split(/\s+/).filter(Boolean)).toEqual([
      "cl-review",
      "1",
      "0",
      "0",
      "0",
      "$0.00",
    ]);
  });

  it("names the phase as landed when every cl of an issue has landed or dropped, and says when there is nothing", () => {
    const { ledger } = compose({ home });
    expect(screen(ledger, new Date(), "v0")).toContain("no issues yet");
    ledger.addIssue(issue);
    ledger.addCl(cl("is-a", 1, 1), "landed");
    ledger.addCl(cl("is-b", 2, 2), "dropped");
    expect(screen(ledger, new Date(), "v0")).toContain(
      "ISSUE is   open   all 2 phases landed   $0.00",
    );
  });

  it("writes tokens and times short", () => {
    expect([tokens(950), tokens(12_400), tokens(1_250_000)]).toEqual([
      "950",
      "12k",
      "1.3M",
    ]);
    const at = new Date("2026-11-12T16:02:05Z");
    expect([
      since("2026-11-12T16:01:20Z", at),
      since("2026-11-12T15:58:53Z", at),
      since("2026-11-12T14:59:00Z", at),
    ]).toEqual(["45s", "3m12s", "1h03m"]);
  });

  it("names each step's role by the agent that works it, and the land by its step", () => {
    expect(["ready", "red", "green", "open", "approved"].map(roleOf)).toEqual([
      "da-nail",
      "da-hammer",
      "cl-review",
      "planner",
      "approved",
    ]);
  });
});
