/**
 * top: the factory, live. A card for each issue not ended, its phase, time and spend on its border, red when Matt holds
 * it or one of its cls; inside, each cl on its stations (nail, hammer, review, land: done, at work, held there, or to
 * come), its attempts, turns, time and spend, the attempt open now (which try of its role, what its agent is doing,
 * its turns and tokens so far, how long since it last did anything), and why it last moved, with who said it; then
 * what each role has used on the issue, an open attempt's so far. Redrawn
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

/** The role that works an item at `step`: its step's agent, else the land. */
export const roleOf = (step: string) =>
  steps.find((s) => s.from === step)?.agent ??
  (step === "approved" ? "land" : step);

const sum = (rows: Used[], f: (u: Used) => number | null) =>
  rows.reduce((a, u) => a + (f(u) ?? 0), 0);

/** The states an item has ended in: an issue in one is left off the screen. */
const ended = new Set(["landed", "dropped", "accepted"]);
/** The states an item is held in, for Matt. */
const held = new Set(["raised", "escalated"]);

/** A cl's stations, in order: the state each starts from, and its name on the screen. */
const stations: [string, string][] = [
  ["ready", "nail"],
  ["red", "hammer"],
  ["green", "review"],
  ["approved", "land"],
];

const esc = String.fromCharCode(27);
const ansi = new RegExp(`${esc}\\[[0-9;]*m`, "g");
/** A color code at the start of a text. */
const lead = new RegExp(`^${esc}\\[[0-9;]*m`);
/** The text as the terminal shows it: no colors. */
const plain = (t: string) => t.replace(ansi, "");
/** How wide the text is on the terminal. */
const width = (t: string) => [...plain(t)].length;

/** The first line of a reason, plain. */
const firstLine = (t: string) => plain(t).split("\n")[0]?.trim() ?? "";

