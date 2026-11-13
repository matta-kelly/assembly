/**
 * top: the factory, live. Each issue with its phase, its time and its spend, then its cls: each one's state, attempts,
 * turns and time, the attempt open now (what its agent is doing, its turns and tokens so far, how long since it last
 * did anything), and why it last moved when it waits or is stuck; then what each role has used on that issue. Redrawn
 * every few seconds until `q` or ctrl-c. The ledger gives the items and attempts; each attempt's trace gives its turns,
 * its tokens so far and its last event. With no terminal, it prints the screen once.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runOf } from "../effects/runs.ts";
import type { Built } from "../main.ts";
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

/** What an attempt's trace says so far. */
export interface Traced {
  turns: number; // model turns: one chat span each
  input: number; // the input tokens of those turns, cached ones included
  output: number;
  last?: number; // when its last span ended, in ms
  doing?: string; // what that last span was: a tool's name, or "model" for a model turn
}

type Span = {
  name?: string;
  endTimeUnixNano?: string;
  attributes?: { key: string; value?: { intValue?: string | number } }[];
};

const attr = (sp: Span, key: string) =>
  Number(sp.attributes?.find((a) => a.key === key)?.value?.intValue ?? 0);

/** Reads an attempt's trace, as far as it is written. No file, or a line it cannot parse: nothing from it. */
export function traceOf(file: string): Traced {
  const t: Traced = { turns: 0, input: 0, output: 0 };
  if (!existsSync(file)) return t;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let req: { resourceSpans?: { scopeSpans?: { spans?: Span[] }[] }[] };
    try {
      req = JSON.parse(line);
    } catch {
      continue;
    }
    for (const rs of req.resourceSpans ?? [])
      for (const ss of rs.scopeSpans ?? [])
        for (const sp of ss.spans ?? []) {
          const name = sp.name ?? "";
          if (name.startsWith("chat ")) {
            t.turns++;
            t.input += attr(sp, "gen_ai.usage.input_tokens");
            t.output += attr(sp, "gen_ai.usage.output_tokens");
          }
          const end = Number(BigInt(sp.endTimeUnixNano ?? "0") / 1_000_000n);
          if (end && (t.last === undefined || end >= t.last)) {
            t.last = end;
            t.doing = name.startsWith("chat ")
              ? "model"
              : name.replace(/^execute_tool /, "");
          }
        }
  }
  return t;
}

/** The role that works an item at `step`: its step's agent, else the step itself (the land). */
export const roleOf = (step: string) =>
  steps.find((s) => s.from === step)?.agent ?? step;

const sum = (rows: Used[], f: (u: Used) => number | null) =>
  rows.reduce((a, u) => a + (f(u) ?? 0), 0);

/** The states an item waits or is stuck in: its last move's reason is shown under it. */
const waits = new Set(["waiting", "raised", "escalated"]);

/** The first line of a reason, with no terminal colors, cut at 110 characters. */
const firstLine = (s: string) => {
  const line =
    s
      .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "")
      .split("\n")[0]
      ?.trim() ?? "";
  return line.length > 110 ? `${line.slice(0, 109)}…` : line;
};

