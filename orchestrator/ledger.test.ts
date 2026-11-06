import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { open } from "./ledger.ts";

const item = {
  cl: "a-b",
  path: "/cl.md",
  repo: "/repo",
  image: "img",
  test: "npm test",
};
let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ledger-"));
  file = join(dir, "ledger.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ledger", () => {
  it("adds a cl as ready, with one event", () => {
    const l = open(file);
    l.add(item);
    expect(l.item("a-b").state).toBe("ready");
    expect(l.events("a-b")).toHaveLength(1);
  });

  it("opens an attempt, and a cl with an open attempt is not waiting", () => {
    const l = open(file);
    l.add(item);
    expect(l.begin("a-b")).toBe(1);
    expect(l.open()).toEqual([{ cl: "a-b", n: 1, step: "ready" }]);
    expect(l.waiting(["ready"])).toEqual([]);
  });

  it("ends an attempt, moves the cl and writes one event, together", () => {
    const l = open(file);
    l.add(item);
    const n = l.begin("a-b");
    l.end("a-b", n, { word: "pass", reason: "red at an assertion" }, "red");
    expect(l.item("a-b").state).toBe("red");
    expect(l.open()).toEqual([]);
    expect(l.events("a-b").at(-1)).toMatchObject({
      n: 1,
      from_state: "ready",
      word: "pass",
      to_state: "red",
      reason: "red at an assertion",
    });
  });

  it("counts a state's attempts, and starts again when the cl comes back into it", () => {
    const l = open(file);
    l.add(item);
    l.end("a-b", l.begin("a-b"), { word: "retry", reason: "r" }, "ready");
    expect(l.attempts("a-b", "ready")).toBe(1);
    l.end("a-b", l.begin("a-b"), { word: "raise", reason: "r" }, "raised");
    expect(l.attempts("a-b", "ready")).toBe(2);
    l.end("a-b", l.begin("a-b"), { word: "pass", reason: "fixed" }, "ready");
    l.begin("a-b");
    expect(l.attempts("a-b", "ready")).toBe(1);
  });

  it("counts a review's send-backs", () => {
    const l = open(file);
    l.add(item);
    l.end("a-b", l.begin("a-b"), { word: "to-code", reason: "r" }, "red");
    l.end("a-b", l.begin("a-b"), { word: "pass", reason: "r" }, "green");
    l.end("a-b", l.begin("a-b"), { word: "to-tests", reason: "r" }, "ready");
    expect(l.rounds("a-b")).toBe(2);
  });

  it("keeps everything after it is opened again", () => {
    const l = open(file);
    l.add(item);
    l.end("a-b", l.begin("a-b"), { word: "retry", reason: "r" }, "ready");
    l.begin("a-b");
    const again = open(file);
    expect(again.item("a-b").state).toBe("ready");
    expect(again.open()).toEqual([{ cl: "a-b", n: 2, step: "ready" }]);
    expect(again.attempts("a-b", "ready")).toBe(2);
  });
});
