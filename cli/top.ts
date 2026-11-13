/**
 * top: the factory, live. Each issue with its phase, its time and its spend, each cl with its state, its attempts and
 * the one open now (its turns, and how long since its agent last did anything), and what each role has used, redrawn
 * every few seconds until `q` or ctrl-c. The ledger gives the items and attempts; each attempt's trace gives its turns
 * and its last event. With no terminal, it prints the screen once.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Built } from "../main.ts";
import { runOf } from "../effects/runs.ts";
import type { Item, Ledger, Used } from "../orchestrator/ledger.ts";
import { steps } from "../process/index.ts";

const money = (n: number) => `$${n.toFixed(2)}`;

/** A count of tokens, short: 950, 12k, 1.2M. */
export const tokens = (n: number) =>
  n < 1000
    ? `${n}`
    : n < 1_000_000
      ? `${Math.round(n / 1000)}k`
      : `${(n / 1_000_000).toFixed(1)}M`;

/** A span of seconds, short: 45s, 3m12s, 1h02m. */
export const span = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600)
    return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
};

/** How long since `from`: 45s, 3m12s, 1h02m. */
export const since = (from: string, at: Date) =>
  span((at.getTime() - Date.parse(from)) / 1000);

/** What an attempt's trace says so far: its model turns (one chat span each), and when its last span ended, in ms. */
export function traceOf(file: string): { turns: number; last?: number } {
  if (!existsSync(file)) return { turns: 0 };
  let turns = 0;
  let last: number | undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let req: {
      resourceSpans?: {
        scopeSpans?: {
          spans?: { name?: string; endTimeUnixNano?: string }[];
        }[];
      }[];
    };
    try {
      req = JSON.parse(line);
    } catch {
      continue;
    }
    for (const rs of req.resourceSpans ?? [])
      for (const ss of rs.scopeSpans ?? [])
        for (const sp of ss.spans ?? []) {
          if (sp.name?.startsWith("chat ")) turns++;
          const end = Number(BigInt(sp.endTimeUnixNano ?? "0") / 1_000_000n);
          if (end && (last === undefined || end > last)) last = end;
        }
  }
  return last === undefined ? { turns } : { turns, last };
}

/** The role that works an item at `step`: its step's agent, else the step itself (the land). */
export const roleOf = (step: string) =>
  steps.find((s) => s.from === step)?.agent ?? step;

const sum = (rows: Used[], f: (u: Used) => number | null) =>
  rows.reduce((a, u) => a + (f(u) ?? 0), 0);

