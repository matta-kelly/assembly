import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { move } from "../effects/move.ts";
import { notesRepo } from "../effects/notes.fixture.ts";
import { npmRegistryUrl } from "../effects/registry.ts";
import { advance, reconcile, writePlan, type World } from "./advance.ts";
import { type Ledger, open } from "./ledger.ts";
import { notesAt, sectionIn } from "../effects/notes.ts";
import { type ClSpec, type Planned, readSpec } from "../process/plan.ts";

// The move runs a container: the unit tests stand it in. Main is the notes repo's own: it has no remote to fetch.
vi.mock("../effects/move.ts", () => ({ move: vi.fn() }));
vi.mock("../effects/git.ts", async (original) => ({
  ...(await original<typeof import("../effects/git.ts")>()),
  mainOf: vi.fn(async () => "main"),
}));

const issueNote =
  "---\ntype: issue\nstatus: new\n---\nOne value.\n\n---\n## Done\n\n- value is 2\n- double is 4\n";
const cl = (name: string, phase?: number): ClSpec => ({
  name,
  intent: `${name} is right`,
  ...(phase === undefined ? {} : { phase }),
  shape: { change: "behavior", checked: "repo" },
  checkout: [`src/${name}.mjs`, `test/${name}.test.mjs`],
  test: `node --test test/${name}.test.mjs`,
  promises: [`given ${name}, when read, then right`],
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
let notes: ReturnType<typeof notesRepo>;
/** The world of a factory with nothing to wait for, on the test's notes repo. */
let world: World;

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
  world = {
    runs: join(dir, "runs"),
    notes: notes.repo,
    registry: { url: npmRegistryUrl, published: async () => true },
    reader: { file: () => undefined, onCrate: () => true },
    tags: async () => [],
  };
  ledger = open(join(dir, "ledger.db"));
  ledger.addIssue({ name: "is", note: "_well/is.md", repos: ["/repo"] });
  planned();
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const state = (name: string) => ledger.item(name).state;
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
    expect(onMain("is-value")).toContain(
      'checkout: ["src/value.mjs","test/value.test.mjs"]',
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
    await advance(ledger, world);
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
  it("puts the cls of the notes on main in the ledger once the plan landed, phase 1 ready", async () => {
    await advance(ledger, world);
    expect(ledger.cls("is")).toEqual([]);
    landPlan();
    await advance(ledger, world);
    expect(
      ledger.cls("is").map((c) => [c.name, c.phase, c.state, c.note]),
    ).toEqual([
      ["is-value", 1, "ready", "_well/is-value.md"],
      ["is-double", 2, "waiting", "_well/is-double.md"],
    ]);
  });

  it("starts every cl of a phase together, and the next phase once all of them land", async () => {
    force("is", "open");
    planned({ ...plan, cls: [cl("a", 1), cl("b", 1), cl("c", 2)] });
    landPlan();
    await advance(ledger, world);
    expect(["is-a", "is-b", "is-c"].map(state)).toEqual([
      "ready",
      "ready",
      "waiting",
    ]);
    force("is-a", "landed");
    await advance(ledger, world);
    expect(state("is-c")).toBe("waiting");
    force("is-b", "landed");
    await advance(ledger, world);
    expect(state("is-c")).toBe("ready");
  });

  it("leaves an approved cl to its land, and starts the next phase once it has landed", async () => {
    landPlan();
    await advance(ledger, world);
    force("is-value", "approved");
    await advance(ledger, world);
    expect([state("is-value"), state("is-double")]).toEqual([
      "approved",
      "waiting",
    ]);
    force("is-value", "landed");
    await advance(ledger, world);
    expect(state("is-double")).toBe("ready");
  });

  it("marks the issue built once the cls of its notes have all landed", async () => {
    landPlan();
    await advance(ledger, world);
    for (const c of ["is-value", "is-double"]) {
      force(c, "landed");
      await advance(ledger, world);
    }
    expect(state("is")).toBe("built");
  });

  it("adds a cl note put on main while the issue built, before it is built", async () => {
    landPlan();
    await advance(ledger, world);
    for (const c of ["is-value", "is-double"]) force(c, "landed");
    notes.commit({
      "_well/is-extra.md": onMain("is-value").replace(/value/g, "extra"),
    });
    await advance(ledger, world);
    expect(state("is")).toBe("building");
    expect(state("is-extra")).toBe("ready");
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

  it.each(["cl", "plan", "issue"] as const)(
    "escalates the issue on a raise about the %s, its findings with it, and its cls stay as they are",
    async (about) => {
      landPlan();
      await advance(ledger, world);
      raise("is-value", about);
      await advance(ledger, world);
      expect(state("is")).toBe("escalated");
      expect(state("is-value")).toBe("raised");
      expect(state("is-double")).toBe("waiting");
      expect(ledger.inbox("is", "escalated")).toMatchObject([
        {
          word: "escalate",
          reason: expect.stringMatching(/is-value is raised/),
          findings: [{ about, what: "the seam is not there" }],
        },
      ]);
      await advance(ledger, world);
      expect(
        ledger.events("is-double").filter((e) => e["to_state"] === "ready"),
      ).toEqual([]);
      expect(
        ledger.events("is").filter((e) => e.word === "escalate"),
      ).toHaveLength(1);
    },
  );

  it("escalates the issue when one of its cls is", async () => {
    landPlan();
    await advance(ledger, world);
    force("is-value", "escalated");
    await advance(ledger, world);
    expect(state("is")).toBe("escalated");
  });

  it("escalates an issue whose notes do not read as a spec, with why, and goes on with the rest", async () => {
    landPlan();
    ledger.addIssue(
      { name: "other", note: "_well/other.md", repos: ["/repo"] },
      "building",
    );
    await advance(ledger, world);
    expect(state("other")).toBe("escalated");
    expect(ledger.events("other").at(-1)).toMatchObject({
      by: "orchestrator",
      word: "escalate",
      reason: expect.stringMatching(
        /move failed: no issue note at _well\/other\.md/,
      ),
    });
    expect(state("is-value")).toBe("ready");
  });

  it("reads no notes while an issue building has a cl to land", async () => {
    landPlan();
    await advance(ledger, world);
    rmSync(notes.repo, { recursive: true, force: true });
    await advance(ledger, world);
    expect(state("is")).toBe("building");
  });

  it("leaves an accepted issue's notes as they are: the ledger says it is accepted", async () => {
    landPlan();
    await advance(ledger, world);
    const before = notesAt(notes.repo, "main").names("_well");
    force("is", "accepted");
    await advance(ledger, world);
    expect(notesAt(notes.repo, "main").names("_well")).toEqual(before);
    expect(state("is")).toBe("accepted");
  });
});

describe("a resume's reconcile", () => {
  it("adds a new cl note, drops a cl whose note is gone and has not landed, and keeps the rest", async () => {
    landPlan();
    await advance(ledger, world);
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

describe("advance across repos", () => {
  const pkg = (name: string, deps: Record<string, string> = {}) =>
    JSON.stringify({ name, version: "0.0.0", dependencies: deps });
  const minute = 60_000;
  const at = (min: number) => new Date(Date.UTC(2026, 0, 1, 12, min));

  /** An issue "x" with a cl of repo /a landed in phase 1, and a cl of repo /b waiting in phase 2. */
  function across() {
    ledger.addIssue({ name: "x", note: "_well/x.md", repos: ["/a"] });
    for (const [name, repo, phase, state] of [
      ["x-a", "/a", 1, "ready"],
      ["x-b", "/b", 2, "waiting"],
    ] as const)
      ledger.addCl(
        {
          name,
          issue: "x",
          seq: phase,
          phase,
          note: `_well/${name}.md`,
          repo,
        },
        state,
      );
    force("x-a", "landed");
  }

  /** The same, but x-a lands through the ledger at minute 0, so its land has a time. */
  function landedAtNoon() {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at(0));
    across();
    force("x-a", "approved");
    ledger.apply(
      "x-a",
      { word: "pass", reason: "landed", findings: [] },
      "orchestrator",
    );
  }

  /** The world: repo files by "<repo>:<file>", the tags the land of x-a put on main, the registry. */
  const worldOf = (
    files: Record<string, string>,
    tags: string[] | (() => Promise<string[]>),
    registry: {
      url: string;
      published: (n: string, v: string) => Promise<boolean>;
    },
    limitMs?: number,
  ) => ({
    runs: join(dir, "runs"),
    notes: notes.repo,
    registry,
    reader: {
      file: (repo: string, file: string) => files[`${repo}:${file}`],
      onCrate: () => true,
    },
    tags: async (_repo: string, cl: string) =>
      cl !== "x-a" ? [] : typeof tags === "function" ? tags() : tags,
    ...(limitMs === undefined ? {} : { limitMs }),
  });
  const registryOf = (answer: boolean) => ({
    url: npmRegistryUrl,
    published: vi.fn<(n: string, v: string) => Promise<boolean>>(
      async () => answer,
    ),
  });
  const files = {
    "/a:package.json": pkg("@s/alpha"),
    "/b:package.json": pkg("@s/beta", { "@s/alpha": "^1.2.0" }),
  };
  /** What the orchestrator said on a cl while it waited: each retry's reason. */
  const said = (name: string) =>
    ledger
      .events(name)
      .filter((e) => e.word === "retry")
      .map((e) => e.reason);

  it("keeps a cl waiting until the landed version is on npm, and says why in the ledger: the package and version, once", async () => {
    across();
    const registry = registryOf(false);
    const world = worldOf(files, ["v1.2.0"], registry);
    await advance(ledger, world);
    await advance(ledger, world);
    await advance(ledger, world);
    expect(state("x-b")).toBe("waiting");
    expect(said("x-b")).toHaveLength(1);
    expect(said("x-b")[0]).toMatch(/@s\/alpha/);
    expect(said("x-b")[0]).toMatch(/1\.2\.0/);
    expect(ledger.events("x-b").at(-1)).toMatchObject({ by: "orchestrator" });
    expect(registry.published).toHaveBeenCalledWith("@s/alpha", "1.2.0");
    registry.published.mockImplementation(async () => true);
    await advance(ledger, world);
    expect(state("x-b")).toBe("ready");
  });

  it("says a new reason when the reason changes: another version, a failure, and the failure gone", async () => {
    across();
    const registry = registryOf(false);
    let tags = ["v1.2.0"];
    const world = worldOf(files, async () => tags, registry);
    await advance(ledger, world);
    tags = ["v1.3.0"];
    await advance(ledger, world);
    expect(said("x-b")).toHaveLength(2);
    expect(said("x-b")[1]).toMatch(/1\.3\.0/);
    registry.published.mockRejectedValue(new Error("npm answered 500"));
    await advance(ledger, world);
    expect(said("x-b")).toHaveLength(3);
    expect(said("x-b")[2]).toMatch(/npm answered 500/);
    registry.published.mockImplementation(async () => false);
    await advance(ledger, world);
    expect(said("x-b")).toHaveLength(4);
    expect(said("x-b")[3]).toMatch(/1\.3\.0/);
    expect(state("x-b")).toBe("waiting");
  });

  it("says a reason again when it comes back after another: A, B, A", async () => {
    across();
    const registry = registryOf(false);
    let tags = ["v1.2.0"];
    const world = worldOf(files, async () => tags, registry);
    await advance(ledger, world);
    tags = ["v1.3.0"];
    await advance(ledger, world);
    tags = ["v1.2.0"];
    await advance(ledger, world);
    expect(said("x-b")).toHaveLength(3);
    expect(said("x-b")[2]).toMatch(/1\.2\.0/);
    expect(ledger.events("x-b").at(-1)?.reason).toMatch(/1\.2\.0/);
  });

  it("reads the version from the tag of the package's folder, and a dev dependency counts", async () => {
    across();
    const registry = registryOf(false);
    const world = worldOf(
      {
        "/a:crate.toml": 'crate = "1"\npackages = ["lib"]\n',
        "/a:lib/package.json": pkg("gamma"),
        "/b:package.json": JSON.stringify({
          name: "delta",
          devDependencies: { gamma: "^0.3.0" },
        }),
      },
      ["lib-v0.3.0"],
      registry,
    );
    await advance(ledger, world);
    expect(state("x-b")).toBe("waiting");
    expect(said("x-b")[0]).toMatch(/gamma.*0\.3\.0/);
    expect(registry.published).toHaveBeenCalledWith("gamma", "0.3.0");
  });

  it("makes no wait when the landed commit has no version tag", async () => {
    across();
    const registry = registryOf(false);
    await advance(ledger, worldOf(files, [], registry));
    expect(state("x-b")).toBe("ready");
    expect(said("x-b")).toEqual([]);
    expect(registry.published).not.toHaveBeenCalled();
  });

  it("starts a cl whose repo does not depend on the landed package, without asking the registry", async () => {
    across();
    const registry = registryOf(false);
    const world = worldOf(
      {
        "/a:package.json": pkg("@s/alpha"),
        "/b:package.json": pkg("@s/beta", { other: "^1.0.0" }),
      },
      ["v1.2.0"],
      registry,
    );
    await advance(ledger, world);
    expect(state("x-b")).toBe("ready");
    expect(said("x-b")).toEqual([]);
    expect(registry.published).not.toHaveBeenCalled();
  });

  it("keeps a cl waiting for a phase before it that has not landed, though the registry has the version", async () => {
    across();
    force("x-a", "approved");
    await advance(ledger, worldOf(files, ["v1.2.0"], registryOf(true)));
    expect(state("x-b")).toBe("waiting");
  });

  describe("a failed ask", () => {
    /** A third cl, of a repo that depends on nothing, waiting in the same phase. */
    const beside = () =>
      ledger.addCl(
        {
          name: "x-c",
          issue: "x",
          seq: 3,
          phase: 2,
          note: "_well/x-c.md",
          repo: "/c",
        },
        "waiting",
      );

    it.each([
      {
        fails: "the registry",
        message: /npm answered 500 for @s\/alpha@1\.2\.0/,
        world: () =>
          worldOf(files, ["v1.2.0"], {
            url: npmRegistryUrl,
            published: async () => {
              throw new Error("npm answered 500 for @s/alpha@1.2.0");
            },
          }),
      },
      {
        fails: "the land target",
        message: /land target not reached/,
        world: () =>
          worldOf(
            files,
            async () => {
              throw new Error("land target not reached");
            },
            registryOf(true),
          ),
      },
      {
        fails: "a package.json that is not JSON",
        message: /JSON/,
        world: () =>
          worldOf(
            { ...files, "/b:package.json": "not json" },
            ["v1.2.0"],
            registryOf(true),
          ),
      },
      {
        fails: "the landed repo's package.json that is not JSON",
        message: /JSON/,
        world: () =>
          worldOf(
            { ...files, "/a:package.json": "{ nope" },
            ["v1.2.0"],
            registryOf(true),
          ),
      },
    ])(
      "keeps a cl waiting with the failure as its reason, and goes on with the others, when $fails fails",
      async ({ world, message }) => {
        across();
        beside();
        await expect(advance(ledger, world())).resolves.not.toThrow();
        expect(state("x-b")).toBe("waiting");
        expect(said("x-b")).toHaveLength(1);
        expect(said("x-b")[0]).toMatch(message);
        expect(state("x-c")).toBe("ready");
        expect(state("x")).toBe("open");
      },
    );
  });

  describe("the limit", () => {
    const wait = async (min: number, limitMs?: number) => {
      landedAtNoon();
      const world = worldOf(files, ["v1.2.0"], registryOf(false), limitMs);
      await advance(ledger, world);
      vi.setSystemTime(at(min));
      await advance(ledger, world);
      return world;
    };

    it("escalates the issue after 30 minutes when no limit is set, naming the package, the version and the wait", async () => {
      await wait(31);
      expect(state("x")).toBe("escalated");
      expect(ledger.events("x").at(-1)).toMatchObject({
        by: "orchestrator",
        word: "escalate",
        reason: expect.stringMatching(/@s\/alpha.*1\.2\.0.*31 min/),
      });
    });

    it("does not escalate within the limit", async () => {
      await wait(29);
      expect(state("x")).toBe("open");
      expect(state("x-b")).toBe("waiting");
    });

    it("uses the factory's limit when one is set", async () => {
      await wait(12, 10 * minute);
      expect(state("x")).toBe("escalated");
      expect(ledger.events("x").at(-1)?.reason).toMatch(/12 min/);
    });

    it("counts from the land, not from the first time it looked", async () => {
      landedAtNoon();
      const world = worldOf(files, ["v1.2.0"], registryOf(false), 10 * minute);
      vi.setSystemTime(at(8));
      await advance(ledger, world);
      vi.setSystemTime(at(11));
      await advance(ledger, world);
      expect(state("x")).toBe("escalated");
    });

    describe("of a failed ask", () => {
      it.each([
        {
          fails: "the registry",
          message: /npm answered 500/,
          world: (limitMs: number) =>
            worldOf(
              files,
              ["v1.2.0"],
              {
                url: npmRegistryUrl,
                published: async () => {
                  throw new Error("npm answered 500");
                },
              },
              limitMs,
            ),
        },
        {
          fails: "the land target",
          message: /land target not reached/,
          world: (limitMs: number) =>
            worldOf(
              files,
              async () => {
                throw new Error("land target not reached");
              },
              registryOf(true),
              limitMs,
            ),
        },
        {
          fails: "a package.json that is not JSON",
          message: /JSON/,
          world: (limitMs: number) =>
            worldOf(
              { ...files, "/b:package.json": "not json" },
              ["v1.2.0"],
              registryOf(true),
              limitMs,
            ),
        },
      ])(
        "escalates the issue once, naming the failure and the wait, when $fails keeps failing past the limit",
        async ({ world, message }) => {
          landedAtNoon();
          const w = world(10 * minute);
          await advance(ledger, w);
          expect(state("x")).toBe("open");
          vi.setSystemTime(at(31));
          await advance(ledger, w);
          expect(state("x")).toBe("escalated");
          expect(state("x-b")).toBe("waiting");
          const escalation = ledger.events("x").at(-1);
          expect(escalation).toMatchObject({
            by: "orchestrator",
            word: "escalate",
          });
          expect(escalation?.reason).toMatch(message);
          expect(escalation?.reason).toMatch(/31 min/);
          const before = ledger.events("x").length;
          vi.setSystemTime(at(40));
          await advance(ledger, w);
          expect(ledger.events("x")).toHaveLength(before);
        },
      );

      it("counts from the last land of the phases before the cl", async () => {
        landedAtNoon();
        ledger.addCl(
          {
            name: "x-a2",
            issue: "x",
            seq: 3,
            phase: 1,
            note: "_well/x-a2.md",
            repo: "/a",
          },
          "approved",
        );
        vi.setSystemTime(at(20));
        ledger.apply(
          "x-a2",
          { word: "pass", reason: "landed", findings: [] },
          "orchestrator",
        );
        const world = worldOf(
          files,
          ["v1.2.0"],
          {
            url: npmRegistryUrl,
            published: async () => {
              throw new Error("npm answered 500");
            },
          },
          10 * minute,
        );
        vi.setSystemTime(at(25));
        await advance(ledger, world);
        expect(state("x")).toBe("open");
        vi.setSystemTime(at(31));
        await advance(ledger, world);
        expect(state("x")).toBe("escalated");
        expect(ledger.events("x").at(-1)?.reason).toMatch(/11 min/);
      });
    });

    it("escalates once: the next tick adds no second escalation", async () => {
      const world = await wait(31);
      const before = ledger.events("x").length;
      vi.setSystemTime(at(40));
      await advance(ledger, world);
      expect(ledger.events("x")).toHaveLength(before);
    });
  });

  /** The world: repo files by "<repo>:<file>", the tags each landed cl's land put on main, and the registry. */
  const worldWith = (
    files: Record<string, string>,
    tags: Record<string, string[]>,
    registry: {
      url: string;
      published: (n: string, v: string) => Promise<boolean>;
    },
  ) => ({
    runs: join(dir, "runs"),
    notes: notes.repo,
    registry,
    reader: {
      file: (repo: string, file: string) => files[`${repo}:${file}`],
      onCrate: () => true,
    },
    tags: async (_repo: string, cl: string) => tags[cl] ?? [],
  });

  describe("the move", () => {
    it("moves the package its repo waited for to the landed version, in the cl's worktree", async () => {
      across();
      await advance(ledger, worldOf(files, ["v1.2.0"], registryOf(true)));
      expect(vi.mocked(move)).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "x-b",
          repo: "/b",
          work: join(dir, "runs", "x", "cl", "b", "work"),
        }),
        "@s/alpha",
        "1.2.0",
        npmRegistryUrl,
      );
      expect(state("x-b")).toBe("ready");
    });

    it("moves the package its repo depends on in its dev dependencies, made in the landed package's folder", async () => {
      across();
      await advance(
        ledger,
        worldOf(
          {
            "/a:crate.toml": 'crate = "1"\npackages = ["lib"]\n',
            "/a:lib/package.json": pkg("gamma"),
            "/b:package.json": JSON.stringify({
              name: "delta",
              devDependencies: { gamma: "^0.3.0" },
            }),
          },
          ["lib-v0.3.0"],
          registryOf(true),
        ),
      );
      expect(vi.mocked(move)).toHaveBeenCalledWith(
        expect.objectContaining({ name: "x-b", repo: "/b" }),
        "gamma",
        "0.3.0",
        npmRegistryUrl,
      );
    });

    it("moves nothing until the version it waited for is on the registry", async () => {
      across();
      const registry = registryOf(false);
      const world = worldOf(files, ["v1.2.0"], registry);
      await advance(ledger, world);
      await advance(ledger, world);
      expect(move).not.toHaveBeenCalled();
      expect(state("x-b")).toBe("waiting");
      registry.published.mockImplementation(async () => true);
      await advance(ledger, world);
      expect(vi.mocked(move)).toHaveBeenCalledOnce();
    });

    /** An issue "y" of three cls: two landed, each in its own repo shipping a package its phase 2 cl needs. */
    function twoReleased(registry: {
      url: string;
      published: (n: string, v: string) => Promise<boolean>;
    }) {
      ledger.addIssue({ name: "y", note: "_well/y.md", repos: ["/a"] });
      for (const [name, repo, seq, to] of [
        ["y-a", "/a", 1, "landed"],
        ["y-c", "/c", 2, "landed"],
        ["y-b", "/b", 3, "waiting"],
      ] as const) {
        ledger.addCl(
          {
            name,
            issue: "y",
            seq,
            phase: seq === 3 ? 2 : 1,
            note: `_well/${name}.md`,
            repo,
          },
          "waiting",
        );
        if (to !== "waiting") force(name, to);
      }
      return worldWith(
        {
          "/a:package.json": pkg("@s/alpha"),
          "/c:package.json": pkg("@s/gamma"),
          "/b:package.json": pkg("beta", {
            "@s/alpha": "^1.0.0",
            "@s/gamma": "^1.0.0",
          }),
        },
        { "y-a": ["v1.2.0"], "y-c": ["v2.0.0"] },
        registry,
      );
    }

    it("moves every package its repo needs from its landed cls, each its own commit, before its first attempt", async () => {
      const world = twoReleased(registryOf(true));
      vi.mocked(move).mockResolvedValueOnce("c1").mockResolvedValueOnce("c2");
      await advance(ledger, world);
      expect(vi.mocked(move).mock.calls).toEqual([
        [
          expect.objectContaining({ name: "y-b", repo: "/b" }),
          "@s/alpha",
          "1.2.0",
          npmRegistryUrl,
        ],
        [
          expect.objectContaining({ name: "y-b", repo: "/b" }),
          "@s/gamma",
          "2.0.0",
          npmRegistryUrl,
        ],
      ]);
      expect(state("y-b")).toBe("ready");
    });

    it("moves none of them until every one of their versions is on the registry", async () => {
      const world = twoReleased({
        url: npmRegistryUrl,
        published: async (n) => n === "@s/alpha",
      });
      await advance(ledger, world);
      expect(move).not.toHaveBeenCalled();
      expect(state("y-b")).toBe("waiting");
      expect(said("y-b")[0]).toMatch(/@s\/gamma.*2\.0\.0/);
    });

    it("leaves the cl waiting, its issue escalated with the output, when the second move fails", async () => {
      const world = twoReleased(registryOf(true));
      vi.mocked(move)
        .mockResolvedValueOnce("c1")
        .mockRejectedValueOnce(
          new Error(
            "npm error code E404: @s/gamma@2.0.0 is not in this registry",
          ),
        );
      await advance(ledger, world);
      expect(state("y-b")).toBe("waiting");
      expect(state("y")).toBe("escalated");
      const escalation = ledger.events("y").at(-1);
      expect(escalation).toMatchObject({
        by: "orchestrator",
        word: "escalate",
      });
      expect(escalation?.reason).toContain(
        "npm error code E404: @s/gamma@2.0.0 is not in this registry",
      );
      expect(ledger.attemptsOf("y-b")).toEqual([]);
      // its issue is Matt's now: it moves nothing more, and escalates it once
      await advance(ledger, world);
      expect(
        ledger.events("y").filter((e) => e.word === "escalate"),
      ).toHaveLength(1);
      expect(vi.mocked(move)).toHaveBeenCalledTimes(2);
    });

    describe("a failed move", () => {
      const fails = [
        {
          what: "the install",
          output: "npm error code E404: @s/alpha@1.2.0 is not in this registry",
          arm: () =>
            vi
              .mocked(move)
              .mockRejectedValue(
                new Error(
                  "npm error code E404: @s/alpha@1.2.0 is not in this registry",
                ),
              ),
        },
        {
          what: "the cl's worktree",
          output: "git worktree add: exit 128: fatal: invalid reference",
          arm: () =>
            vi
              .mocked(move)
              .mockRejectedValue(
                new Error(
                  "git worktree add: exit 128: fatal: invalid reference",
                ),
              ),
        },
      ];

      it.each(fails)(
        "starts no attempt, and escalates its issue with the output, when $what fails",
        async ({ arm, output }) => {
          across();
          const world = worldOf(files, ["v1.2.0"], registryOf(true));
          arm();
          await advance(ledger, world);
          expect(state("x")).toBe("escalated");
          const escalation = ledger.events("x").at(-1);
          expect(escalation).toMatchObject({
            by: "orchestrator",
            word: "escalate",
          });
          expect(escalation?.reason).toContain(output);
          expect(state("x-b")).toBe("waiting");
          expect(ledger.attemptsOf("x-b")).toEqual([]);
          // its issue is Matt's now: the next tick moves nothing more, and escalates it once
          await advance(ledger, world);
          expect(
            ledger.events("x").filter((e) => e.word === "escalate"),
          ).toHaveLength(1);
          expect(state("x-b")).toBe("waiting");
        },
      );
    });
  });

  describe("the cl after a move", () => {
    it("sets its worktree up again, so its attempt installs the moved lockfile", async () => {
      across();
      const mark = join(dir, "runs", "x", "cl", "b", "setup.done");
      mkdirSync(dirname(mark), { recursive: true });
      writeFileSync(mark, "");
      await advance(ledger, worldOf(files, ["v1.2.0"], registryOf(true)));
      expect(existsSync(mark)).toBe(false);
      expect(state("x-b")).toBe("ready");
    });

    it("keeps its setup when it moved nothing", async () => {
      across();
      const mark = join(dir, "runs", "x", "cl", "b", "setup.done");
      mkdirSync(dirname(mark), { recursive: true });
      writeFileSync(mark, "");
      await advance(ledger, worldOf({}, [], registryOf(true)));
      expect(existsSync(mark)).toBe(true);
    });
  });
});