/** The text cut to `n` columns, its colors kept, with … where it was cut. */
function fit(t: string, n: number): string {
  if (width(t) <= n) return t;
  let out = "";
  let seen = 0;
  for (let i = 0; i < t.length;) {
    if (t[i] === esc) {
      const m = lead.exec(t.slice(i));
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (seen === n - 1) break;
    const ch = String.fromCodePoint(t.codePointAt(i) as number);
    out += ch;
    seen++;
    i += ch.length;
  }
  return `${out}…${esc}[0m`;
}

/** What the screen may use: its width in columns, and whether it colors. */
export interface Look {
  columns?: number;
  color?: boolean;
}

/**
 * The screen, as lines: the header, then a card for each issue not ended, with its cls on their stations, the attempt
 * open on each, why each last moved, and what each role has used on the issue. `runs` is where the traces are.
 */
export function screen(
  ledger: Ledger,
  runs: string,
  at: Date,
  version: string,
  look: Look = {},
): string[] {
  const columns = Math.max(60, look.columns ?? 100);
  const paint = (code: string) => (t: string) =>
    look.color ? `${esc}[${code}m${t}${esc}[0m` : t;
  const c = {
    dim: paint("2"),
    bold: paint("1"),
    green: paint("32"),
    yellow: paint("33"),
    red: paint("31"),
    cyan: paint("36"),
    // the station at work: bright and plain in turn, each second
    pulse: paint(at.getSeconds() % 2 ? "33" : "1;33"),
  };

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
  // an open attempt's tokens are its trace's so far; an ended one's, the ledger's
  const tokensIn = (u: Used) =>
    u.ended === null ? (traced(u)?.input ?? 0) : (u.tokens_in ?? 0);
  const tokensOut = (u: Used) =>
    u.ended === null ? (traced(u)?.output ?? 0) : (u.tokens_out ?? 0);
  const open = new Map(
    used.filter((u) => u.ended === null).map((u) => [u.name, u]),
  );
  /** Which try of its role an attempt is, on its item: 1 for the role's first. */
  const tryOf = (u: Used) =>
    used.filter(
      (x) =>
        x.name === u.name && roleOf(x.step) === roleOf(u.step) && x.n <= u.n,
    ).length;
  const live = (u: Used) => {
    const t = traced(u);
    const n = t?.turns ?? 0;
    const idle =
      t?.last === undefined ? undefined : (at.getTime() - t.last) / 1000;
    return [
      `${c.yellow("▶")} ${c.bold(roleOf(u.step))}`,
      `try ${tryOf(u)}`,
      since(u.started, at),
      `${n} turn${n === 1 ? "" : "s"}`,
      ...(idle === undefined
        ? []
        : [(idle > 120 ? c.red : c.dim)(`idle ${span(idle)}`)]),
      ...(t?.doing ? [`now ${c.cyan(t.doing)}`] : []),
      c.dim(`${tokens(t?.input ?? 0)} in · ${tokens(t?.output ?? 0)} out`),
    ].join(c.dim(" · "));
  };
  /** Why the item last moved: who said it, its word, its cause and its reason. */
  const why = (name: string) => {
    const last = ledger
      .events(name)
      .filter((e) => e.reason && e.word)
      .at(-1);
    if (!last) return undefined;
    const who =
      last.by === "matt"
        ? "Matt"
        : last.by === "attempt"
          ? roleOf(last.from_state)
          : "factory";
    const cause = last.cause ? ` [${last.cause}]` : "";
    return c.dim(
      `↳ ${who}, ${last.word ?? "moved"}${cause}: ${firstLine(last.reason ?? "")}`,
    );
  };
  /** A cl's stations: done, at work, held there, or to come. */
  const pipeline = (cl: Item) => {
    if (cl.state === "dropped") return c.dim("dropped");
    const at =
      cl.state === "landed"
        ? stations.length
        : held.has(cl.state)
          ? stations.findIndex(([s]) => s === ledger.prior(cl.name))
          : stations.findIndex(([s]) => s === cl.state);
    const parts = stations.map(([, name], i) =>
      i < at
        ? c.green(`✓ ${name}`)
        : i === at
          ? held.has(cl.state)
            ? c.red(`✗ ${name}`)
            : c.pulse(`● ${name}`)
          : c.dim(`○ ${name}`),
    );
    const line = parts
      .map((p, i) =>
        i === 0 ? p : `${i <= at ? c.green(" ━━ ") : c.dim(" ── ")}${p}`,
      )
      .join("");
    return cl.state === "waiting" ? `${c.dim("waiting ")}${line}` : line;
  };

  const inner = columns - 4;
  /** A card: its title on the top border, its lines inside, its border red when held. */
  const card = (
    title: string,
    right: string,
    body: string[],
    alarm: boolean,
  ) => {
    const edge = alarm ? c.red : c.dim;
    const room = columns - 7 - width(right);
    const head = fit(title, room);
    const fill = columns - 5 - width(head) - width(right) - 1;
    return [
      `${edge("┌ ")}${head}${edge(` ${"─".repeat(Math.max(1, fill))} `)}${right}${edge(" ┐")}`,
      ...body.map((l) => {
        const t = fit(l, inner);
        return `${edge("│")} ${t}${" ".repeat(Math.max(0, inner - width(t)))} ${edge("│")}`;
      }),
      edge(`└${"─".repeat(columns - 2)}┘`),
    ];
  };
  /** Cells padded to columns: the first left, the rest right. */
  const row = (cells: string[]) =>
    cells
      .map((t, i) =>
        i
          ? " ".repeat(Math.max(0, 9 - width(t))) + t
          : t + " ".repeat(Math.max(0, 14 - width(t))),
      )
      .join("");

  const issues = items.filter((i) => i.kind === "issue");
  const live_ = issues.filter((i) => !ended.has(i.state));
  const gone = issues.length - live_.length;
  const lines = [
    `${c.bold("assembly")} ${c.dim(version)}${" ".repeat(Math.max(1, columns - 30 - version.length))}${at.toTimeString().slice(0, 8)}   ${c.dim("spent")} ${money(sum(used, (u) => u.cost))}`,
    "",
  ];
  if (!live_.length)
    lines.push(
      c.dim(`nothing in the factory${gone ? `, ${gone} ended` : ""}`),
      "",
    );
  for (const issue of live_) {
    const cls = ledger.cls(issue.name);
    const all = used.filter((u) => byName.get(u.name)?.issue === issue.name);
    const left = cls
      .filter((x) => !ended.has(x.state))
      .map((x) => x.phase ?? 1);
    const last = Math.max(0, ...cls.map((x) => x.phase ?? 1));
    const phase = cls.length
      ? left.length
        ? `phase ${Math.min(...left)} of ${last}`
        : "every cl ended"
      : "";
    const body: string[] = [];
    const own = open.get(issue.name);
    if (own) body.push(live(own));
    if (held.has(issue.state) || issue.state === "waiting") {
      const w = why(issue.name);
      if (w) body.push(w);
    }
    for (const cl of cls) {
      const mine = used.filter((u) => u.name === cl.name);
      const n = mine.length;
      body.push("");
      const name = `${c.dim(`phase ${cl.phase ?? 1}`)}  ${c.bold(cl.name.replace(`${issue.name}-`, ""))}  ${cl.state}`;
      const stats = n
        ? c.dim(
            `${n} attempt${n === 1 ? "" : "s"} · ${turns(mine)} turns · ${span(took(mine))} · ${money(sum(mine, (u) => u.cost))}`,
          )
        : "";
      body.push(
        `${name}${" ".repeat(Math.max(2, inner - width(name) - width(stats)))}${stats}`,
      );
      body.push(`  ${pipeline(cl)}`);
      const o = open.get(cl.name);
      if (o) body.push(`  ${live(o)}`);
      if (
        held.has(cl.state) ||
        cl.state === "waiting" ||
        (n > 0 && !ended.has(cl.state))
      ) {
        const w = why(cl.name);
        if (w) body.push(`  ${w}`);
      }
    }
    // what each role has used on this issue, an open attempt's so far
    const roles = new Map<string, Used[]>();
    for (const u of all) {
      const r = roleOf(u.step);
      roles.set(r, [...(roles.get(r) ?? []), u]);
    }
    if (roles.size) {
      body.push("");
      body.push(
        c.dim(
          row([
            "role",
            "tries",
            "turns",
            "time",
            "in",
            "cached",
            "out",
            "cost",
          ]),
        ),
      );
      for (const [r, rows] of roles)
        body.push(
          row([
            r,
            `${rows.length}`,
            `${turns(rows)}`,
            span(took(rows)),
            tokens(rows.reduce((a, u) => a + tokensIn(u), 0)),
            tokens(sum(rows, (u) => u.cached_in)),
            tokens(rows.reduce((a, u) => a + tokensOut(u), 0)),
            money(sum(rows, (u) => u.cost)),
          ]),
        );
    }
    const alarm = held.has(issue.state) || cls.some((x) => held.has(x.state));
    const right = `${all.length ? `${span(took(all))}  ` : ""}${money(sum(all, (u) => u.cost))}`;
    lines.push(
      ...card(
        `${c.bold(issue.name)}  ${c.dim(issue.state)}${phase ? c.dim(` · ${phase}`) : ""}`,
        right,
        body,
        alarm,
      ),
      "",
    );
  }
  if (live_.length && gone) lines.push(c.dim(`${gone} ended, not shown`), "");
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
  const tty = Boolean(process.stdout.isTTY);
  const draw = () =>
    screen(f.ledger, f.runs, new Date(), v, {
      columns: process.stdout.columns,
      color: tty,
    });
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.log(draw().join("\n"));
    return;
  }
  const out = process.stdout;
  out.write("\x1b[?25l");
  const paint = () =>
    out.write(
      `\x1b[2J\x1b[H${[...draw(), `\x1b[2mq quits · refreshes every ${everyS}s\x1b[0m`].join("\n")}`,
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
