/**
 * The ledger: where each item stands, its attempts, and an event for every move, in SQLite. It is the only state the
 * orchestrator holds, so a killed orchestrator starts again from it with nothing lost. An item is an issue, or one of
 * its cls. It holds no content: what to build is the notes, and what was built is each item's branch. Each attempt
 * keeps the agent's result and the notes' commit it read, and each event is a message: the word that moved the item,
 * why, and its findings, so every trial's record is here.
 */

import { DatabaseSync } from "node:sqlite";
import { basename } from "node:path";
import {
  causes,
  type CheckRun,
  type Finding,
  type Message,
} from "../process/step.ts";
import { next, type State } from "../process/table.ts";
import { newSpan, type SpanRef } from "../effects/trace.ts";

/** An item the factory moves: where it stands, its note, and the repos it changes. */
export interface Item {
  name: string; // the issue's name, or the cl's: <issue>-<cut>
  kind: "issue" | "cl";
  issue: string; // the issue it is, or belongs to
  seq: number; // a cl's place in its plan's order, from 1. 0 for an issue
  phase: number | null; // a cl's phase in its plan, from 1; null for an issue, and 1 for a lone cl
  note: string; // its note, from the notes repo's root: _well/<name>.md
  repo: string; // the repo it changes: an issue's first, when it has several
  repos: string[]; // an issue's repos when it has more than one, else none; a cl's always none
  state: State;
  landed: string | null; // the commit main took for it, once it landed
}

/** What an attempt's model calls used, when the run reports it. */
export interface Usage {
  tokens?: number;
  cost?: number;
  input?: number; // input tokens, cached ones included
  output?: number;
  cached?: number; // input tokens read from the cache
}

/** An attempt not ended yet: its run is going, or a killed orchestrator left it. */
export interface Open {
  name: string;
  n: number;
  step: State;
}

/** An attempt as the factory reports it. Its word, reason and cause are null while it is open. */
export interface Attempt {
  n: number;
  step: State;
  started: string;
  ended: string | null;
  resumed: number;
  word: string | null;
  reason: string | null;
  cause: string | null;
  cost: number | null;
  notes: string | null; // the commit of the notes' main it read
}

/** What one attempt used. Its tokens and cost are null while it is open, or when its run reported none. */
export interface Used {
  name: string;
  n: number;
  step: State;
  started: string;
  ended: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cached_in: number | null;
  cost: number | null;
}

/** Who sends a message: an agent's attempt as it ends, the orchestrator, or Matt through the command line. */
export type By =
  | {
      attempt: number;
      usage?: Usage | undefined;
      result?: unknown;
      ran?: CheckRun | undefined;
    }
  | "orchestrator"
  | "matt";

/** An event: one message, and the move it made. word is null when an item is added. */
export interface Event {
  n: number | null;
  by: string | null; // attempt, orchestrator or matt

  from_state: string;
  word: string | null;
  to_state: string;
  at: string;
  reason: string | null;
  cause: string | null;
  findings: Finding[];
  notes: string | null;
}

const cause = `CHECK (cause IS NULL OR cause IN (${causes.map((c) => `'${c}'`).join(", ")}))`;

const tables = `
  CREATE TABLE IF NOT EXISTS items (
    name TEXT PRIMARY KEY, kind TEXT NOT NULL, issue TEXT NOT NULL, seq INTEGER NOT NULL, note TEXT NOT NULL,
    repo TEXT NOT NULL, state TEXT NOT NULL, phase INTEGER, repos TEXT NOT NULL DEFAULT '[]', landed TEXT
  );
  CREATE TABLE IF NOT EXISTS attempts (
    name TEXT NOT NULL REFERENCES items(name), n INTEGER NOT NULL, step TEXT NOT NULL,
    started TEXT NOT NULL, ended TEXT, duration_ms INTEGER, resumed INTEGER NOT NULL DEFAULT 0, word TEXT, reason TEXT, cause TEXT ${cause},
    tokens INTEGER, tokens_in INTEGER, tokens_out INTEGER, cached_in INTEGER, cost REAL, result TEXT,
    trace_id TEXT, span_id TEXT, notes TEXT,
    PRIMARY KEY (name, n)
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL REFERENCES items(name), n INTEGER,
    from_state TEXT NOT NULL, word TEXT, to_state TEXT NOT NULL, at TEXT NOT NULL, reason TEXT, cause TEXT ${cause},
    findings TEXT NOT NULL DEFAULT '[]', notes TEXT, by TEXT
  );
  CREATE TABLE IF NOT EXISTS check_runs (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, n INTEGER NOT NULL, step TEXT NOT NULL,
    command TEXT NOT NULL, image TEXT NOT NULL, tree TEXT NOT NULL, input_hash TEXT NOT NULL,
    code INTEGER NOT NULL, at TEXT NOT NULL, duration_ms INTEGER NOT NULL,
    FOREIGN KEY (name, n) REFERENCES attempts(name, n)
  );
  CREATE INDEX IF NOT EXISTS check_runs_input ON check_runs (input_hash);
  CREATE TABLE IF NOT EXISTS paths (
    name TEXT NOT NULL REFERENCES items(name), path TEXT NOT NULL,
    PRIMARY KEY (name, path)
  );
`;

