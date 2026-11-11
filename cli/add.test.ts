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
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compose } from "../main.ts";
import { advance } from "../orchestrator/advance.ts";
import { clOf } from "../process/plan.ts";
import { type Reader, readerImage } from "../effects/repo.ts";
import { add, approve, replan, submit } from "./add.ts";

let home: string;
let notes: string;
let repo: string;
const factory = () => compose({ home: join(home, "factory") });
const run = () => ({ repos: [repo], read });

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
## Check

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
  home = mkdtempSync(join(tmpdir(), "add-"));
  notes = join(home, "notes");
  repo = join(home, "repo");
  kinetic = join(home, "kinetic");
  mkdirSync(notes);
  writeFileSync(join(notes, "fx.md"), issue);
  onCrate(repo);
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "b.ts"), "export const b = 1;\n");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

let kinetic: string;
/** The kinetic repo: a real git repo, which submit reads with git. A test of submit has it, and add's have none. */
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
/** The repos a submit is given: the repo its cls change, and the kinetic repo, which holds the spec. */
const runK = () => ({ repos: [repo, kinetic], read });
const put = (name: string) => join(kinetic, "_well", `${name}.md`);
const note = (name: string, text: string) => writeFileSync(put(name), text);
/** Commits the kinetic repo's tree as it is, and gives the commit. */
const commit = (message: string) => {
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", message);
  return git("rev-parse", "HEAD");
};
/** Commits, and makes the commit the kinetic repo's server/main. */
const publish = (message: string) => {
  const sha = commit(message);
  git("update-ref", "refs/remotes/server/main", sha);
  return sha;
};

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

