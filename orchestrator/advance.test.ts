import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClSpec, Planned } from "../process/plan.ts";
import { advance } from "./advance.ts";
import { type Ledger, open } from "./ledger.ts";
import { section } from "../effects/notes.ts";

const issueNote =
  "---\ntype: issue\nstatus: new\n---\nOne value.\n\n---\n## Done\n\n- value is 2\n- double is 4\n";
const cl = (name: string, phase?: number): ClSpec => ({
  name,
  intent: `${name} is right`,
  ...(phase === undefined ? {} : { phase }),
  shape: { change: "behavior", checked: "repo" },
  checkout: [`src/${name}.mjs`, `test/${name}.test.mjs`],
  test: `node --test test/${name}.test.mjs`,
  check: [`given ${name}, when read, then right`],
  seam: "src/value.mjs's exports",
  checkoutNotes: `- src/${name}.mjs: the code`,
});
const plan: Planned = {
  word: "done",
  plan: { approach: "value, then double", phases: ["the value", "its double"] },
  cls: [cl("value", 1), cl("double", 2)],
};

let dir: string;
let ledger: Ledger;
let path: string;
beforeEach(() => {
  vi.resetAllMocks();
  dir = mkdtempSync(join(tmpdir(), "advance-"));
  path = join(dir, "is.md");
  writeFileSync(path, issueNote);
  ledger = open(join(dir, "ledger.db"));
  ledger.addIssue({
    name: "is",
    path,
    repo: "/repo",
    image: "img",
    test: "suite",
  });
  // The issue planned, and its plan approved.
  ledger.apply(
    "is",
    { word: "pass", reason: "lints", findings: [] },
    { attempt: ledger.begin("is"), ...{ result: plan } },
  );
  ledger.apply(
    "is",
    { word: "pass", reason: "approved", findings: [] },
    { attempt: ledger.begin("is") },
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const state = (name: string) => ledger.item(name).state;
/** Puts an item at a state, as the steps a test skips would. */
const force = (name: string, to: string) => {
  const db = new DatabaseSync(join(dir, "ledger.db"));
  db.prepare("UPDATE items SET state = ? WHERE name = ?").run(to, name);
  db.close();
};
const read = (name: string) => readFileSync(join(dir, `${name}.md`), "utf8");

describe("advance", () => {
  it("writes an approved spec's notes in kinetic's format, and puts its cls in the ledger, phase 1 ready", async () => {
    await advance(ledger);
    expect(
      ledger.cls("is").map((c) => [c.name, c.phase, c.state, c.test]),
    ).toEqual([
      ["is-value", 1, "ready", "node --test test/value.test.mjs"],
      ["is-double", 2, "waiting", "node --test test/double.test.mjs"],
    ]);
    expect(read("is-plan")).toMatch(/^---\ntype: plan\n/);
    expect(read("is-plan")).toContain(
      "- Phase 2: its double\n\t- [[is-double]]",
    );
    expect(read("is-plan")).not.toMatch(/one phase|## Trace/);
    expect(read("is-value")).toContain('belongsTo: "[[is-plan]]"');
    expect(read("is-value")).toContain(
      'checkout: ["src/value.mjs","test/value.test.mjs"]',
    );
    expect(section(join(dir, "is-value.md"), "Check").trim()).toBe(
      "- given value, when read, then right",
    );
    expect(read("is")).toMatch(/status: in-progress/);
  });

  it("starts every cl of a phase together, and the next phase once all of them land", async () => {
    ledger.apply(
      "is",
      {
        word: "back",
        reason: "again",
        findings: [{ about: "plan", what: "w", where: "x" }],
      },
      { attempt: ledger.begin("is") },
    );
    ledger.apply(
      "is",
      { word: "pass", reason: "lints", findings: [] },
      {
        attempt: ledger.begin("is"),
        result: { ...plan, cls: [cl("a", 1), cl("b", 1), cl("c", 2)] },
      },
    );
    ledger.apply(
      "is",
      { word: "pass", reason: "approved", findings: [] },
      { attempt: ledger.begin("is") },
    );
    await advance(ledger);
    expect(["is-a", "is-b", "is-c"].map(state)).toEqual([
      "ready",
      "ready",
      "waiting",
    ]);
    force("is-a", "landed");
    await advance(ledger);
    expect(state("is-c")).toBe("waiting");
    force("is-b", "landed");
    await advance(ledger);
    expect(state("is-c")).toBe("ready");
  });

  it("leaves an approved cl to its land, and starts the next phase once it has landed", async () => {
    await advance(ledger);
    force("is-value", "approved");
    await advance(ledger);
    expect([state("is-value"), state("is-double")]).toEqual([
      "approved",
      "waiting",
    ]);
    force("is-value", "landed");
    await advance(ledger);
    expect(state("is-double")).toBe("ready");
  });

  it("marks the issue built once its cls have all landed", async () => {
    await advance(ledger);
    for (const c of ["is-value", "is-double"]) {
      force(c, "landed");
      await advance(ledger);
    }
    await advance(ledger);
    expect(state("is")).toBe("built");
  });

  const raise = (cl: string, about: "cl" | "plan" | "issue") =>
    ledger.apply(
      cl,
      {
        word: "back",
        reason: "back",
        findings: [
          { about, what: "the seam is not there", where: "src/value.mjs" },
        ],
      },
      { attempt: ledger.begin(cl) },
    );

  it("relays a cl's raise to the planner, its findings with it, and drops the rest of its plan", async () => {
    await advance(ledger);
    raise("is-value", "plan");
    await advance(ledger);
    expect(state("is")).toBe("open");
    expect(state("is-double")).toBe("dropped");
    expect(ledger.inbox("is", "open")).toMatchObject([
      {
        word: "back",
        reason: expect.stringMatching(/is-value raised/),
        findings: [{ about: "plan", what: "the seam is not there" }],
      },
    ]);
    expect(read("is")).not.toMatch(/## Raise/);
    expect(read("is-double")).toMatch(/status: dropped/);
  });

  it("relays a cl's raise about the issue to Matt", async () => {
    await advance(ledger);
    raise("is-value", "issue");
    await advance(ledger);
    expect(state("is")).toBe("raised");
  });

  it("sends the issue back to the planner when its last cl raises, not on as built", async () => {
    await advance(ledger);
    force("is-value", "approved");
    await advance(ledger);
    await advance(ledger);
    raise("is-double", "plan");
    await advance(ledger);
    expect(state("is")).toBe("open");
  });

  it("hands a cl's raise over once: the raising cl is dropped, so the next plan builds", async () => {
    await advance(ledger);
    raise("is-value", "plan");
    await advance(ledger);
    expect(state("is-value")).toBe("dropped");
    // The planner answers with a plan of a new cut, and it is approved.
    ledger.apply(
      "is",
      { word: "pass", reason: "lints", findings: [] },
      {
        attempt: ledger.begin("is"),
        ...{ result: { word: "done", cls: [cl("seam")] } },
      },
    );
    ledger.apply(
      "is",
      { word: "pass", reason: "approved", findings: [] },
      { attempt: ledger.begin("is") },
    );
    await advance(ledger);
    expect(state("is")).toBe("building");
    expect(state("is-seam")).toBe("ready");
  });

  it("escalates an item whose move fails, with why, and goes on with the rest", async () => {
    // An issue building with no spec: its move can't be made.
    writeFileSync(join(dir, "other.md"), issueNote);
    ledger.addIssue({
      name: "other",
      path: join(dir, "other.md"),
      repo: "/repo",
      image: "img",
      test: "suite",
    });
    force("other", "building");
    await advance(ledger);
    expect(state("other")).toBe("escalated");
    expect(ledger.events("other").at(-1)).toMatchObject({
      by: "orchestrator",
      word: "escalate",
      reason: expect.stringMatching(/move failed: .*building with no spec/),
    });
    expect(state("is-value")).toBe("ready");
  });

  it("finishes a build a stop cut off: the cls in the ledger stay, and the rest are added", async () => {
    // The stop came after the first cl was added.
    writeFileSync(join(dir, "is-value.md"), "---\ntype: cl\n---\nkept\n");
    ledger.addCl(
      {
        name: "is-value",
        issue: "is",
        seq: 1,
        path: join(dir, "is-value.md"),
        repo: "/repo",
        image: "img",
        test: "t",
      },
      "ready",
    );
    await advance(ledger);
    expect(read("is-value")).toContain("kept");
    expect(ledger.cls("is").map((c) => [c.name, c.seq, c.state])).toEqual([
      ["is-value", 1, "ready"],
      ["is-double", 2, "waiting"],
    ]);
  });

  it("escalates the issue when one of its cls is", async () => {
    await advance(ledger);
    force("is-value", "escalated");
    await advance(ledger);
    expect(state("is")).toBe("escalated");
  });

  it("marks an accepted issue's notes done", async () => {
    await advance(ledger);
    force("is", "accepted");
    await advance(ledger);
    expect(read("is")).toMatch(/status: done/);
    expect(read("is-plan")).toMatch(/status: done/);
    expect(existsSync(join(dir, "is-double.md"))).toBe(true);
  });

  it("builds a spec Matt made from his notes, writing none, and escalates a raise about its plan to him", async () => {
    const db = new DatabaseSync(join(dir, "ledger.db"));
    db.prepare("DELETE FROM attempts").run();
    db.close();
    ledger.keepSpec("is", { plan: plan.plan, cls: plan.cls }, "matt");
    await advance(ledger);
    expect(existsSync(join(dir, "is-plan.md"))).toBe(false);
    expect(ledger.cls("is").map((c) => c.name)).toEqual([
      "is-value",
      "is-double",
    ]);
    writeFileSync(
      join(dir, "is-value.md"),
      "---\ntype: cl\nstatus: new\n---\nv\n",
    );
    raise("is-value", "plan");
    await advance(ledger);
    expect(state("is")).toBe("escalated");
  });
});
