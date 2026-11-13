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
import { CrateError, devImage } from "../effects/repo.ts";
import { move } from "../effects/move.ts";
import { npmRegistryUrl } from "../effects/registry.ts";
import { advance } from "./advance.ts";
import { type Ledger, open } from "./ledger.ts";
import { section } from "../effects/notes.ts";

// The move and the dev image of the moved commit run containers and crate: the unit tests stand them in.
vi.mock("../effects/move.ts", () => ({ move: vi.fn() }));
vi.mock("../effects/repo.ts", async (original) => ({
  ...(await original<typeof import("../effects/repo.ts")>()),
  devImage: vi.fn(),
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
let path: string;
beforeEach(() => {
  // the clock is real at the start of every test in this file, whatever one before it left
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.mocked(move).mockResolvedValue("c0ffee");
  vi.mocked(devImage).mockResolvedValue("localhost/b-dev:moved");
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
    expect(section(join(dir, "is-value.md"), "Promises").trim()).toBe(
      "- given value, when read, then right",
    );
    expect(read("is")).toBe(issueNote);
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
    expect(read("is")).toBe(issueNote);
    expect(read("is-double")).toMatch(/^status: new$/m);
    expect(read("is-value")).toMatch(/^status: new$/m);
  });

  it("relays a cl's raise about the issue to Matt", async () => {
    await advance(ledger);
    raise("is-value", "issue");
    await advance(ledger);
    expect(state("is")).toBe("raised");
  });

  it("makes no cl of a later phase ready while a cl of an earlier phase has raised, on the planner's spec", async () => {
    await advance(ledger);
    raise("is-value", "plan");
    await advance(ledger);
    expect(
      ledger.events("is-double").filter((e) => e["to_state"] === "ready"),
    ).toEqual([]);
  });

  it("makes no cl of a later phase ready while a cl of an earlier phase has raised, on Matt's spec", async () => {
    const db = new DatabaseSync(join(dir, "ledger.db"));
    db.prepare("DELETE FROM attempts").run();
    db.close();
    ledger.keepSpec("is", { plan: plan.plan, cls: plan.cls }, "matt");
    writeFileSync(
      join(dir, "is-value.md"),
      "---\ntype: cl\nstatus: new\n---\nv\n",
    );
    await advance(ledger);
    raise("is-value", "cl");
    await advance(ledger);
    expect(state("is")).toBe("escalated");
    expect(state("is-value")).toBe("raised");
    expect(state("is-double")).toBe("waiting");
    expect(
      ledger.events("is-double").filter((e) => e["to_state"] === "ready"),
    ).toEqual([]);
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

  it("leaves an accepted issue's notes as they are: the ledger says it is accepted", async () => {
    await advance(ledger);
    const before = ["is", "is-plan", "is-value", "is-double"].map(read);
    force("is", "accepted");
    await advance(ledger);
    expect(["is", "is-plan", "is-value", "is-double"].map(read)).toEqual(
      before,
    );
    expect(read("is")).toBe(issueNote);
    expect(read("is-plan")).toMatch(/^status: active$/m);
    expect(state("is")).toBe("accepted");
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

describe("advance across repos", () => {
  const pkg = (name: string, deps: Record<string, string> = {}) =>
    JSON.stringify({ name, version: "0.0.0", dependencies: deps });
  const minute = 60_000;
  const at = (min: number) => new Date(Date.UTC(2026, 0, 1, 12, min));

  /** An issue "x" with a cl of repo /a landed in phase 1, and a cl of repo /b waiting in phase 2. */
  function across() {
    writeFileSync(join(dir, "x.md"), issueNote);
    ledger.addIssue({
      name: "x",
      path: join(dir, "x.md"),
      repo: "/a",
      image: "img",
      test: "suite",
    });
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
          path: join(dir, `${name}.md`),
          repo,
          image: "img",
          test: "t",
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
          path: join(dir, "x-c.md"),
          repo: "/c",
          image: "img",
          test: "t",
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
            path: join(dir, "x-a2.md"),
            repo: "/a",
            image: "img",
            test: "t",
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
    registry,
    reader: {
      file: (repo: string, file: string) => files[`${repo}:${file}`],
      onCrate: () => true,
    },
    tags: async (_repo: string, cl: string) => tags[cl] ?? [],
  });

  describe("the move", () => {
    it("moves the package its repo waited for to the landed version, and takes the dev image of that commit", async () => {
      across();
      await advance(ledger, worldOf(files, ["v1.2.0"], registryOf(true)));
      expect(vi.mocked(move)).toHaveBeenCalledWith(
        expect.objectContaining({ name: "x-b", repo: "/b" }),
        "@s/alpha",
        "1.2.0",
        npmRegistryUrl,
      );
      expect(vi.mocked(devImage)).toHaveBeenCalledWith("/b", "c0ffee");
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
      expect(devImage).not.toHaveBeenCalled();
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
      writeFileSync(join(dir, "y.md"), issueNote);
      ledger.addIssue({
        name: "y",
        path: join(dir, "y.md"),
        repo: "/a",
        image: "img",
        test: "suite",
      });
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
            path: join(dir, `${name}.md`),
            repo,
            image: "img",
            test: "t",
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

    it("moves every package its repo needs from its landed cls, each its own commit, and takes the last commit's image", async () => {
      const world = twoReleased(registryOf(true));
      vi.mocked(move).mockResolvedValueOnce("c1").mockResolvedValueOnce("c2");
      vi.mocked(devImage)
        .mockResolvedValueOnce("b-dev:1")
        .mockResolvedValueOnce("b-dev:2");
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
      // each commit gets its own dev image, and the item takes the last one's
      expect(vi.mocked(devImage).mock.calls).toEqual([
        ["/b", "c1"],
        ["/b", "c2"],
      ]);
      expect(ledger.item("y-b").image).toBe("b-dev:2");
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
          what: "the dev image of the moved commit",
          output: "crate dev-image ref: exit 1: its Containerfile has no bake",
          arm: () =>
            vi
              .mocked(devImage)
              .mockRejectedValue(
                new CrateError(
                  1,
                  "crate dev-image ref: exit 1: its Containerfile has no bake",
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

  describe("the issue after a move", () => {
    it("takes the moved commit's dev image for its own steps, in an issue of one repo", async () => {
      writeFileSync(join(dir, "z.md"), issueNote);
      ledger.addIssue({
        name: "z",
        path: join(dir, "z.md"),
        repo: "/z",
        image: "img",
        test: "suite",
      });
      for (const [name, phase, to] of [
        ["z-a", 1, "landed"],
        ["z-b", 2, "waiting"],
      ] as const) {
        ledger.addCl(
          {
            name,
            issue: "z",
            seq: phase,
            phase,
            path: join(dir, `${name}.md`),
            repo: "/z",
            image: "img",
            test: "t",
          },
          "waiting",
        );
        if (to === "landed") force(name, to);
      }
      // the repo ships a package in a folder, which the cl its repo depends on moves
      const world = worldWith(
        {
          "/z:lib/package.json": pkg("lib"),
          "/z:package.json": pkg("z", { lib: "^1.0.0" }),
        },
        { "z-a": ["lib-v1.2.0"] },
        registryOf(true),
      );
      await advance(ledger, world);
      expect(vi.mocked(move)).toHaveBeenCalledWith(
        expect.objectContaining({ name: "z-b", repo: "/z" }),
        "lib",
        "1.2.0",
        npmRegistryUrl,
      );
      // a one-repo issue's own image is its repo's: its own steps take the moved commit's image too
      expect(ledger.item("z").image).toBe("localhost/b-dev:moved");
      expect(ledger.item("z-b").image).toBe("localhost/b-dev:moved");
      expect(state("z-b")).toBe("ready");
    });

    it("takes it for the repo it moved, and only that one, in an issue of two", async () => {
      writeFileSync(join(dir, "w.md"), issueNote);
      ledger.addIssueAcross({
        name: "w",
        path: join(dir, "w.md"),
        image: "img",
        repos: [
          { name: "a", repo: "/a", image: "img-a", test: "t", setup: "" },
          { name: "b", repo: "/b", image: "img-b", test: "t", setup: "" },
        ],
      });
      for (const [name, repo, phase, to] of [
        ["w-a", "/a", 1, "landed"],
        ["w-b", "/b", 2, "waiting"],
      ] as const) {
        ledger.addCl(
          {
            name,
            issue: "w",
            seq: phase,
            phase,
            path: join(dir, `${name}.md`),
            repo,
            image: repo === "/a" ? "img-a" : "img-b",
            test: "t",
          },
          "waiting",
        );
        if (to === "landed") force(name, to);
      }
      const world = worldWith(
        {
          "/a:package.json": pkg("@s/alpha"),
          "/b:package.json": pkg("beta", { "@s/alpha": "^1.0.0" }),
        },
        { "w-a": ["v1.2.0"] },
        registryOf(true),
      );
      await advance(ledger, world);
      expect(ledger.item("w").repos.map((r) => [r.name, r.image])).toEqual([
        ["a", "img-a"],
        ["b", "localhost/b-dev:moved"],
      ]);
    });
  });
});