const now = () => new Date().toISOString();

/**
 * Brings a ledger made before the notes were the only spec to this shape: its kept specs go, an item's note is its
 * note's path in the notes repo (every issue's and cl's is in _well/), its repos are their paths, and the settings it
 * stored go: each attempt reads them from its worktree. A land's commit and an attempt's notes' commit get columns.
 */
function migrate(db: DatabaseSync) {
  const has = (table: string, column: string) =>
    (
      db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    ).some((c) => c.name === column);
  db.exec("DROP TABLE IF EXISTS specs");
  if (!has("attempts", "notes"))
    db.exec("ALTER TABLE attempts ADD COLUMN notes TEXT");
  if (!has("items", "landed"))
    db.exec("ALTER TABLE items ADD COLUMN landed TEXT");
  if (!has("items", "path")) return;
  db.exec("ALTER TABLE items RENAME COLUMN path TO note");
  if (!has("items", "repos"))
    db.exec("ALTER TABLE items ADD COLUMN repos TEXT NOT NULL DEFAULT '[]'");
  const rows = db.prepare("SELECT name, note, repos FROM items").all() as {
    name: string;
    note: string;
    repos: string;
  }[];
  for (const r of rows)
    db.prepare("UPDATE items SET note = ?, repos = ? WHERE name = ?").run(
      `_well/${basename(r.note)}`,
      JSON.stringify(
        (JSON.parse(r.repos) as { repo: string }[]).map((p) => p.repo),
      ),
      r.name,
    );
  for (const c of ["image", "test", "setup"])
    if (has("items", c)) db.exec(`ALTER TABLE items DROP COLUMN ${c}`);
}