describe("add", () => {
  it("puts an issue in the ledger at open, for the factory's planner", () => {
    expect(add(factory, join(notes, "fx.md"), run())).toEqual({
      code: 0,
      lines: ["added fx, open, in repo"],
    });
    expect(factory().ledger.item("fx")).toMatchObject({
      state: "open",
      repo,
      image: "img",
      test: "scripts/check.sh all",
      setup: "npm ci --offline --no-audit --no-fund",
      repos: [],
    });
  });

  it("reads each repo's settings from it: its image from crate.toml, its dev image's tag from the host, no setup with no lockfile", () => {
    const other = join(home, "other");
    onCrate(other, "dev", false);
    expect(
      add(factory, join(notes, "fx.md"), { repos: [other], read }).lines[0],
    ).toMatch(/other's image is its dev image, and no tag was given/);
    expect(
      add(factory, join(notes, "fx.md"), {
        repos: [other],
        dev: { other: "ghcr.io/x/other-dev:abc" },
        read,
      }).code,
    ).toBe(0);
    expect(factory().ledger.item("fx")).toMatchObject({
      image: "ghcr.io/x/other-dev:abc",
      setup: "",
    });
  });

  it("puts an issue of several repos in with each, its own steps in the reader's image", () => {
    const other = join(home, "other");
    onCrate(other, "img2");
    expect(
      add(factory, join(notes, "fx.md"), { repos: [repo, other], read }).lines,
    ).toEqual(["added fx, open, in repo, other"]);
    const i = factory().ledger.item("fx");
    expect(i.image).toBe(readerImage);
    expect(i.repos.map((r) => [r.name, r.image])).toEqual([
      ["repo", "img"],
      ["other", "img2"],
    ]);
  });

  it("refuses a repo not on crate", () => {
    const bare = join(home, "bare");
    mkdirSync(join(bare, ".git"), { recursive: true });
    expect(
      add(factory, join(notes, "fx.md"), { repos: [bare], read }).lines[0],
    ).toMatch(/is not on crate: its server\/main has no crate.toml/);
  });

  it("given no repo, takes every repo on crate under its root, for the planner to pick among", () => {
    const other = join(home, "nest", "other");
    onCrate(other, "img2");
    // a git repo not on crate is left out
    mkdirSync(join(home, "plain", ".git"), { recursive: true });
    expect(
      add(factory, join(notes, "fx.md"), { repos: [], root: home, read }).lines,
    ).toEqual(["added fx, open, in other, repo"]);
    expect(
      factory()
        .ledger.item("fx")
        .repos.map((r) => r.repo),
    ).toEqual([other, repo]);
    expect(
      add(factory, join(notes, "fx.md"), { repos: [], root: notes, read })
        .lines,
    ).toEqual([`no repo on crate under ${notes}`]);
  });

  it("refuses a plan or a cl: its issue is submitted, which brings them", () => {
    writeFileSync(
      join(notes, "fx-plan.md"),
      plan("- Phase 1: a first\n\t- [[fx-a]]"),
    );
    expect(add(factory, join(notes, "fx-plan.md"), run()).lines[0]).toMatch(
      /is a plan: submit its issue/,
    );
  });

  it("refuses an issue with no repo, a repo that is not a git repo, and one in the ledger already", () => {
    expect(add(factory, join(notes, "fx.md"), { repos: [], read }).code).toBe(
      2,
    );
    expect(
      add(factory, join(notes, "fx.md"), { repos: [home], read }).lines[0],
    ).toMatch(/is not a git repo/);
    add(factory, join(notes, "fx.md"), run());
    expect(add(factory, join(notes, "fx.md"), run()).lines[0]).toMatch(
      /in the ledger already/,
    );
  });
});

describe("submit", () => {
  beforeEach(initKinetic);

  it("puts an issue with Matt's spec at building, by his two passes, and the engine builds it by phase from his notes", async () => {
    specNotes();
    const sha = publish("the spec");
    expect(submit(factory, "fx", runK())).toEqual({
      code: 0,
      lines: [
        "submitted fx, building, with 2 cls:",
        "  fx-a  phase 1",
        "  fx-c  phase 2",
      ],
    });
    const { ledger } = factory();
    expect(ledger.item("fx").state).toBe("building");
    expect(ledger.events("fx").map((e) => [e.by, e.word, e.to_state])).toEqual([
      [null, null, "open"],
      ["matt", "pass", "planned"],
      ["matt", "pass", "building"],
    ]);
    expect(ledger.attemptsOf("fx")).toEqual([]);
    expect(ledger.item("fx").path).toMatch(/_well\/fx\.md$/);
    expect(ledger.spec("fx")).toMatchObject({ by: "matt", commit: sha });
    await advance(ledger);
    expect(ledger.cls("fx").map((c) => [c.name, c.phase, c.state])).toEqual([
      ["fx-a", 1, "ready"],
      ["fx-c", 2, "waiting"],
    ]);
    const a = clOf(ledger, { name: "fx-a", issue: "fx" });
    expect(a.checkout).toEqual(["src/a.ts", "test/a.test.ts", "src/b.ts"]);
    // no step wrote a note: kinetic's tree is as committed
    expect(git("status", "--porcelain")).toBe("");
  });

  /**
   * A kinetic repo with three states of one spec: C, where fx-a changes src/a.ts and fx-c is a cl (C is server/main, and
   * the tag spec-1); D, committed after, where fx-a changes src/d.ts and fx-c is gone; and the tree after D, edited and not committed,
   * where fx-a changes src/w.ts. Gives C.
   */
  const history = () => {
    specNotes();
    const c = publish("C");
    git("tag", "spec-1", c);
    note("fx-a", cl("a", 1).replaceAll("src/a.ts", "src/d.ts"));
    rmSync(put("fx-c"));
    commit("D");
    note("fx-a", cl("a", 1).replaceAll("src/a.ts", "src/w.ts"));
    return c;
  };

  it.each([
    ["a commit", (c: string) => c],
    ["a ref", () => "spec-1"],
    ["none: the kinetic repo's server/main", () => undefined],
  ])(
    "reads the spec at the commit it is given, %s, with git and not from the working tree, and keeps the commit",
    async (_, at) => {
      const c = history();
      const done = submit(factory, "fx", { ...runK(), at: at(c) });
      expect(done.code).toBe(0);
      const { ledger } = factory();
      expect(ledger.spec("fx")?.commit).toBe(c);
      expect(ledger.spec("fx")?.commit).toMatch(/^[0-9a-f]{40}$/);
      await advance(ledger);
      expect(ledger.cls("fx").map((c) => c.name)).toEqual(["fx-a", "fx-c"]);
      expect(clOf(ledger, { name: "fx-a", issue: "fx" }).checkout).toEqual([
        "src/a.ts",
        "test/a.test.ts",
        "src/b.ts",
      ]);
      expect(clOf(ledger, { name: "fx-c", issue: "fx" }).checkout).toEqual([
        "src/c.ts",
        "test/c.test.ts",
        "src/b.ts",
      ]);
    },
  );

  it("refuses an issue whose note is not at the commit, naming the note and the commit, and leaves the ledger as it was", () => {
    const before = publish("before the issue");
    git("tag", "before", before);
    specNotes();
    publish("the spec");
    for (const [issueName, at, named] of [
      ["fx", before, before],
      ["fx", "before", "before"],
      ["nope", undefined, "server/main"],
    ] as const) {
      const done = submit(factory, issueName, { ...runK(), at });
      expect(done.code).toBe(1);
      expect(done.lines.join("\n")).toContain(`_well/${issueName}.md`);
      expect(done.lines.join("\n")).toContain(named);
      expect(factory().ledger.items()).toEqual([]);
    }
  });

  it("refuses an issue name that is not kebab-case, naming it, and leaves the ledger as it was", () => {
    // each bad name has its note at the commit, so only the name check stops it
    for (const name of ["My Issue", "Fx", "fx_a"]) {
      note(name, issue);
      note(`${name}-a`, cl("a", undefined, name));
    }
    publish("the spec");
    for (const name of ["My Issue", "Fx", "fx_a", "a/../b", ""]) {
      const done = submit(factory, name, runK());
      expect(done.code).toBe(1);
      expect(done.lines.join("\n")).toContain(name);
      expect(factory().ledger.items()).toEqual([]);
    }
  });

  it("refuses a submit given no repo named kinetic, naming the kinetic repo, and leaves the ledger as it was", () => {
    specNotes();
    publish("the spec");
    const other = join(home, "other");
    onCrate(other);
    for (const repos of [[repo], [repo, other]]) {
      const done = submit(factory, "fx", { repos, read });
      expect(done.code).toBe(1);
      expect(done.lines.join("\n")).toContain("kinetic");
      expect(factory().ledger.items()).toEqual([]);
    }
  });

  it("takes the lone cl of an issue that takes one, with no plan", async () => {
    note("fx", issue);
    note("fx-a", cl("a", undefined, "fx"));
    publish("the spec");
    expect(submit(factory, "fx", runK()).code).toBe(0);
    const { ledger } = factory();
    await advance(ledger);
    expect(ledger.cls("fx").map((c) => [c.name, c.phase, c.state])).toEqual([
      ["fx-a", 1, "ready"],
    ]);
  });

  it("refuses a spec its notes can't make whole, or that does not lint, and writes nothing", () => {
    specNotes();
    note("fx-c", cl("c", 1));
    publish("a phase that disagrees");
    expect(submit(factory, "fx", runK()).lines).toEqual([
      expect.stringMatching(
        /list puts fx-c in phase 2, and the cl says phase 1/,
      ),
    ]);
    note("fx-c", cl("c", 2).replace("src/b.ts", "../b.ts"));
    publish("a path outside the repo");
    expect(submit(factory, "fx", runK()).lines).toEqual([
      expect.stringMatching(
        /cl c: files outside the repo, or its root: ..\/b.ts/,
      ),
    ]);
    expect(factory().ledger.items()).toEqual([]);
  });

  it("sends its issue to Matt, escalated, on a raise about its plan, never to the factory's planner", async () => {
    specNotes();
    publish("the spec");
    expect(submit(factory, "fx", runK()).code).toBe(0);
    const { ledger } = factory();
    await advance(ledger);
    ledger.apply(
      "fx-a",
      {
        word: "back",
        reason: "back",
        findings: [{ about: "plan", what: "no seam", where: "Seam" }],
      },
      { attempt: ledger.begin("fx-a") },
    );
    await advance(ledger);
    expect(ledger.item("fx").state).toBe("escalated");
    expect(ledger.events("fx").at(-1)).toMatchObject({
      by: "orchestrator",
      findings: [{ about: "plan", what: "no seam" }],
    });
  });
});

describe("approve and replan", () => {
  beforeEach(initKinetic);

  it("approve is Matt's pass at plan review, and refuses any other state", () => {
    add(factory, join(notes, "fx.md"), run());
    expect(approve(factory, "fx").lines[0]).toMatch(
      /fx is open: approve takes an issue at planned/,
    );
    const { ledger } = factory();
    ledger.apply(
      "fx",
      { word: "pass", reason: "Matt planned it", findings: [] },
      "matt",
    );
    expect(approve(factory, "fx")).toEqual({
      code: 0,
      lines: ["approved fx, building"],
    });
    expect(ledger.events("fx").at(-1)).toMatchObject({
      by: "matt",
      to_state: "building",
    });
  });

  it("approve refuses while plan-review is judging the plan", () => {
    add(factory, join(notes, "fx.md"), run());
    const { ledger } = factory();
    ledger.apply(
      "fx",
      { word: "pass", reason: "planned", findings: [] },
      "matt",
    );
    ledger.begin("fx");
    expect(approve(factory, "fx").lines[0]).toMatch(/attempt open/);
  });

  it("replan sends an escalated issue back to open, drops its cls not landed, and lets go of Matt's spec", async () => {
    specNotes();
    publish("the spec");
    expect(submit(factory, "fx", runK()).code).toBe(0);
    const { ledger } = factory();
    await advance(ledger);
    expect(replan(factory, "fx").lines[0]).toMatch(
      /fx is building: replan takes/,
    );
    ledger.apply(
      "fx",
      { word: "escalate", reason: "test", findings: [] },
      "orchestrator",
    );
    expect(replan(factory, "fx").code).toBe(0);
    expect(ledger.item("fx").state).toBe("open");
    expect(ledger.cls("fx").map((c) => c.state)).toEqual([
      "dropped",
      "dropped",
    ]);
    expect(ledger.spec("fx")).toBeUndefined();
    // the dropped cls' notes are as they were: the ledger says they are dropped
    expect(readFileSync(put("fx-a"), "utf8")).toMatch(/^status: new$/m);
    expect(readFileSync(put("fx-c"), "utf8")).toMatch(/^status: new$/m);
    expect(git("status", "--porcelain")).toBe("");
  });
});
