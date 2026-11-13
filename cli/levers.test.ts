import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compose } from "../main.ts";
import { advance, type World } from "../orchestrator/advance.ts";
import { notesAt } from "../effects/notes.ts";
import { clOf } from "../process/plan.ts";
import type { Reader } from "../effects/repo.ts";
import { npmRegistryUrl } from "../effects/registry.ts";
import { drop, resume, stop, submit } from "./levers.ts";

// The notes' main is the kinetic repo's own main: it has no remote to fetch.
vi.mock("../effects/git.ts", async (original) => ({
  ...(await original<typeof import("../effects/git.ts")>()),
  mainOf: vi.fn(async () => "main"),
}));

let home: string;
let repo: string;
const factory = () => compose({ home: join(home, "factory") });

// An issue, its plan and its cl notes as kinetic's types write them by hand: YAML lists in block form.
const issue =
  "---\ntype: issue\nstatus: new\n---\nfx.\n\n---\n## Done\n\n- a is 2\n";
const plan = (phases: string) => `---
type: plan
description: "The plan of fx."
belongsTo: "[[fx]]"
status: active
---
fx, a part at a time.

---
## Phases

${phases}

## Does not fit

Nothing.
`;
const cl = (name: string, phase?: number, belongsTo = "fx-plan") => `---
type: cl
description: "A cut of fx."
belongsTo: "[[${belongsTo}]]"
status: new
${phase === undefined ? "" : `phase: ${phase}\n`}repo: repo
shape:
  change: behavior
  checked: repo
checkout:
  - src/${name}.ts
  - test/${name}.test.ts
  - src/b.ts
test: npx vitest run test/${name}.test.ts
---
src/${name}.ts exports ${name}, which is 2.

---
## Promises

- given ${name}, when imported, then it is 2

## Seam

${name}'s name and type.

## Checkout

- src/b.ts: the exemplar
`;

/** A repo on crate: its image and its full suite, and a lockfile unless told not to. */
function onCrate(at: string, image = "img", lock = true) {
  mkdirSync(join(at, ".git"), { recursive: true });
  mkdirSync(join(at, "scripts"), { recursive: true });
  writeFileSync(join(at, "crate.toml"), `crate = "1"\nimage = "${image}"\n`);
  writeFileSync(join(at, "scripts", "check.sh"), "#!/bin/sh\n");
  if (lock) writeFileSync(join(at, "package-lock.json"), "{}\n");
}

/** The repo as a test has it: its files on disk are its main's, and it is on crate when it has a crate.toml. */
const read: Reader = {
  file: (path, file) =>
    existsSync(join(path, file))
      ? readFileSync(join(path, file), "utf8")
      : undefined,
  onCrate: (path) => existsSync(join(path, "crate.toml")),
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "levers-"));
  repo = join(home, "repo");
  kinetic = join(home, "kinetic");
  onCrate(repo);
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "b.ts"), "export const b = 1;\n");
  initKinetic();
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

let kinetic: string;
/** The kinetic repo, the notes repo: a real git repo, which submit reads with git, at its main. */
const initKinetic = () => {
  mkdirSync(kinetic);
  git("init", "-q", "-b", "main");
  onCrate(kinetic);
  mkdirSync(join(kinetic, "_well"));
};
const git = (...args: string[]) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "-c",
      "commit.gpgsign=false",
      "-C",
      kinetic,
      ...args,
    ],
    { encoding: "utf8" },
  ).trim();
/** What a submit is given: the repo its cls change, and the notes repo, which holds the spec. */
const runK = () => ({ repos: [repo], notes: kinetic, read });
const put = (name: string) => join(kinetic, "_well", `${name}.md`);
const note = (name: string, text: string) => writeFileSync(put(name), text);
/** Commits the kinetic repo's tree as it is, and gives the commit. */
const commit = (message: string) => {
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", message);
  return git("rev-parse", "HEAD");
};
/** Commits on the kinetic repo's main. */
const publish = commit;

/** The world a building issue reads its notes from: the kinetic repo, and nothing to wait for. */
const world = (): World => ({
  runs: join(home, "factory", "runs"),
  notes: kinetic,
  registry: { url: npmRegistryUrl, published: async () => true },
  reader: read,
  tags: async () => [],
});
/** A cl's spec, read from its note at the kinetic repo's main. */
const clAt = (name: string) =>
  clOf(notesAt(kinetic, "main"), {
    name,
    issue: "fx",
    note: `_well/${name}.md`,
  });

