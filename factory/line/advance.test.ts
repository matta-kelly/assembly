import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { move } from "../repos/move.ts";
import { notesRepo } from "../repos/notes.fixture.ts";
import { npmRegistryUrl } from "../repos/registry.ts";
import { advance, reconcile, start, writePlan, type World } from "./advance.ts";
import { type Ledger, open } from "./ledger.ts";
import { notesAt, sectionIn } from "../repos/notes.ts";
import { type ClSpec, type Planned, readSpec } from "../stations/plan.ts";

// The move runs a container: the unit tests stand it in. Main is the notes repo's own: it has no remote to fetch.
vi.mock("../repos/move.ts", () => ({ move: vi.fn() }));
vi.mock("../repos/git.ts", async (original) => ({
  ...(await original<typeof import("../repos/git.ts")>()),
  mainOf: vi.fn(async () => "main"),
}));

const issueNote =
  "---\ntype: issue\nstatus: new\n---\nOne value.\n\n---\n## Done\n\n- value is 2\n- double is 4\n";
const cl = (name: string, phase?: number): ClSpec => ({
  name,
  intent: `${name} is right`,
  ...(phase === undefined ? {} : { phase }),
  shape: { change: "behavior", checked: "repo" },
  promises: [`given ${name}, when read, then right`],
  seam: "src/value.mjs's exports",
  context: `- src/${name}.mjs: the code`,
});
const plan: Planned = {
  word: "done",
  plan: { approach: "value, then double", phases: ["the value", "its double"] },
  cls: [cl("value", 1), cl("double", 2)],
};

let dir: string;
let ledger: Ledger;
let notes: ReturnType<typeof notesRepo>;

/** The planner's spec, and plan review's pass: the issue is approved, for its plan's land. */
function planned(spec: Planned = plan) {
  ledger.apply(
    "is",
    { word: "pass", reason: "lints", findings: [] },
    { attempt: ledger.begin("is"), result: spec },
  );
  ledger.apply(
    "is",
    { word: "pass", reason: "approved", findings: [] },
    { attempt: ledger.begin("is") },
  );
}

/** The issue's land, as the loop makes it: its plan written as notes, committed on the notes' main, and passed. */
function landPlan() {
  writePlan(ledger, ledger.item("is"), notes.repo);
  notes.commit({});
  ledger.apply(
    "is",
    { word: "pass", reason: "landed", findings: [] },
    { attempt: ledger.begin("is") },
  );
}

