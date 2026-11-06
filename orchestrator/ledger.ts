/**
 * The ledger: where each cl stands, its attempts, and an event for every move, in SQLite. It is the only state the
 * orchestrator holds, so a killed orchestrator starts again from it with nothing lost.
 */

import { DatabaseSync } from "node:sqlite";
import type { Verdict } from "../process/step.ts";
import type { State } from "./table.ts";

/** A cl the factory moves, and what its steps need to run it. */
export interface Item {
  cl: string;
  path: string;
  repo: string;
  image: string;
  test: string;
  state: State;
}

/** An attempt not ended yet: its container is running, or it stopped and its check has not run. */
export interface Open {
  cl: string;
  n: number;
  step: State;
}

const tables = `
  CREATE TABLE IF NOT EXISTS items (
    cl TEXT PRIMARY KEY, path TEXT NOT NULL, repo TEXT NOT NULL, image TEXT NOT NULL, test TEXT NOT NULL,
    state TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS attempts (
    cl TEXT NOT NULL REFERENCES items(cl), n INTEGER NOT NULL, step TEXT NOT NULL,
    started TEXT NOT NULL, ended TEXT, word TEXT, reason TEXT, tokens INTEGER, cost REAL,
    PRIMARY KEY (cl, n)
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY, cl TEXT NOT NULL REFERENCES items(cl), n INTEGER,
    from_state TEXT NOT NULL, word TEXT, to_state TEXT NOT NULL, at TEXT NOT NULL, reason TEXT
  );
`;

const now = () => new Date().toISOString();

export function open(file: string) {
  const db = new DatabaseSync(file);
  db.exec(tables);

  function tx<T>(f: () => T): T {
    db.exec("BEGIN");
    try {
      const r = f();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  function item(cl: string): Item {
    const i = db.prepare("SELECT * FROM items WHERE cl = ?").get(cl) as
      Item | undefined;
    if (!i) throw new Error(`no cl ${cl} in the ledger`);
    return i;
  }

  return {
    item,

    add(i: Omit<Item, "state">, state: State = "ready") {
      tx(() => {
        db.prepare(
          "INSERT INTO items (cl, path, repo, image, test, state) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(i.cl, i.path, i.repo, i.image, i.test, state);
        db.prepare(
          "INSERT INTO events (cl, from_state, to_state, at, reason) VALUES (?, 'new', ?, ?, 'added')",
        ).run(i.cl, state, now());
      });
    },

    /** The cls in one of `states` with no attempt open. */
    waiting(states: State[]): Item[] {
      const marks = states.map(() => "?").join(", ");
      return db
        .prepare(
          `SELECT * FROM items i WHERE state IN (${marks})
           AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.cl = i.cl AND a.ended IS NULL)`,
        )
        .all(...states) as unknown as Item[];
    },

    open(): Open[] {
      return db
        .prepare("SELECT cl, n, step FROM attempts WHERE ended IS NULL")
        .all() as unknown as Open[];
    },

    /** Opens the cl's next attempt at its current state, and returns its number. */
    begin(cl: string): number {
      return tx(() => {
        const { state } = item(cl);
        const { n } = db
          .prepare(
            "SELECT COALESCE(MAX(n), 0) + 1 AS n FROM attempts WHERE cl = ?",
          )
          .get(cl) as { n: number };
        db.prepare(
          "INSERT INTO attempts (cl, n, step, started) VALUES (?, ?, ?, ?)",
        ).run(cl, n, state, now());
        return n;
      });
    },

    /** The attempts made at this state since the cl last entered it. */
    attempts(cl: string, state: State): number {
      // The attempt that moved the cl into this state, or 0 when it was added in it. Attempts after it count.
      const { n } = db
        .prepare(
          "SELECT COALESCE(MAX(n), 0) AS n FROM events WHERE cl = ? AND to_state = ? AND from_state != to_state",
        )
        .get(cl, state) as { n: number };
      const { c } = db
        .prepare(
          "SELECT COUNT(*) AS c FROM attempts WHERE cl = ? AND step = ? AND n > ?",
        )
        .get(cl, state, n) as { c: number };
      return c;
    },

    /** The times a review has sent the cl back. */
    rounds(cl: string): number {
      const { c } = db
        .prepare(
          "SELECT COUNT(*) AS c FROM events WHERE cl = ? AND word IN ('to-tests', 'to-code')",
        )
        .get(cl) as { c: number };
      return c;
    },

    /** Ends an attempt with its check's verdict, and moves the cl to `to`, in one transaction with one event. */
    end(cl: string, n: number, v: Verdict, to: State) {
      tx(() => {
        const { state } = item(cl);
        db.prepare(
          "UPDATE attempts SET ended = ?, word = ?, reason = ? WHERE cl = ? AND n = ?",
        ).run(now(), v.word, v.reason, cl, n);
        db.prepare("UPDATE items SET state = ? WHERE cl = ?").run(to, cl);
        db.prepare(
          "INSERT INTO events (cl, n, from_state, word, to_state, at, reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(cl, n, state, v.word, to, now(), v.reason);
      });
    },

    events(cl: string) {
      return db
        .prepare(
          "SELECT n, from_state, word, to_state, at, reason FROM events WHERE cl = ? ORDER BY id",
        )
        .all(cl);
    },
  };
}

export type Ledger = ReturnType<typeof open>;
