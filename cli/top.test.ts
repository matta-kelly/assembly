import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compose } from "../main.ts";
import { runOf } from "../effects/runs.ts";
import type { Item } from "../orchestrator/ledger.ts";
import { roleOf, screen, since, tokens, traceOf } from "./top.ts";

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

/** One OTLP export line of spans with these names, the last of them ending at `lastEnd`. */
const spans = (names: string[], lastEnd: string) => {
  const end = BigInt(Date.parse(lastEnd)) * 1_000_000n;
  return JSON.stringify({
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: names.map((name, i) => ({
              name,
              endTimeUnixNano: String(
                end - BigInt(names.length - 1 - i) * 1_000_000_000n,
              ),
              ...(name.startsWith("chat ")
                ? {
                    attributes: [
                      {
                        key: "gen_ai.usage.input_tokens",
                        value: { intValue: "1000" },
                      },
                      {
                        key: "gen_ai.usage.output_tokens",
                        value: { intValue: 100 },
                      },
                    ],
                  }
                : {}),
            })),
          },
        ],
      },
    ],
  });
};

let runsOf = "";
/** Writes an attempt's trace where the factory keeps it. */
const trace = (item: Item, n: number, names: string[], lastEnd: string) => {
  const dir = runOf(item, n, runsOf).dir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "trace.jsonl"), spans(names, lastEnd) + "\n");
};

describe("factory top", () => {
  it("shows each issue's phase, time and spend, each cl's attempts, turns and time, the open attempt live, and the use by role", () => {
    vi.useFakeTimers({ now: new Date("2026-11-12T15:00:00Z") });
    const f = compose({ home });
    runsOf = f.runs;
    const { ledger } = f;
    ledger.addIssue(issue);
    ledger.addCl(cl("is-a", 1, 1), "ready");
    ledger.addCl(cl("is-b", 2, 2), "waiting");
    ledger.addCl(cl("is-c", 3, 3), "waiting");
    // is-a: da-nail, 15:00 to 15:02, passes it to red; da-hammer, 15:02 to 15:05, passes it to green
    const nail = ledger.begin("is-a");
    vi.setSystemTime(new Date("2026-11-12T15:02:00Z"));
    ledger.apply(
      "is-a",
      { word: "pass", reason: "red at an assertion", findings: [] },
      {
        attempt: nail,
        usage: { input: 400_000, cached: 380_000, output: 21_000, cost: 0.4 },
      },
    );
    const hammer = ledger.begin("is-a");
    vi.setSystemTime(new Date("2026-11-12T15:05:00Z"));
    ledger.apply(
      "is-a",
      { word: "pass", reason: "green", findings: [] },
      {
        attempt: hammer,
        usage: { input: 300_000, cached: 270_000, output: 18_000, cost: 0.5 },
      },
    );
    // cl-review's attempt, open since 15:05: two model turns and a tool call so far, the last ending at 15:08:04
    const review = ledger.begin("is-a");
    const item = ledger.items().find((i) => i.name === "is-a")!;
    trace(
      item,
      nail,
      ["chat m", "chat m", "execute_tool read", "chat m"],
      "2026-11-12T15:01:50Z",
    );
    trace(
      item,
      review,
      ["chat m", "execute_tool bash", "chat m"],
      "2026-11-12T15:08:04Z",
    );
    const at = new Date("2026-11-12T15:08:12Z");
    const lines = screen(ledger, f.runs, at, "v0.1.3");

    expect(lines[0]).toBe(
      `assembly v0.1.3 · ${at.toTimeString().slice(0, 8)} · spent $0.90`,
    );
    expect(lines).toContain("ISSUE is   open   phase 1 of 3   8m12s   $0.90");
    // the cl, then its open attempt live: what it does now, its turns and tokens so far; then why it moved last
    const i = lines.indexOf(
      "  phase 1   is-a   green   3 attempts   5 turns   8m12s   $0.90",
    );
    expect(i).toBeGreaterThan(0);
    expect(lines.slice(i + 1, i + 3)).toEqual([
      "    ▶ cl-review #3   3m12s   2 turns   idle 8s   now: model   2k in, 200 out",
      "    ↳ pass: green",
    ]);
    expect(lines).toContain("  phase 2   is-b   waiting");
    expect(lines).toContain("  phase 3   is-c   waiting");
    const role = (r: string) =>
      lines
        .find((l) => l.startsWith(`    ${r} `))
        ?.split(/\s+/)
        .filter(Boolean);
    expect(role("da-nail")).toEqual([
      "da-nail",
      "1",
      "3",
      "2m00s",
      "400k",
      "380k",
      "21k",
      "$0.40",
    ]);
    expect(role("da-hammer")).toEqual([
      "da-hammer",
      "1",
      "0",
      "3m00s",
      "300k",
      "270k",
      "18k",
      "$0.50",
    ]);
    // the open attempt counts, with its turns so far and no use reported yet
    expect(role("cl-review")).toEqual([
      "cl-review",
      "1",
      "2",
      "3m12s",
      "0",
      "0",
      "0",
      "$0.00",
    ]);
  });

  it("shows why a cl waits or is stuck, and the last tool an attempt ran", () => {
    const f = compose({ home });
    runsOf = f.runs;
    const { ledger } = f;
    ledger.addIssue(issue);
    ledger.addCl(cl("is-a", 1, 1), "ready");
    ledger.apply(
      "is-a",
      {
        word: "escalate",
        reason: "the setup failed: no zod\nmore",
        findings: [],
      },
      "orchestrator",
    );
    const lines = screen(ledger, f.runs, new Date(), "v0");
    expect(lines).toContain("    ↳ escalate: the setup failed: no zod");
    const dir = join(home, "t.jsonl");
    writeFileSync(
      dir,
      spans(["chat m", "execute_tool bash"], "2026-11-12T15:00:00Z") + "\n",
    );
    expect(traceOf(dir).doing).toBe("bash");
  });

  it("reads an attempt with no trace yet as no turns and no idle time, and skips a line it cannot parse", () => {
    expect(traceOf(join(home, "missing.jsonl"))).toEqual({
      turns: 0,
      input: 0,
      output: 0,
    });
    const file = join(home, "trace.jsonl");
    writeFileSync(
      file,
      "not json\n" + spans(["chat m"], "2026-11-12T15:00:00Z") + "\n",
    );
    expect(traceOf(file)).toEqual({
      turns: 1,
      input: 1000,
      output: 100,
      last: Date.parse("2026-11-12T15:00:00Z"),
      doing: "model",
    });
  });

  it("names the phase as landed when every cl of an issue has landed or dropped, and says when there is nothing", () => {
    const { ledger, runs } = compose({ home });
    expect(screen(ledger, runs, new Date(), "v0")).toContain("no issues yet");
    ledger.addIssue(issue);
    ledger.addCl(cl("is-a", 1, 1), "landed");
    ledger.addCl(cl("is-b", 2, 2), "dropped");
    expect(screen(ledger, runs, new Date(), "v0")).toContain(
      "ISSUE is   open   shipped: all 2 phases landed   $0.00",
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