/** The screen, as lines: the header, each issue and its cls, then the use by role. `runs` is where the traces are. */
export function screen(
  ledger: Ledger,
  runs: string,
  at: Date,
  version: string,
): string[] {
  const used = ledger.usage();
  const items = ledger.items();
  const byName = new Map(items.map((i) => [i.name, i]));
  // each attempt's trace, read once a redraw: its turns and the end of its last span
  const traces = new Map(
    used.map((u) => {
      const i = byName.get(u.name) as Item;
      return [
        `${u.name}/${u.n}`,
        traceOf(join(runOf(i, u.n, runs).dir, "trace.jsonl")),
      ];
    }),
  );
  const turns = (rows: Used[]) =>
    rows.reduce((a, u) => a + (traces.get(`${u.name}/${u.n}`)?.turns ?? 0), 0);
  const took = (rows: Used[]) =>
    rows.reduce(
      (a, u) =>
        a +
        ((u.ended ? Date.parse(u.ended) : at.getTime()) -
          Date.parse(u.started)) /
          1000,
      0,
    );
  const live = (u: Used) => {
    const t = traces.get(`${u.name}/${u.n}`);
    const idle =
      t?.last === undefined
        ? ""
        : `, idle ${span((at.getTime() - t.last) / 1000)}`;
    return `▶ ${roleOf(u.step)} #${u.n}, ${since(u.started, at)}, ${t?.turns ?? 0} turns${idle}`;
  };
  const issueOf = new Map(items.map((i) => [i.name, i.issue]));
  const open = new Map(
    used.filter((u) => u.ended === null).map((u) => [u.name, u]),
  );
  const time = at.toTimeString().slice(0, 8);
  const lines = [
    `assembly ${version} · ${time} · spent ${money(sum(used, (u) => u.cost))}`,
    "",
  ];

  const issues = items.filter((i) => i.kind === "issue");
  if (!issues.length) lines.push("no issues yet", "");
  for (const issue of issues) {
    const cls = ledger.cls(issue.name);
    const all = used.filter((u) => issueOf.get(u.name) === issue.name);
    const spend = sum(all, (u) => u.cost);
    const left = cls
      .filter((c) => c.state !== "landed" && c.state !== "dropped")
      .map((c) => c.phase ?? 1);
    const last = Math.max(0, ...cls.map((c) => c.phase ?? 1));
    const phase = cls.length
      ? left.length
        ? `phase ${Math.min(...left)} of ${last}`
        : `all ${last} phases landed`
      : "";
    lines.push(
      [
        `ISSUE ${issue.name}`,
        issue.state,
        phase,
        all.length ? span(took(all)) : "",
        money(spend),
      ]
        .filter(Boolean)
        .join("   "),
    );
    const now = open.get(issue.name);
    if (now) lines.push(`  ${live(now)}`);
    for (const c of cls) {
      const mine = used.filter((u) => u.name === c.name);
      const n = mine.length;
      const parts = [
        `  phase ${c.phase ?? 1}`,
        c.name,
        c.state,
        n ? `${n} attempt${n === 1 ? "" : "s"}` : "",
        n ? `${turns(mine)} turns` : "",
        n ? span(took(mine)) : "",
        n ? money(sum(mine, (u) => u.cost)) : "",
      ];
      const o = open.get(c.name);
      if (o) parts.push(live(o));
      lines.push(parts.filter(Boolean).join("   "));
    }
    lines.push("");
  }

  const roles = new Map<string, Used[]>();
  for (const u of used) {
    const r = roleOf(u.step);
    roles.set(r, [...(roles.get(r) ?? []), u]);
  }
  if (roles.size) {
    const row = (cells: string[]) =>
      cells.map((c, i) => (i ? c.padStart(10) : c.padEnd(16))).join("");
    lines.push(
      row([
        "BY ROLE",
        "attempts",
        "turns",
        "time",
        "tokens in",
        "cached",
        "out",
        "cost",
      ]),
    );
    for (const [r, rows] of roles)
      lines.push(
        row([
          `  ${r}`,
          `${rows.length}`,
          `${turns(rows)}`,
          span(took(rows)),
          tokens(sum(rows, (u) => u.tokens_in)),
          tokens(sum(rows, (u) => u.cached_in)),
          tokens(sum(rows, (u) => u.tokens_out)),
          money(sum(rows, (u) => u.cost)),
        ]),
      );
    lines.push("");
  }
  return lines;
}

/** The version the factory runs: `git describe` of its own checkout, or "unknown" when git cannot say. */
export function version(): string {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    return execFileSync("git", ["-C", root, "describe", "--tags", "--always"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

/** Redraws the screen every `everyS` seconds until `q`, ctrl-c or a signal. With no terminal, prints it once. */
export async function top(f: Built, everyS: number) {
  const v = version();
  const draw = () => screen(f.ledger, f.runs, new Date(), v);
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.log(draw().join("\n"));
    return;
  }
  const out = process.stdout;
  out.write("\x1b[?25l");
  const paint = () =>
    out.write(
      `\x1b[2J\x1b[H${[...draw(), `q quits · refreshes every ${everyS}s`].join("\n")}`,
    );
  paint();
  const timer = setInterval(paint, everyS * 1000);
  await new Promise<void>((done) => {
    const stop = () => {
      clearInterval(timer);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      out.write("\x1b[?25h\n");
      done();
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (k) => {
      const key = k.toString();
      if (key === "q" || key === "\u0003") stop();
    });
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}
