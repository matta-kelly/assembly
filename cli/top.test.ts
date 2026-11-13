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

const issue = { name: "is", note: "_well/is.md", repos: ["/repo"] };
const cl = (name: string, seq: number, phase: number) => ({
  name,
  issue: "is",
  seq,
  phase,
  note: `_well/${name}.md`,
  repo: "/repo",
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

/** The lines inside the screen's cards, without their borders or the padding to them. */
const inside = (lines: string[]) =>
  lines.filter((l) => l.startsWith("│")).map((l) => l.slice(2, -2).trimEnd());

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
    const body = inside(lines);

    expect(lines[0]).toMatch(
      /^assembly v0\.1\.3 +\d\d:\d\d:\d\d {3}spent \$0\.90$/,
    );
    // the card: the issue, its state and phase on its border, its time and spend on the right
    expect(lines[2]).toMatch(
      /^┌ is {2}open · phase 1 of 3 ─+ 8m12s {2}\$0\.90 ┐$/,
    );
    // the cl, its stations, its open attempt live (which try of its role), then why it moved last and who said it
    const i = body.findIndex((l) => l.startsWith("phase 1  a  green"));
    expect(body[i]).toMatch(/3 attempts · 5 turns · 8m12s · \$0\.90$/);
    expect(body.slice(i + 1, i + 4)).toEqual([
      "  ✓ nail ━━ ✓ hammer ━━ ● review ── ○ land",
      "  ▶ cl-review · try 1 · 3m12s · 2 turns · idle 8s · now model · 2k in · 200 out",
      "  ↳ da-hammer, pass: green",
    ]);
    expect(body).toContain("phase 2  b  waiting");
    expect(body).toContain(
      "  waiting ○ nail ── ○ hammer ── ○ review ── ○ land",
    );
    const role = (r: string) =>
      body
        .find((l) => l.startsWith(`${r} `))
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
    // the open attempt counts, with its turns and tokens so far from its trace, and no cost reported yet
    expect(role("cl-review")).toEqual([
      "cl-review",
      "1",
      "2",
      "3m12s",
      "2k",
      "0",
      "200",
      "$0.00",
    ]);
  });

  it("shows a held cl at its station, why it is held, and the last tool an attempt ran", () => {
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
    const body = inside(screen(ledger, f.runs, new Date(), "v0"));
    // held at the station it was stopped at, with why
    expect(body).toContain("  ✗ nail ── ○ hammer ── ○ review ── ○ land");
    expect(body).toContain("  ↳ factory, escalate: the setup failed: no zod");
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

  it("shows only the issues not ended, says how many ended, and when every cl of one has ended", () => {
    const { ledger, runs } = compose({ home });
    expect(screen(ledger, runs, new Date(), "v0")).toContain(
      "nothing in the factory",
    );
    ledger.addIssue(issue);
    ledger.addCl(cl("is-a", 1, 1), "landed");
    ledger.addCl(cl("is-b", 2, 2), "dropped");
    ledger.addIssue({ ...issue, name: "old", note: "_well/old.md" });
    ledger.apply("old", { word: "drop", reason: "r", findings: [] }, "matt");
    const lines = screen(ledger, runs, new Date(), "v0");
    expect(lines.some((l) => l.startsWith("┌ is  open · every cl ended"))).toBe(
      true,
    );
    expect(lines.some((l) => l.includes("old"))).toBe(false);
    expect(lines).toContain("1 ended, not shown");
    expect(inside(lines)).toContain(
      "  ✓ nail ━━ ✓ hammer ━━ ✓ review ━━ ✓ land",
    );
  });

  it("colors the stations, and cuts a line to one column short of the screen's width, its colors kept", () => {
    const { ledger, runs } = compose({ home });
    ledger.addIssue({ ...issue, name: "a-very-long-issue-name-".repeat(5) });
    const lines = screen(ledger, runs, new Date(), "v0", {
      columns: 61,
      color: true,
    });
    const width = (l: string) =>
      [
        ...l.replace(
          new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
          "",
        ),
      ].length;
    for (const l of lines.filter((x) => x.includes("┌") || x.includes("└")))
      expect(width(l)).toBe(60);
    expect(lines.join("\n")).toContain(`${String.fromCharCode(27)}[`);
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

  it("names each step's role by the agent that works it, and the land as the land", () => {
    expect(["ready", "red", "green", "open", "approved"].map(roleOf)).toEqual([
      "da-nail",
      "da-hammer",
      "cl-review",
      "planner",
      "land",
    ]);
  });
});