export function open(file: string) {
  const db = new DatabaseSync(file);
  db.exec(tables);
  migrate(db);

  // A write inside another write joins its transaction, so a write made of others is still one.
  let depth = 0;
  function tx<T>(f: () => T): T {
    if (depth) return f();
    depth++;
    db.exec("BEGIN");
    try {
      const r = f();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      depth--;
    }
  }

  /** An item as its row holds it, its repos parsed. */
  const itemOf = (row: unknown): Item => {
    const i = row as Omit<Item, "repos"> & { repos: string };
    return { ...i, repos: JSON.parse(i.repos) as string[] };
  };
  const itemsOf = (rows: unknown[]) => rows.map(itemOf);

  function item(name: string): Item {
    const i = db.prepare("SELECT * FROM items WHERE name = ?").get(name);
    if (!i) throw new Error(`no item ${name} in the ledger`);
    return itemOf(i);
  }

  /** The item's last attempt number, or 0: a move with no attempt is recorded at it. */
  const lastN = (name: string) =>
    (
      db
        .prepare("SELECT COALESCE(MAX(n), 0) AS n FROM attempts WHERE name = ?")
        .get(name) as { n: number }
    ).n;

  const eventsOf = (name: string): Event[] =>
    (
      db
        .prepare(
          "SELECT n, by, from_state, word, to_state, at, reason, cause, findings, notes FROM events WHERE name = ? ORDER BY id",
        )
        .all(name) as (Omit<Event, "findings"> & { findings: string })[]
    ).map((e) => ({ ...e, findings: JSON.parse(e.findings) as Finding[] }));

  const event = (
    name: string,
    n: number | null,
    from: State | "new",
    word: string | null,
    to: State,
    reason: string,
    cause: string | null = null,
    findings: Finding[] = [],
    notes: string | null = null,
    by: string | null = null,
  ) =>
    db
      .prepare(
        "INSERT INTO events (name, n, from_state, word, to_state, at, reason, cause, findings, notes, by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        name,
        n,
        from,
        word,
        to,
        now(),
        reason,
        cause,
        JSON.stringify(findings),
        notes,
        by,
      );

  /** Ends an attempt with its message, its test run, its usage and its result, and moves the item to `to`. */
  function end(
    name: string,
    n: number,
    v: Message,
    to: State,
    {
      usage = {},
      result,
      ran,
    }: {
      usage?: Usage | undefined;
      result?: unknown;
      ran?: CheckRun | undefined;
    } = {},
  ) {
    tx(() => {
      const { state } = item(name);
      const at = now();
      db.prepare(
        `UPDATE attempts SET ended = ?, duration_ms = CAST(ROUND((julianday(?) - julianday(started)) * 86400000) AS INTEGER),
           word = ?, reason = ?, cause = ?, tokens = ?, tokens_in = ?, tokens_out = ?, cached_in = ?, cost = ?, result = ?
           WHERE name = ? AND n = ?`,
      ).run(
        at,
        at,
        v.word,
        v.reason,
        v.cause ?? null,
        usage.tokens ?? null,
        usage.input ?? null,
        usage.output ?? null,
        usage.cached ?? null,
        usage.cost ?? null,
        result === undefined ? null : JSON.stringify(result),
        name,
        n,
      );
      if (ran)
        db.prepare(
          "INSERT INTO check_runs (name, n, step, command, image, tree, input_hash, code, at, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          name,
          n,
          state,
          ran.command,
          ran.image,
          ran.tree,
          ran.input,
          ran.code,
          new Date(ran.at).toISOString(),
          ran.ms,
        );
      db.prepare("UPDATE items SET state = ? WHERE name = ?").run(to, name);
      event(
        name,
        n,
        state,
        v.word,
        to,
        v.reason,
        v.cause,
        v.findings,
        v.notes ?? null,
        "attempt",
      );
    });
  }

  /** Moves an item with no attempt, by the orchestrator or Matt, at the item's last attempt number. */
  function moveTo(name: string, to: State, m: Message, by: string) {
    const { state } = item(name);
    db.prepare("UPDATE items SET state = ? WHERE name = ?").run(to, name);
    event(
      name,
      lastN(name),
      state,
      m.word,
      to,
      m.reason,
      m.cause ?? null,
      m.findings,
      m.notes ?? null,
      by,
    );
  }

  /** The attempts made at this state since the item last entered it. */
  function attemptsAt(name: string, state: State): number {
    // The attempt at which the item moved into this state, or 0 when it was added in it. Attempts after it count.
    const { n } = db
      .prepare(
        "SELECT COALESCE(MAX(n), 0) AS n FROM events WHERE name = ? AND to_state = ? AND from_state != to_state",
      )
      .get(name, state) as { n: number };
    const { c } = db
      .prepare(
        "SELECT COUNT(*) AS c FROM attempts WHERE name = ? AND step = ? AND n > ?",
      )
      .get(name, state, n) as { c: number };
    return c;
  }

  /**
   * The times the item was sent back for another round since Matt last moved it: each back that did not raise it. A
   * resume gives a fresh budget.
   */
  function roundsOf(name: string): number {
    const { c } = db
      .prepare(
        `SELECT COUNT(*) AS c FROM events WHERE name = ? AND word = 'back' AND to_state != 'raised'
         AND id > (SELECT COALESCE(MAX(id), 0) FROM events WHERE name = ? AND by = 'matt')`,
      )
      .get(name, name) as { c: number };
    return c;
  }

  /** Where the item was before it came to the state it holds now: what a resume takes it back to by default. */
  function priorOf(name: string): State | undefined {
    const row = db
      .prepare(
        `SELECT from_state FROM events WHERE name = ? AND to_state = (SELECT state FROM items WHERE name = ?)
         AND from_state != to_state ORDER BY id DESC LIMIT 1`,
      )
      .get(name, name) as { from_state: State } | undefined;
    return row?.from_state;
  }

  return {
    item,

    /**
     * Adds an issue, at open for the factory's planner, or at building when its notes hold its spec. Its repo is its
     * first; it holds the rest only when it has more than one.
     */
    addIssue(
      i: Pick<Item, "name" | "note" | "repos">,
      state: "open" | "building" = "open",
    ) {
      const [first] = i.repos;
      if (!first) throw new Error(`${i.name}: an issue needs a repo`);
      tx(() => {
        db.prepare(
          "INSERT INTO items (name, kind, issue, seq, note, repo, state, repos) VALUES (?, 'issue', ?, 0, ?, ?, ?, ?)",
        ).run(
          i.name,
          i.name,
          i.note,
          first,
          state,
          JSON.stringify(i.repos.length > 1 ? i.repos : []),
        );
        event(i.name, null, "new", null, state, "added");
      });
    },

    /** Runs `f` as one transaction: the ledger's writes inside it are all made, or none. */
    transaction: <T>(f: () => T): T => tx(f),

    /** Adds a cl of an issue, at `state`: ready, or waiting for the phase before it. A lone cl is phase 1. */
    addCl(
      i: Pick<Item, "name" | "issue" | "seq" | "note" | "repo"> &
        Partial<Pick<Item, "phase">>,
      state: State,
    ) {
      tx(() => {
        db.prepare(
          "INSERT INTO items (name, kind, issue, seq, note, repo, state, phase) VALUES (?, 'cl', ?, ?, ?, ?, ?, ?)",
        ).run(i.name, i.issue, i.seq, i.note, i.repo, state, i.phase ?? 1);
        event(i.name, null, "new", null, state, "added");
      });
    },

    /** The items in one of `states` with no attempt open. */
    waiting(states: State[]): Item[] {
      const marks = states.map(() => "?").join(", ");
      return itemsOf(
        db
          .prepare(
            `SELECT * FROM items i WHERE state IN (${marks})
           AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.name = i.name AND a.ended IS NULL) ORDER BY rowid`,
          )
          .all(...states),
      );
    },

    /** Every item, in the order it was added. */
    items(): Item[] {
      return itemsOf(db.prepare("SELECT * FROM items ORDER BY rowid").all());
    },

    /** The items in `state`, in the order they were added. */
    inState(state: State): Item[] {
      return itemsOf(
        db
          .prepare("SELECT * FROM items WHERE state = ? ORDER BY rowid")
          .all(state),
      );
    },

    /** An issue's cls, in their plan's order. */
    cls(issue: string): Item[] {
      return itemsOf(
        db
          .prepare(
            "SELECT * FROM items WHERE kind = 'cl' AND issue = ? ORDER BY seq",
          )
          .all(issue),
      );
    },

    open(): Open[] {
      return db
        .prepare("SELECT name, n, step FROM attempts WHERE ended IS NULL")
        .all() as unknown as Open[];
    },

    /** Opens the item's next attempt at its current state, and returns its number. */
    begin(name: string, span: SpanRef = newSpan()): number {
      return tx(() => {
        const { state } = item(name);
        const n = lastN(name) + 1;
        db.prepare(
          "INSERT INTO attempts (name, n, step, started, trace_id, span_id) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(name, n, state, now(), span.traceId, span.spanId);
        return n;
      });
    },

    /** The attempt's span, made when it began: every process that works on it runs under it. */
    span(name: string, n: number): SpanRef {
      const row = db
        .prepare(
          "SELECT trace_id, span_id FROM attempts WHERE name = ? AND n = ?",
        )
        .get(name, n) as { trace_id: string; span_id: string } | undefined;
      if (!row) throw new Error(`no attempt ${name}/${n} in the ledger`);
      return { traceId: row.trace_id, spanId: row.span_id };
    },

    /** The attempt whose trace this is, or undefined: where a span of it is written. */
    ofTrace(traceId: string): { name: string; n: number } | undefined {
      return db
        .prepare("SELECT name, n FROM attempts WHERE trace_id = ?")
        .get(traceId) as { name: string; n: number } | undefined;
    },

    /** Counts a take-up of an open attempt: a new orchestrator goes on with it. Not a move, so no event. */
    resume(name: string, n: number) {
      db.prepare(
        "UPDATE attempts SET resumed = resumed + 1 WHERE name = ? AND n = ? AND ended IS NULL",
      ).run(name, n);
    },

    /** Pins the commit of the notes' main the attempt reads, once, as it starts: its record of the spec it saw. */
    pin(name: string, n: number, commit: string) {
      db.prepare(
        "UPDATE attempts SET notes = ? WHERE name = ? AND n = ? AND notes IS NULL",
      ).run(commit, name, n);
    },

    /** The commit of the notes the attempt read, or undefined before it started. */
    pinned(name: string, n: number): string | undefined {
      const row = db
        .prepare("SELECT notes FROM attempts WHERE name = ? AND n = ?")
        .get(name, n) as { notes: string | null } | undefined;
      return row?.notes ?? undefined;
    },

    /** How many times the attempt was taken up. */
    resumed(name: string, n: number): number {
      const row = db
        .prepare("SELECT resumed FROM attempts WHERE name = ? AND n = ?")
        .get(name, n) as { resumed: number } | undefined;
      return row?.resumed ?? 0;
    },

    /** The attempts made at this state since the item last entered it. */
    attempts: attemptsAt,

    /** The times the item was sent back for another round since Matt last moved it. */
    rounds: roundsOf,

    /** Where the item was before it came to its state: where a resume takes it by default. */
    prior: priorOf,

    /**
     * The one door: applies a message to an item by the table, whoever sends it, in one transaction with one event. An
     * attempt's message counts against the limits, ends the attempt with its result, usage and test run, and a word the
     * table has no row for escalates the item, with why, so it is never left open to run again. The orchestrator's and
     * Matt's are applied as the table says, and a word with no row throws: a resume goes to `target`, else to where
     * the item was before. Gives back the item's new state.
     */
    apply(name: string, m: Message, by: By, target?: State): State {
      return tx(() => {
        const { state, kind } = item(name);
        const about = m.findings.map((f) => f.about);
        if (typeof by !== "object") {
          const prior = target ?? priorOf(name);
          const to = next(state, kind, m.word, about, {
            attempts: 0,
            rounds: 0,
            ...(prior ? { prior } : {}),
          });
          moveTo(name, to, m, by);
          return to;
        }
        let to: State;
        let said = m;
        try {
          to = next(state, kind, m.word, about, {
            attempts: attemptsAt(name, state),
            rounds: roundsOf(name) + (m.word === "back" ? 1 : 0),
          });
        } catch (e) {
          to = "escalated";
          said = { ...m, reason: `${(e as Error).message}: ${m.reason}` };
        }
        end(name, by.attempt, said, to, by);
        return to;
      });
    },

    /** The result of the item's last attempt at `step` that passed, or undefined. */
    passed(name: string, step: State): unknown {
      const row = db
        .prepare(
          "SELECT result FROM attempts WHERE name = ? AND step = ? AND word = 'pass' ORDER BY n DESC LIMIT 1",
        )
        .get(name, step) as { result: string | null } | undefined;
      return row?.result ? JSON.parse(row.result) : undefined;
    },

    /** Records a land: the commit main took for the cl, and the files it changed. */
    landed(name: string, commit: string | undefined, paths: string[]) {
      tx(() => {
        db.prepare("UPDATE items SET landed = ? WHERE name = ?").run(
          commit ?? null,
          name,
        );
        for (const path of paths)
          db.prepare(
            "INSERT OR IGNORE INTO paths (name, path) VALUES (?, ?)",
          ).run(name, path);
      });
    },

    /** The root span of the item's last run at `step` that passed, or undefined: what a review that judges it links to. */
    traceOf(name: string, step: State): SpanRef | undefined {
      const row = db
        .prepare(
          "SELECT trace_id, span_id FROM attempts WHERE name = ? AND step = ? AND word = 'pass' AND trace_id IS NOT NULL ORDER BY n DESC LIMIT 1",
        )
        .get(name, step) as { trace_id: string; span_id: string } | undefined;
      return row && { traceId: row.trace_id, spanId: row.span_id };
    },

    /** The item's messages, in order: each event, its findings parsed. */
    events: eventsOf,

    /**
     * The messages an attempt at `state` reads: the one that moved the item into it, and each since, as the retries
     * there. None when the item was added in it.
     */
    inbox(name: string, state: State): Event[] {
      const all = eventsOf(name);
      const i = all.findLastIndex(
        (e) => e.to_state === state && e.from_state !== state,
      );
      return i < 0
        ? []
        : all.slice(i).filter((e) => e.word !== null || e.findings.length);
    },

    /** What every attempt has cost, in dollars. */
    spent(): number {
      return (
        db
          .prepare("SELECT COALESCE(SUM(cost), 0) AS c FROM attempts")
          .get() as {
          c: number;
        }
      ).c;
    },

    /** Every attempt's use: the item, its step, when it ran, its tokens and its cost. What `factory top` sums. */
    usage(): Used[] {
      return db
        .prepare(
          "SELECT name, n, step, started, ended, tokens_in, tokens_out, cached_in, cost FROM attempts ORDER BY rowid",
        )
        .all() as unknown as Used[];
    },

    /** An item's attempts, in order: what each one did, and what it cost. */
    attemptsOf(name: string) {
      return db
        .prepare(
          "SELECT n, step, started, ended, resumed, word, reason, cause, cost, notes FROM attempts WHERE name = ? ORDER BY n",
        )
        .all(name) as unknown as Attempt[];
    },

    attempt(name: string, n: number) {
      return db
        .prepare("SELECT * FROM attempts WHERE name = ? AND n = ?")
        .get(name, n);
    },
  };
}

export type Ledger = ReturnType<typeof open>;