const twoPhases = () => {
  note(
    "fx-plan",
    plan("- Phase 1: a first\n\t- [[fx-a]]\n- Phase 2: then c\n\t- [[fx-c]]"),
  );
  note("fx-a", cl("a", 1));
  note("fx-c", cl("c", 2));
};
/** The issue, its plan and its two cls in the kinetic repo's tree. */
const specNotes = () => {
  note("fx", issue);
  twoPhases();
};

describe("submit", () => {
  it("puts an issue with Matt's spec at building, and the engine builds it by phase from his notes at main", async () => {
    specNotes();
    publish("the spec");
    expect(await submit(factory, "fx", runK())).toEqual({
      code: 0,
      lines: [
        "submitted fx, building, with 2 cls:",
        "  fx-a  phase 1",
        "  fx-c  phase 2",
      ],
    });
    const { ledger } = factory();
    expect(ledger.item("fx")).toMatchObject({
      state: "building",
      note: "_well/fx.md",
      repo,
      repos: [],
    });
    expect(ledger.events("fx").map((e) => [e.by, e.word, e.to_state])).toEqual([
      [null, null, "building"],
    ]);
    expect(ledger.attemptsOf("fx")).toEqual([]);
    await advance(ledger, world());
    expect(ledger.cls("fx").map((c) => [c.name, c.phase, c.state])).toEqual([
      ["fx-a", 1, "ready"],
      ["fx-c", 2, "waiting"],
    ]);
    expect(clAt("fx-a").checkout).toEqual([
      "src/a.ts",
      "test/a.test.ts",
      "src/b.ts",
    ]);
    // no step wrote a note: kinetic's tree is as committed
    expect(git("status", "--porcelain")).toBe("");
  });

  it("reads the notes at main with git, never from the working tree", async () => {
    specNotes();
    publish("C");
    note("fx-a", cl("a", 1).replaceAll("src/a.ts", "src/w.ts"));
    rmSync(put("fx-c"));
    expect((await submit(factory, "fx", runK())).code).toBe(0);
    const { ledger } = factory();
    await advance(ledger, world());
    expect(ledger.cls("fx").map((c) => c.name)).toEqual(["fx-a", "fx-c"]);
    expect(clAt("fx-a").checkout[0]).toBe("src/a.ts");
  });

  it("puts an issue with no cl notes at open, for the factory's planner, in each repo it is given", async () => {
    note("fx", issue);
    publish("the issue");
    const other = join(home, "other");
    onCrate(other, "img2");
    expect(
      await submit(factory, "fx", { ...runK(), repos: [repo, other] }),
    ).toEqual({ code: 0, lines: ["submitted fx, open, in repo, other"] });
    expect(factory().ledger.item("fx")).toMatchObject({
      state: "open",
      repo,
      repos: [repo, other],
    });
  });

  it("given no repo, takes every repo on crate under its root but the notes repo, for the planner to pick among", async () => {
    note("fx", issue);
    publish("the issue");
    const other = join(home, "nest", "other");
    onCrate(other, "img2");
    // a git repo not on crate is left out
    mkdirSync(join(home, "plain", ".git"), { recursive: true });
    expect(
      (await submit(factory, "fx", { ...runK(), repos: [], root: home })).lines,
    ).toEqual(["submitted fx, open, in other, repo"]);
    expect(factory().ledger.item("fx").repos).toEqual([other, repo]);
    expect(
      (
        await submit(factory, "gx", {
          ...runK(),
          repos: [],
          root: join(home, "plain"),
        })
      ).lines,
    ).toEqual([`no repo on crate under ${join(home, "plain")}`]);
  });

  it("refuses an issue whose note is not at main, or not an issue, naming it, and leaves the ledger as it was", async () => {
    note("fx", issue);
    note("fx-plan", plan("- Phase 1: a first\n\t- [[fx-a]]"));
    commit("main");
    note("later", issue);
    for (const [name, says] of [
      ["later", "no note _well/later.md at the main of"],
      ["nope", "no note _well/nope.md"],
      ["fx-plan", "_well/fx-plan.md: its type is plan: an issue is needed"],
    ] as const) {
      const done = await submit(factory, name, runK());
      expect(done.code).toBe(1);
      expect(done.lines.join("\n")).toContain(says);
    }
    expect(factory().ledger.items()).toEqual([]);
  });

  it("refuses an issue name that is not kebab-case, naming it, and leaves the ledger as it was", async () => {
    // each bad name has its note at main, so only the name check stops it
    for (const name of ["My Issue", "Fx", "fx_a"]) {
      note(name, issue);
      note(`${name}-a`, cl("a", undefined, name));
    }
    publish("the spec");
    for (const name of ["My Issue", "Fx", "fx_a", "a/../b", ""]) {
      const done = await submit(factory, name, runK());
      expect(done.code).toBe(1);
      expect(done.lines.join("\n")).toContain(name);
      expect(factory().ledger.items()).toEqual([]);
    }
  });

  it("refuses an issue with no repo, a repo that is not a git repo, an issue with no Done, and one in the ledger already", async () => {
    note("fx", issue);
    note("gx", "---\ntype: issue\n---\nNo done.\n");
    publish("the issues");
    expect((await submit(factory, "fx", { ...runK(), repos: [] })).code).toBe(
      2,
    );
    expect(
      (await submit(factory, "fx", { ...runK(), repos: [home] })).lines[0],
    ).toMatch(/is not a git repo/);
    expect((await submit(factory, "gx", runK())).lines[0]).toMatch(
      /its Done has no items/,
    );
    await submit(factory, "fx", runK());
    expect((await submit(factory, "fx", runK())).lines[0]).toMatch(
      /in the ledger already/,
    );
  });

  it("takes the lone cl of an issue that takes one, with no plan", async () => {
    note("fx", issue);
    note("fx-a", cl("a", undefined, "fx"));
    publish("the spec");
    expect((await submit(factory, "fx", runK())).code).toBe(0);
    const { ledger } = factory();
    await advance(ledger, world());
    expect(ledger.cls("fx").map((c) => [c.name, c.phase, c.state])).toEqual([
      ["fx-a", 1, "ready"],
    ]);
  });

  it("refuses a spec its notes can't make whole, or that does not lint, and writes nothing", async () => {
    specNotes();
    note("fx-c", cl("c", 1));
    publish("a phase that disagrees");
    expect((await submit(factory, "fx", runK())).lines).toEqual([
      expect.stringMatching(
        /list puts fx-c in phase 2, and the cl says phase 1/,
      ),
    ]);
    note("fx-c", cl("c", 2).replace("src/b.ts", "../b.ts"));
    publish("a path outside the repo");
    expect((await submit(factory, "fx", runK())).lines).toEqual([
      expect.stringMatching(
        /cl c: files outside the repo, or its root: ..\/b.ts/,
      ),
    ]);
    expect(factory().ledger.items()).toEqual([]);
  });

  it("sends its issue to Matt, escalated, on a raise about its plan, with the raise's findings", async () => {
    specNotes();
    publish("the spec");
    expect((await submit(factory, "fx", runK())).code).toBe(0);
    const { ledger } = factory();
    await advance(ledger, world());
    ledger.apply(
      "fx-a",
      {
        word: "back",
        reason: "back",
        findings: [{ about: "plan", what: "no seam", where: "Seam" }],
      },
      { attempt: ledger.begin("fx-a") },
    );
    await advance(ledger, world());
    expect(ledger.item("fx").state).toBe("escalated");
    expect(ledger.events("fx").at(-1)).toMatchObject({
      by: "orchestrator",
      findings: [{ about: "plan", what: "no seam" }],
    });
  });
});

