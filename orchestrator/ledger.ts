/**
 * The ledger: where each item stands, its attempts, and an event for every move, in SQLite. It is the only state the
 * orchestrator holds, so a killed orchestrator starts again from it with nothing lost. An item is an issue, or one of
 * its cls. Each attempt keeps the agent's result, so every trial's record is here.
 */

import { DatabaseSync } from "node:sqlite";
import { causes, type CheckRun, type Verdict } from "../process/step.ts";
import type { State } from "../process/table.ts";
import { newSpan, type SpanRef } from "../effects/trace.ts";

/** An item the factory moves, and what its steps need to run it. */
export interface Item {
  name: string; // the issue's name, or the cl's: <issue>-<cut>
  kind: "issue" | "cl";
  issue: string; // the issue it is, or belongs to
  seq: number; // a cl's place in its plan's order, from 1. 0 for an issue
  path: string; // its note, which the orchestrator writes
  repo: string;
  image: string;
  test: string; // a cl: the command that runs its test files. An issue: the repo's full suite
  setup: string; // the command that installs the repo's dependencies into a new worktree, offline. '' for none
  state: State;
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
}

const cause = `CHECK (cause IS NULL OR cause IN (${causes.map((c) => `'${c}'`).join(", ")}))`;

const tables = `
  CREATE TABLE IF NOT EXISTS items (
    name TEXT PRIMARY KEY, kind TEXT NOT NULL, issue TEXT NOT NULL, seq INTEGER NOT NULL, path TEXT NOT NULL,
    repo TEXT NOT NULL, image TEXT NOT NULL, test TEXT NOT NULL, setup TEXT NOT NULL DEFAULT '', state TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS attempts (
    name TEXT NOT NULL REFERENCES items(name), n INTEGER NOT NULL, step TEXT NOT NULL,
    started TEXT NOT NULL, ended TEXT, duration_ms INTEGER, resumed INTEGER NOT NULL DEFAULT 0, word TEXT, reason TEXT, cause TEXT ${cause},
    tokens INTEGER, tokens_in INTEGER, tokens_out INTEGER, cached_in INTEGER, cost REAL, result TEXT,
    trace_id TEXT, span_id TEXT,
    PRIMARY KEY (name, n)
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL REFERENCES items(name), n INTEGER,
    from_state TEXT NOT NULL, word TEXT, to_state TEXT NOT NULL, at TEXT NOT NULL, reason TEXT, cause TEXT ${cause}
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
    kind TEXT NOT NULL CHECK (kind IN ('planned', 'actual')),
    PRIMARY KEY (name, path, kind)
  );
`;

const now = () => new Date().toISOString();