beforeEach(() => {
  // the clock is real at the start of every test in this file, whatever one before it left
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.mocked(move).mockResolvedValue("c0ffee");
  dir = mkdtempSync(join(tmpdir(), "advance-"));
  notes = notesRepo({ "_well/is.md": issueNote }, join(dir, "notes"));
  ledger = open(join(dir, "ledger.db"));
  ledger.addIssue({ name: "is", note: "_well/is.md", repos: ["/repo"] });
  planned();
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const state = (name: string) => ledger.item(name).state;
/** The operator's go on the building issue: each cl note at the notes' main goes in, waiting. */
const goIssue = () => {
  const read = readSpec(notesAt(notes.repo, "main"), "_well/is.md", "is");
  if (!read.ok) throw new Error(read.errors.join("; "));
  return reconcile(ledger, ledger.item("is"), read.spec);
};
/** Puts an item at a state, as the steps a test skips would. */
const force = (name: string, to: string) => {
  const db = new DatabaseSync(join(dir, "ledger.db"));
  db.prepare("UPDATE items SET state = ? WHERE name = ?").run(to, name);
  db.close();
  // a landed cl's land took a commit: its name stands in for it
  if (to === "landed") ledger.landed(name, name, []);
};
/** A note as the notes' main holds it. */
const onMain = (name: string) =>
  notesAt(notes.repo, "main").text(`_well/${name}.md`);

describe("the issue's land", () => {
  it("writes its planner's spec as notes in kinetic's format, which read back as the same spec", () => {
    landPlan();
    expect(onMain("is-plan")).toMatch(/^---\ntype: plan\n/);
    expect(onMain("is-plan")).toContain(
      "- Phase 2: its double\n\t- [[is-double]]",
    );
    expect(onMain("is-value")).toContain('belongsTo: "[[is-plan]]"');
    expect(onMain("is-value")).not.toContain("checkout");
    expect(sectionIn(onMain("is-value"), "Core context").trim()).toBe(
      "- src/value.mjs: the code",
    );
    expect(sectionIn(onMain("is-value"), "Promises").trim()).toBe(
      "- given value, when read, then right",
    );
    expect(onMain("is")).toBe(issueNote);
    const read = readSpec(
      notesAt(notes.repo, "main"),
      "_well/is.md",
      "is",
      true,
    );
    expect(read.ok && read.spec.cls.map((c) => c.name)).toEqual([
      "double",
      "value",
    ]);
  });

  it("replaces, on a new plan, the notes of the cls not landed, and keeps a landed cl's", async () => {
    landPlan();
    goIssue();
    force("is-value", "landed");
    force("is-double", "dropped");
    force("is", "open");
    planned({ word: "done", cls: [cl("seam")] });
    landPlan();
    const names = notesAt(notes.repo, "main").names("_well").sort();
    expect(names).toEqual(["is-seam.md", "is-value.md", "is.md"]);
  });
});

describe("advance", () => {
  it("marks a building issue built once its cls have all ended, landed or dropped", () => {
    landPlan();
    goIssue();
    advance(ledger);
    expect(state("is")).toBe("building");
    force("is-value", "landed");
    force("is-double", "dropped");
    advance(ledger);
    expect(state("is")).toBe("built");
  });

  it("leaves a building issue with no cl as it is: its cls go in at the operator's go", () => {
    landPlan();
    advance(ledger);
    expect(state("is")).toBe("building");
    expect(ledger.cls("is")).toEqual([]);
  });
});

describe("a resume's reconcile", () => {
  it("adds a new cl note, drops a cl whose note is gone and has not landed, and keeps the rest", async () => {
    landPlan();
    goIssue();
    force("is-value", "landed");
    const added = reconcile(
      ledger,
      ledger.item("is"),
      { cls: [cl("seam", 2)] },
      true,
    );
    expect(added).toEqual(["is-seam"]);
    expect(ledger.cls("is").map((c) => [c.name, c.state])).toEqual([
      ["is-value", "landed"],
      ["is-double", "dropped"],
      ["is-seam", "waiting"],
    ]);
  });
});

describe("a waiting cl's start", () => {
  const pkg = (name: string, deps: Record<string, string> = {}) =>
    JSON.stringify({ name, version: "0.0.0", dependencies: deps });

  /** An issue "x" with a cl of repo /a landed, and a cl of repo /b waiting. */
  function across() {
    ledger.addIssue({ name: "x", note: "_well/x.md", repos: ["/a"] });
    for (const [name, repo, phase, at] of [
      ["x-a", "/a", 1, "ready"],
      ["x-b", "/b", 2, "waiting"],
    ] as const)
      ledger.addCl(
        { name, issue: "x", seq: phase, phase, note: `_well/${name}.md`, repo },
        at,
      );
    force("x-a", "landed");
  }

  /** The world: repo files by "<repo>:<file>", the tags the land of x-a put on main, the registry. */
  const worldOf = (
    files: Record<string, string>,
    tags: string[] | (() => Promise<string[]>),
    published: (n: string, v: string) => Promise<boolean> = async () => true,
  ): World => ({
    runs: join(dir, "runs"),
    notes: notes.repo,
    registry: { url: npmRegistryUrl, published: vi.fn(published) },
    reader: {
      file: (repo: string, file: string) => files[`${repo}:${file}`],
      onCrate: () => true,
    },
    tags: async (_repo: string, cl: string) =>
      cl !== "x-a" ? [] : typeof tags === "function" ? tags() : tags,
  });
  const files = {
    "/a:package.json": pkg("@s/alpha"),
    "/b:package.json": pkg("@s/beta", { "@s/alpha": "^1.2.0" }),
  };
  const b = () => ledger.item("x-b");

  it("makes a cl that needs nothing ready, as the operator: its inner loop runs from there", async () => {
    across();
    expect(await start(ledger, b(), worldOf({}, []))).toBeUndefined();
    expect(state("x-b")).toBe("ready");
    expect(ledger.events("x-b").at(-1)).toMatchObject({
      by: "operator",
      word: "pass",
    });
    expect(vi.mocked(move)).not.toHaveBeenCalled();
  });

  it("moves its worktree onto the landed version its repo depends on, then makes it ready", async () => {
    across();
    expect(
      await start(ledger, b(), worldOf(files, ["v1.2.0"])),
    ).toBeUndefined();
    expect(vi.mocked(move)).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "x-b",
        repo: "/b",
        work: join(dir, "runs", "x", "cl", "b", "x-b"),
      }),
      "@s/alpha",
      "1.2.0",
      npmRegistryUrl,
    );
    expect(state("x-b")).toBe("ready");
  });

  it("reads the version from the tag of the package's folder, and a dev dependency counts", async () => {
    across();
    const world = worldOf(
      {
        "/a:lib/package.json": pkg("gamma"),
        "/b:package.json": JSON.stringify({
          name: "delta",
          devDependencies: { gamma: "^0.3.0" },
        }),
      },
      ["lib-v0.3.0"],
    );
    expect(await start(ledger, b(), world)).toBeUndefined();
    expect(vi.mocked(move)).toHaveBeenCalledWith(
      expect.anything(),
      "gamma",
      "0.3.0",
      npmRegistryUrl,
    );
  });

  it("says why it can't start while a version it needs is not on npm, moves nothing, and keeps it waiting", async () => {
    across();
    const why = await start(
      ledger,
      b(),
      worldOf(files, ["v1.2.0"], async () => false),
    );
    expect(why).toMatch(/@s\/alpha@1\.2\.0, made by x-a, is not on npm yet/);
    expect(vi.mocked(move)).not.toHaveBeenCalled();
    expect(state("x-b")).toBe("waiting");
  });

  it("says why it can't start when a move fails, with its output, and keeps it waiting", async () => {
    across();
    vi.mocked(move).mockRejectedValue(new Error("npm ERR! 404"));
    expect(await start(ledger, b(), worldOf(files, ["v1.2.0"]))).toMatch(
      /could not move to @s\/alpha@1\.2\.0: npm ERR! 404/,
    );
    expect(state("x-b")).toBe("waiting");
  });

  it("says why it can't start when what it needs can't be read: the registry, or the land target", async () => {
    across();
    const down = async (): Promise<boolean> => {
      throw new Error("registry down");
    };
    expect(await start(ledger, b(), worldOf(files, ["v1.2.0"], down))).toMatch(
      /could not be read: registry down/,
    );
    const noTags = () => Promise.reject(new Error("no remote"));
    expect(await start(ledger, b(), worldOf(files, noTags))).toMatch(
      /could not be read: no remote/,
    );
    expect(state("x-b")).toBe("waiting");
  });
});