describe("stop and resume", () => {
  /** fx submitted with Matt's spec and built from his notes: fx-a ready, fx-c waiting. */
  const building = async () => {
    specNotes();
    publish("the spec");
    expect((await submit(factory, "fx", runK())).code).toBe(0);
    const { ledger } = factory();
    await advance(ledger, world());
    return ledger;
  };
  const go = (name: string, state?: string) =>
    resume(factory, name, state, { notes: kinetic });

  it("stop escalates an item that moves, as Matt; its open attempt ends there, and nothing new starts", async () => {
    const ledger = await building();
    const n = ledger.begin("fx-a");
    expect(stop(factory, "fx-a")).toEqual({
      code: 0,
      lines: [
        "stopped fx-a, at ready: its open attempt finishes, and nothing new starts",
      ],
    });
    expect(ledger.events("fx-a").at(-1)).toMatchObject({
      by: "matt",
      word: "escalate",
      to_state: "escalated",
    });
    // the attempt it let finish ends, and the cl stays Matt's
    ledger.apply(
      "fx-a",
      { word: "pass", reason: "red", findings: [] },
      { attempt: n },
    );
    expect(ledger.item("fx-a").state).toBe("escalated");
    expect(ledger.waiting(["ready", "red"])).toEqual([]);
    expect(stop(factory, "fx").lines).toEqual(["stopped fx, at building"]);
  });

  it("stop refuses an item that has ended, one Matt holds, and one not in the ledger", async () => {
    const ledger = await building();
    ledger.apply("fx-c", { word: "drop", reason: "r", findings: [] }, "matt");
    expect(stop(factory, "fx-c").lines[0]).toMatch(/fx-c is dropped/);
    stop(factory, "fx-a");
    expect(stop(factory, "fx-a").lines[0]).toMatch(/fx-a is escalated/);
    expect(stop(factory, "nope").lines).toEqual(["no item nope in the ledger"]);
  });

  it("drop ends an issue and its cls not ended, as Matt, and keeps their record", async () => {
    const ledger = await building();
    ledger.apply(
      "fx-a",
      { word: "pass", reason: "red", findings: [] },
      { attempt: ledger.begin("fx-a") },
    );
    stop(factory, "fx");
    expect(drop(factory, "fx")).toEqual({
      code: 0,
      lines: ["dropped fx", "  fx-a  dropped", "  fx-c  dropped"],
    });
    for (const name of ["fx", "fx-a", "fx-c"]) {
      expect(ledger.item(name).state).toBe("dropped");
      expect(ledger.events(name).at(-1)).toMatchObject({
        by: "matt",
        word: "drop",
      });
    }
    // the record stays: fx-a's attempt and its messages
    expect(ledger.attemptsOf("fx-a")).toHaveLength(1);
    expect(ledger.waiting(["ready", "red", "waiting"])).toEqual([]);
  });

  it("drop refuses an item that has ended, one not in the ledger, and one with an attempt open on it or its cls", async () => {
    const ledger = await building();
    ledger.begin("fx-a");
    expect(drop(factory, "fx").lines).toEqual([
      "fx-a has an attempt open: stop fx, and drop it once the attempt ends",
    ]);
    expect(ledger.item("fx").state).toBe("building");
    ledger.apply("fx-c", { word: "drop", reason: "r", findings: [] }, "matt");
    expect(drop(factory, "fx-c").lines[0]).toMatch(/fx-c is dropped/);
    expect(drop(factory, "nope").lines).toEqual(["no item nope in the ledger"]);
  });

  it("resume takes a cl back to where it was stopped, by default, with a fresh budget", async () => {
    const ledger = await building();
    ledger.apply(
      "fx-a",
      { word: "pass", reason: "red", findings: [] },
      { attempt: ledger.begin("fx-a") },
    );
    ledger.apply(
      "fx-a",
      { word: "pass", reason: "green", findings: [] },
      { attempt: ledger.begin("fx-a") },
    );
    const back = {
      word: "back" as const,
      reason: "r",
      findings: [{ about: "code" as const, what: "w", where: "x" }],
    };
    ledger.apply("fx-a", back, { attempt: ledger.begin("fx-a") });
    ledger.apply(
      "fx-a",
      { word: "retry", reason: "red", findings: [] },
      { attempt: ledger.begin("fx-a") },
    );
    expect(ledger.rounds("fx-a")).toBe(1);
    stop(factory, "fx-a");
    expect(await go("fx-a")).toEqual({
      code: 0,
      lines: ["resumed fx-a, at red"],
    });
    expect(ledger.item("fx-a").state).toBe("red");
    expect(ledger.rounds("fx-a")).toBe(0);
    expect(ledger.attempts("fx-a", "red")).toBe(0);
  });

  it("resume takes a cl to any station given, and refuses a state that is no station of a cl", async () => {
    const ledger = await building();
    stop(factory, "fx-a");
    expect((await go("fx-a", "building")).lines[0]).toMatch(
      /building is no station of a cl: ready, red, green, approved/,
    );
    expect((await go("fx-a", "green")).code).toBe(0);
    expect(ledger.item("fx-a").state).toBe("green");
  });

  it("resume takes a raised cl back to the state it raised from", async () => {
    const ledger = await building();
    ledger.apply(
      "fx-a",
      {
        word: "back",
        reason: "r",
        findings: [{ about: "cl", what: "w", where: "x" }],
      },
      { attempt: ledger.begin("fx-a") },
    );
    expect(ledger.item("fx-a").state).toBe("raised");
    expect(await go("fx-a")).toEqual({
      code: 0,
      lines: ["resumed fx-a, at ready"],
    });
  });

  it("resume refuses an item Matt does not hold, and one with an attempt still open", async () => {
    const ledger = await building();
    expect((await go("fx-a")).lines[0]).toMatch(
      /fx-a is ready: resume takes an item that is escalated or raised/,
    );
    ledger.begin("fx-a");
    stop(factory, "fx-a");
    expect((await go("fx-a")).lines[0]).toMatch(/attempt open: it ends first/);
  });

  it("resume of an issue to building makes its cls match its notes at main: a new cl added, a gone one dropped, its held cls back", async () => {
    const ledger = await building();
    stop(factory, "fx-a");
    await advance(ledger, world());
    expect(ledger.item("fx").state).toBe("escalated");
    // Matt edits the notes: fx-c is gone, fx-d is new, in phase 2
    rmSync(put("fx-c"));
    note("fx-d", cl("d", 2));
    note(
      "fx-plan",
      plan("- Phase 1: a first\n\t- [[fx-a]]\n- Phase 2: then d\n\t- [[fx-d]]"),
    );
    publish("Matt's fix");
    expect(await go("fx")).toEqual({
      code: 0,
      lines: [
        "resumed fx, at building",
        "  fx-d  waiting, added",
        "  fx-a  ready",
        "  fx-c  dropped: its note is gone",
      ],
    });
    expect(ledger.cls("fx").map((c) => [c.name, c.state])).toEqual([
      ["fx-a", "ready"],
      ["fx-c", "dropped"],
      ["fx-d", "waiting"],
    ]);
    expect(ledger.item("fx").state).toBe("building");
  });

  it("resume of an issue to building refuses notes that do not read as a spec, and changes nothing", async () => {
    const ledger = await building();
    stop(factory, "fx");
    note("fx-c", cl("c", 2).replace("src/b.ts", "../b.ts"));
    publish("a path outside the repo");
    expect((await go("fx")).lines).toEqual([
      expect.stringMatching(/files outside the repo/),
    ]);
    expect(ledger.item("fx").state).toBe("escalated");
  });

  it("resume of an issue to open drops its cls not landed, for its planner to plan again", async () => {
    const ledger = await building();
    ledger.landed("fx-a", "c".repeat(40), []);
    stop(factory, "fx");
    const db = new DatabaseSync(join(home, "factory", "ledger.db"));
    db.prepare("UPDATE items SET state = 'landed' WHERE name = 'fx-a'").run();
    db.close();
    expect(await go("fx", "open")).toEqual({
      code: 0,
      lines: ["resumed fx, at open", "  fx-c  dropped"],
    });
    expect(ledger.cls("fx").map((c) => c.state)).toEqual(["landed", "dropped"]);
    expect(ledger.item("fx").state).toBe("open");
    // the notes stay as they are: the ledger says the cls are dropped
    expect(readFileSync(put("fx-c"), "utf8")).toMatch(/^status: new$/m);
  });

  it("resume of an issue stopped at planned to approved is Matt's pass of plan review: its planner's plan lands", async () => {
    note("fx", issue);
    publish("the issue");
    await submit(factory, "fx", runK());
    const { ledger } = factory();
    stop(factory, "fx");
    expect((await go("fx", "approved")).lines).toEqual([
      "fx has no plan of its planner's to land",
    ]);
    await resume(factory, "fx", "open", {});
    ledger.apply(
      "fx",
      { word: "pass", reason: "planned", findings: [] },
      { attempt: ledger.begin("fx"), result: { word: "done", cls: [] } },
    );
    stop(factory, "fx");
    expect((await go("fx")).lines).toEqual(["resumed fx, at planned"]);
    stop(factory, "fx");
    expect((await go("fx", "approved")).lines).toEqual([
      "resumed fx, at approved",
    ]);
    expect(ledger.item("fx").state).toBe("approved");
  });
});