export function open(file: string) {
  const db = new DatabaseSync(file);
  db.exec(tables);

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

  function item(name: string): Item {
    const i = db.prepare("SELECT * FROM items WHERE name = ?").get(name) as
      Item | undefined;
    if (!i) throw new Error(`no item ${name} in the ledger`);
    return i;
  }

  /** The item's last attempt number, or 0: a move with no attempt is recorded at it. */
  const lastN = (name: string) =>
    (
      db
        .prepare("SELECT COALESCE(MAX(n), 0) AS n FROM attempts WHERE name = ?")
        .get(name) as { n: number }
    ).n;

  const event = (
    name: string,
    n: number | null,
    from: State | "new",
    word: string | null,
    to: State,
    reason: string,
    cause: string | null = null,
  ) =>
    db
      .prepare(
        "INSERT INTO events (name, n, from_state, word, to_state, at, reason, cause) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(name, n, from, word, to, now(), reason, cause);

  return {
    item,

    /** Adds an issue, at open. */
    addIssue(
      i: Pick<Item, "name" | "path" | "repo" | "image" | "test"> &
        Partial<Pick<Item, "setup">>,
    ) {
      tx(() => {
        db.prepare(
          "INSERT INTO items (name, kind, issue, seq, path, repo, image, test, setup, state) VALUES (?, 'issue', ?, 0, ?, ?, ?, ?, ?, 'open')",
        ).run(i.name, i.name, i.path, i.repo, i.image, i.test, i.setup ?? "");
        event(i.name, null, "new", null, "open", "added");
      });
    },

    /** Runs `f` as one transaction: the ledger's writes inside it are all made, or none. */
    transaction: <T>(f: () => T): T => tx(f),

    /** Adds a cl of an issue, at `state`: ready, or waiting for the cl before it. */
    addCl(
      i: Omit<Item, "kind" | "state" | "setup"> & Partial<Pick<Item, "setup">>,
      state: State,
    ) {
      tx(() => {
        db.prepare(
          "INSERT INTO items (name, kind, issue, seq, path, repo, image, test, setup, state) VALUES (?, 'cl', ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          i.name,
          i.issue,
          i.seq,
          i.path,
          i.repo,
          i.image,
          i.test,
          i.setup ?? "",
          state,
        );
        event(i.name, null, "new", null, state, "added");
      });
    },

    /** The items in one of `states` with no attempt open. */
    waiting(states: State[]): Item[] {
      const marks = states.map(() => "?").join(", ");
      return db
        .prepare(
          `SELECT * FROM items i WHERE state IN (${marks})
           AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.name = i.name AND a.ended IS NULL) ORDER BY rowid`,
        )
        .all(...states) as unknown as Item[];
    },

    /** Every item, in the order it was added. */
    items(): Item[] {
      return db
        .prepare("SELECT * FROM items ORDER BY rowid")
        .all() as unknown as Item[];
    },

    /** The items in `state`, in the order they were added. */
    inState(state: State): Item[] {
      return db
        .prepare("SELECT * FROM items WHERE state = ? ORDER BY rowid")
        .all(state) as unknown as Item[];
    },

    /** An issue's cls, in their plan's order. */
    cls(issue: string): Item[] {
      return db
        .prepare(
          "SELECT * FROM items WHERE kind = 'cl' AND issue = ? ORDER BY seq",
        )
        .all(issue) as unknown as Item[];
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

    /** How many times the attempt was taken up. */
    resumed(name: string, n: number): number {
      const row = db
        .prepare("SELECT resumed FROM attempts WHERE name = ? AND n = ?")
        .get(name, n) as { resumed: number } | undefined;
      return row?.resumed ?? 0;
    },

    /** The attempts made at this state since the item last entered it. */
    attempts(name: string, state: State): number {
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
    },

    /** The times a review has sent the item back. */
    rounds(name: string): number {
      const { c } = db
        .prepare(
          "SELECT COUNT(*) AS c FROM events WHERE name = ? AND word IN ('to-tests', 'to-code', 'to-plan')",
        )
        .get(name) as { c: number };
      return c;
    },

    /**
     * Ends an attempt with its check's verdict, the test run the check made, what its model calls used and the agent's
     * result, and moves the item to `to`, in one transaction with one event.
     */
    end(
      name: string,
      n: number,
      v: Verdict,
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
        event(name, n, state, v.word, to, v.reason, v.cause);
      });
    },

    /** Moves items with no attempt: the orchestrator's own moves, as a cl made ready or an issue built. One transaction. */
    move(moves: { name: string; to: State; reason: string }[]) {
      tx(() => {
        for (const m of moves) {
          const { state } = item(m.name);
          db.prepare("UPDATE items SET state = ? WHERE name = ?").run(
            m.to,
            m.name,
          );
          event(m.name, lastN(m.name), state, null, m.to, m.reason);
        }
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

    /** Records paths of a cl: the files its plan says it changes, or the files it changed when merged. */
    paths(name: string, kind: "planned" | "actual", paths: string[]) {
      tx(() => {
        for (const path of paths)
          db.prepare(
            "INSERT OR IGNORE INTO paths (name, path, kind) VALUES (?, ?, ?)",
          ).run(name, path, kind);
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

    events(name: string) {
      return db
        .prepare(
          "SELECT n, from_state, word, to_state, at, reason, cause FROM events WHERE name = ? ORDER BY id",
        )
        .all(name);
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

    /** An item's attempts, in order: what each one did, and what it cost. */
    attemptsOf(name: string) {
      return db
        .prepare(
          "SELECT n, step, started, ended, resumed, word, reason, cause, cost FROM attempts WHERE name = ? ORDER BY n",
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