/** The screen, as lines: the header, then each issue, its cls and its use by role. `runs` is where the traces are. */
export function screen(
  ledger: Ledger,
  runs: string,
  at: Date,
  version: string,
): string[] {
  const used = ledger.usage();
  const items = ledger.items();
  const byName = new Map(items.map((i) => [i.name, i]));
  const traces = new Map(
    used.map((u) => {
      const i = byName.get(u.name) as Item;
      return [
        `${u.name}/${u.n}`,
        traceOf(join(runOf(i, u.n, runs).dir, "trace.jsonl")),
      ];
    }),
  );
  const traced = (u: Used) => traces.get(`${u.name}/${u.n}`);
  const turns = (rows: Used[]) =>
    rows.reduce((a, u) => a + (traced(u)?.turns ?? 0), 0);
  const took = (rows: Used[]) =>
    rows.reduce(
      (a, u) =>
        a +
        ((u.ended ? Date.parse(u.ended) : at.getTime()) -
          Date.parse(u.started)) /
          1000,
      0,
    );
  const open = new Map(
    used.filter((u) => u.ended === null).map((u) => [u.name, u]),
  );
  const live = (u: Used) => {
    const t = traced(u);
    const n = t?.turns ?? 0;
    return [
      `▶ ${roleOf(u.step)} #${u.n}`,
      since(u.started, at),
      `${n} turn${n === 1 ? "" : "s"}`,
      ...(t?.last === undefined
        ? []
        : [`idle ${span((at.getTime() - t.last) / 1000)}`]),
      ...(t?.doing ? [`now: ${t.doing}`] : []),
      `${tokens(t?.input ?? 0)} in, ${tokens(t?.output ?? 0)} out`,
    ].join("   ");
  };
  const why = (name: string) => {
    const last = ledger
      .events(name)
      .filter((e) => e.reason)
      .at(-1);
    if (!last) return undefined;
    const cause = last.cause ? ` [${last.cause}]` : "";
    return `↳ ${last.word ?? "moved"}${cause}: ${firstLine(last.reason ?? "")}`;
  };
  const row = (cells: string[]) =>
    cells.map((c, i) => (i ? c.padStart(10) : c.padEnd(18))).join("");

  const lines = [
    `assembly ${version} · ${at.toTimeString().slice(0, 8)} · spent ${money(sum(used, (u) => u.cost))}`,
    "",
  ];
  const issues = items.filter((i) => i.kind === "issue");
  if (!issues.length) lines.push("no issues yet", "");
  for (const issue of issues) {
    const cls = ledger.cls(issue.name);
    const all = used.filter((u) => byName.get(u.name)?.issue === issue.name);
    const left = cls
      .filter((c) => c.state !== "landed" && c.state !== "dropped")
      .map((c) => c.phase ?? 1);
    const last = Math.max(0, ...cls.map((c) => c.phase ?? 1));
    const shipped = cls.length > 0 && !left.length;
    const phase = cls.length
      ? left.length
        ? `phase ${Math.min(...left)} of ${last}`
        : `shipped: all ${last} phases landed`
      : "";
    lines.push(
      [
        `ISSUE ${issue.name}`,
        issue.state,
        phase,
        all.length ? span(took(all)) : "",
        money(sum(all, (u) => u.cost)),
      ]
        .filter(Boolean)
        .join("   "),
    );
    const own = open.get(issue.name);
    if (own) lines.push(`    ${live(own)}`);
    if (waits.has(issue.state)) {
      const w = why(issue.name);
      if (w) lines.push(`    ${w}${shipped ? " (its cls are shipped)" : ""}`);
    }
    for (const c of cls) {
      const mine = used.filter((u) => u.name === c.name);
      const n = mine.length;
      lines.push(
        [
          `  phase ${c.phase ?? 1}`,
          c.name,
          c.state,
          n ? `${n} attempt${n === 1 ? "" : "s"}` : "",
          n ? `${turns(mine)} turns` : "",
          n ? span(took(mine)) : "",
          n ? money(sum(mine, (u) => u.cost)) : "",
        ]
          .filter(Boolean)
          .join("   "),
      );
      const o = open.get(c.name);
      if (o) lines.push(`    ${live(o)}`);
      // why it is where it is: when it waits or is stuck, or was sent round again at its step
      const done = c.state === "landed" || c.state === "dropped";
      if (waits.has(c.state) || (n > 1 && !done)) {
        const w = why(c.name);
        if (w) lines.push(`    ${w}`);
      }
    }
    // what each role has used on this issue
    const roles = new Map<string, Used[]>();
    for (const u of all) {
      const r = roleOf(u.step);
      roles.set(r, [...(roles.get(r) ?? []), u]);
    }
    if (roles.size) {
      lines.push(
        row([
          "  by role",
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
            `    ${r}`,
            `${rows.length}`,
            `${turns(rows)}`,
            span(took(rows)),
            tokens(sum(rows, (u) => u.tokens_in)),
            tokens(sum(rows, (u) => u.cached_in)),
            tokens(sum(rows, (u) => u.tokens_out)),
            money(sum(rows, (u) => u.cost)),
          ]),
        );
    }
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
