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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compose } from "../main.ts";
import { advance, type World } from "../orchestrator/advance.ts";
import { notesAt } from "../effects/notes.ts";
import { clOf } from "../process/plan.ts";
import type { Reader } from "../effects/repo.ts";
import { npmRegistryUrl } from "../effects/registry.ts";
import { approve, replan, retry, submit } from "./levers.ts";

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

describe("approve, replan and retry", () => {
  /** fx submitted with no cl notes: at open, for the planner. */
  const atOpen = async () => {
    note("fx", issue);
    publish("the issue");
    await submit(factory, "fx", runK());
  };

  it("approve is Matt's pass at plan review: the plan goes to its land; it refuses any other state", async () => {
    await atOpen();
    expect(approve(factory, "fx").lines[0]).toMatch(
      /fx is open: approve takes an issue at planned/,
    );
    const { ledger } = factory();
    ledger.apply(
      "fx",
      { word: "pass", reason: "planned", findings: [] },
      { attempt: ledger.begin("fx") },
    );
    expect(approve(factory, "fx")).toEqual({
      code: 0,
      lines: ["approved fx: its plan lands"],
    });
    expect(ledger.events("fx").at(-1)).toMatchObject({
      by: "matt",
      to_state: "approved",
    });
  });

  it("approve refuses while plan-review is judging the plan", async () => {
    await atOpen();
    const { ledger } = factory();
    ledger.apply(
      "fx",
      { word: "pass", reason: "planned", findings: [] },
      { attempt: ledger.begin("fx") },
    );
    ledger.begin("fx");
    expect(approve(factory, "fx").lines[0]).toMatch(/attempt open/);
  });

  it("replan sends an escalated issue back to open, and drops its cls not landed; their notes stay as they are", async () => {
    specNotes();
    publish("the spec");
    expect((await submit(factory, "fx", runK())).code).toBe(0);
    const { ledger } = factory();
    await advance(ledger, world());
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
    expect(readFileSync(put("fx-a"), "utf8")).toMatch(/^status: new$/m);
    expect(git("status", "--porcelain")).toBe("");
  });

  it("retry takes an escalated issue and its escalated cls back to where each was", async () => {
    specNotes();
    publish("the spec");
    expect((await submit(factory, "fx", runK())).code).toBe(0);
    const { ledger } = factory();
    await advance(ledger, world());
    const [a, c] = ledger.cls("fx").map((x) => x.name) as [string, string];
    const before = ledger.cls("fx").map((x) => x.state);
    expect(retry(factory, "fx").lines[0]).toMatch(
      /fx is building: retry takes an item that is escalated/,
    );
    ledger.apply(
      a,
      { word: "escalate", reason: "setup", findings: [] },
      "orchestrator",
    );
    ledger.apply(
      "fx",
      { word: "escalate", reason: "its cl is", findings: [] },
      "orchestrator",
    );
    expect(retry(factory, "fx")).toEqual({
      code: 0,
      lines: ["retried fx:", "  fx  building", `  ${a}  ${before[0]}`],
    });
    expect(ledger.item("fx").state).toBe("building");
    expect(ledger.cls("fx").map((x) => x.state)).toEqual(before);
    ledger.apply(
      a,
      { word: "escalate", reason: "again", findings: [] },
      "orchestrator",
    );
    expect(retry(factory, a).code).toBe(0);
    expect(ledger.item(a).state).toBe(before[0]);
    expect(ledger.item(c).state).toBe(before[1]);
    expect(retry(factory, "nope").lines).toEqual([
      "no item nope in the ledger",
    ]);
  });
});
