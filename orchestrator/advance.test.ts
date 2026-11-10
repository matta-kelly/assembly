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
import type { Plan } from "../process/plan.ts";
import { advance } from "./advance.ts";
import { type Ledger, open } from "./ledger.ts";
import { section } from "../effects/notes.ts";
import { merge } from "../effects/git.ts";

vi.mock("../effects/git.ts", () => ({
  merge: vi.fn((_repo: string, cl: string) =>
    Promise.resolve([`src/${cl.replace("is-", "")}.mjs`, "test/x.test.mjs"]),
  ),
}));

const issueNote =
  "---\ntype: issue\nstatus: new\n---\nOne value.\n\n## Check\n\n- value is 2\n- double is 4\n";
const cut = (name: string, traces: number[]) => ({
  name,
  intent: `${name} is right`,
  behaviors: [`given ${name}, when read, then right`],
  seam: "src/value.mjs's exports",
  files: { change: [`src/${name}.mjs`], read: [] },
  grounds: [],
  test: `node --test test/${name}.test.mjs`,
  traces,
});
const plan: Plan = {
  word: "done",
  seams: [{ name: "value", what: "the exports" }],
  cuts: [cut("value", [1]), cut("double", [2])],
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
  ledger.end(
    "is",
    ledger.begin("is"),
    { word: "pass", reason: "lints", findings: [] },
    "planned",
    { result: plan },
  );
  ledger.end(
    "is",
    ledger.begin("is"),
    { word: "pass", reason: "approved", findings: [] },
    "building",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const state = (name: string) => ledger.item(name).state;
const read = (name: string) => readFileSync(join(dir, `${name}.md`), "utf8");

describe("advance", () => {
  it("writes an approved plan's notes, and puts its cls in the ledger, the first ready", async () => {
    await advance(ledger);
    expect(ledger.cls("is").map((c) => [c.name, c.state, c.test])).toEqual([
      ["is-value", "ready", "node --test test/value.test.mjs"],
      ["is-double", "waiting", "node --test test/double.test.mjs"],
    ]);
    expect(read("is-plan")).toMatch(/^---\ntype: plan\n/);
    expect(read("is-plan")).toContain("- value is 2: [[is-value]]");
    expect(read("is-value")).toContain('belongsTo: "[[is-plan]]"');
    expect(section(join(dir, "is-value.md"), "Check").trim()).toBe(
      "- given value, when read, then right",
    );
    expect(section(join(dir, "is-double.md"), "Needs")).toContain(
      "[[is-value]]",
    );
    expect(read("is")).toMatch(/status: in-progress/);
  });

  it("merges an approved cl into its issue's branch, then starts the next", async () => {
    await advance(ledger);
    ledger.end(
      "is-value",
      ledger.begin("is-value"),
      { word: "pass", reason: "approved", findings: [] },
      "approved",
    );
    await advance(ledger);
    expect(merge).toHaveBeenCalledWith("/repo", "is-value", "is");
    expect([state("is-value"), state("is-double")]).toEqual([
      "merged",
      "ready",
    ]);
    expect(read("is-value")).toMatch(/status: done/);
    // The plan's files and the merged ones: the context hit rate's two sides.
    const db = new DatabaseSync(join(dir, "ledger.db"));
    expect(
      db
        .prepare(
          "SELECT path, kind FROM paths WHERE name = 'is-value' ORDER BY kind, path",
        )
        .all()
        .map((p) => `${p["kind"] as string} ${p["path"] as string}`),
    ).toEqual([
      "actual src/value.mjs",
      "actual test/x.test.mjs",
      "planned src/value.mjs",
    ]);
    db.close();
  });

  it("marks the issue built once its cls are all merged", async () => {
    await advance(ledger);
    for (const c of ["is-value", "is-double"]) {
      ledger.move([{ name: c, to: "approved", reason: "test" }]);
      await advance(ledger);
    }
    await advance(ledger);
    expect(state("is")).toBe("built");
  });

  const raise = (cl: string, about: "cl" | "plan" | "issue") =>
    ledger.end(
      cl,
      ledger.begin(cl),
      {
        word: "back",
        reason: "back",
        findings: [
          { about, what: "the seam is not there", where: "src/value.mjs" },
        ],
      },
      "raised",
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
    ledger.move([{ name: "is-value", to: "approved", reason: "test" }]);
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
    ledger.end(
      "is",
      ledger.begin("is"),
      { word: "pass", reason: "lints", findings: [] },
      "planned",
      { result: { ...plan, cuts: [cut("seam", [1, 2])] } },
    );
    ledger.end(
      "is",
      ledger.begin("is"),
      { word: "pass", reason: "approved", findings: [] },
      "building",
    );
    await advance(ledger);
    expect(state("is")).toBe("building");
    expect(state("is-seam")).toBe("ready");
  });

  it("escalates a cl whose merge fails, and goes on with the rest", async () => {
    await advance(ledger);
    vi.mocked(merge).mockRejectedValueOnce(
      new Error("assembly/is/head is not behind"),
    );
    ledger.move([{ name: "is-value", to: "approved", reason: "test" }]);
    await advance(ledger);
    expect(state("is-value")).toBe("escalated");
    expect(ledger.events("is-value").at(-1)).toMatchObject({
      reason: expect.stringMatching(/move failed: .*not behind/),
    });
    await advance(ledger);
    expect(state("is")).toBe("escalated");
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
    ledger.move([{ name: "is-value", to: "escalated", reason: "test" }]);
    await advance(ledger);
    expect(state("is")).toBe("escalated");
  });

  it("marks an accepted issue's notes done", async () => {
    await advance(ledger);
    ledger.move([{ name: "is", to: "accepted", reason: "test" }]);
    await advance(ledger);
    expect(read("is")).toMatch(/status: done/);
    expect(read("is-plan")).toMatch(/status: done/);
    expect(existsSync(join(dir, "is-double.md"))).toBe(true);
  });
});
