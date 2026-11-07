import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agents } from "./agents/index.ts";
import { bins, modelOf } from "./effects/models.ts";
import {
  blocked,
  compose,
  explain,
  homeOf,
  main,
  onBins,
  status,
} from "./main.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "factory-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

const issue = {
  name: "is",
  path: "/work/is.md",
  repo: "/repo",
  image: "img",
  test: "suite",
};

describe("the factory's agents", () => {
  it("each run on a bin there is, and a retry on its fallback", () => {
    for (const [name, a] of Object.entries(agents)) {
      expect(Object.keys(bins)).toContain(a.bin);
      expect(onBins().modelFor(name, true)).toBe(modelOf(a.bin, true));
    }
  });
});

describe("the factory's home", () => {
  it("is ASSEMBLY_HOME, else under XDG_STATE_HOME", () => {
    expect(homeOf({ ASSEMBLY_HOME: "/a", XDG_STATE_HOME: "/s" })).toBe("/a");
    expect(homeOf({ XDG_STATE_HOME: "/s" })).toBe("/s/assembly");
  });

  it("holds the ledger and the run folders", () => {
    const f = compose({ home });
    f.ledger.addIssue(issue);
    expect(compose({ home }).ledger.item("is").state).toBe("open");
    expect(f.runs).toBe(join(home, "runs"));
  });
});

describe("the factory's reports", () => {
  it("status: each item and its state, the open attempts, and the spend", () => {
    const { ledger } = compose({ home });
    ledger.addIssue(issue);
    ledger.end(
      "is",
      ledger.begin("is"),
      { word: "retry", reason: "r" },
      "open",
      { usage: { cost: 0.5 } },
    );
    ledger.begin("is");
    expect(status(ledger)).toEqual([
      "is  open",
      "",
      "open attempts: is/2 (open)",
      "spent: $0.5000",
    ]);
  });

  it("status: each issue's cls under it, whatever order they came in", () => {
    const { ledger } = compose({ home });
    ledger.addIssue(issue);
    ledger.addIssue({ ...issue, name: "two" });
    ledger.addCl({ ...issue, name: "is-one", issue: "is", seq: 1 }, "ready");
    expect(status(ledger).slice(0, 3)).toEqual([
      "is  open",
      "  is-one  ready",
      "two  open",
    ]);
  });

  it("blocked: the raised and escalated items, with the reason of their last move", () => {
    const { ledger } = compose({ home });
    expect(blocked(ledger)).toEqual(["nothing is blocked"]);
    ledger.addIssue(issue);
    ledger.end(
      "is",
      ledger.begin("is"),
      { word: "raise", cause: "missing_context", reason: "no intent" },
      "raised",
    );
    expect(blocked(ledger)).toEqual([
      "is  raised [missing_context]: no intent",
    ]);
  });

  it("explain: an item's moves, and each attempt with where its trace is", () => {
    const f = compose({ home });
    f.ledger.addIssue(issue);
    f.ledger.end(
      "is",
      f.ledger.begin("is"),
      { word: "pass", reason: "the plan lints" },
      "planned",
      { usage: { cost: 0.01 } },
    );
    const lines = explain(f.ledger, f.runs, "is");
    expect(lines[0]).toBe("is (issue)  planned");
    expect(lines).toContainEqual(
      expect.stringMatching(/open -pass-> planned: the plan lints/),
    );
    expect(lines).toContainEqual("  1  open  pass: the plan lints  $0.0100");
    expect(lines).toContainEqual(
      `     trace: ${join(home, "runs", "is", "issue", "1", "trace.jsonl")}`,
    );
  });
});

describe("the command line", () => {
  const add = (note: string, repo: string) =>
    main(
      ["add", note, "--repo", repo, "--image", "img", "--test", "npm test"],
      {
        ASSEMBLY_HOME: home,
      },
    );

  it("adds an issue by its note, named by the file", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const note = join(home, "my-issue.md");
    writeFileSync(note, "an issue\n");
    mkdirSync(join(home, "repo", ".git"), { recursive: true });
    expect(await add(note, join(home, "repo"))).toBe(0);
    expect(log).toHaveBeenCalledWith("added my-issue, open");
    expect(compose({ home }).ledger.item("my-issue")).toMatchObject({
      path: note,
      repo: join(home, "repo"),
      test: "npm test",
      state: "open",
    });
  });

  it("refuses an issue with no note, a repo that is not one, or a name it has", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const note = join(home, "is.md");
    const repo = join(home, "repo");
    expect(await add(note, repo)).toBe(1);
    expect(err).toHaveBeenLastCalledWith(`no issue note at ${note}`);
    writeFileSync(note, "an issue\n");
    expect(await add(note, repo)).toBe(1);
    expect(err).toHaveBeenLastCalledWith(`${repo} is not a git repo`);
    mkdirSync(join(repo, ".git"), { recursive: true });
    expect(await add(note, repo)).toBe(0);
    expect(await add(note, repo)).toBe(1);
    expect(err).toHaveBeenLastCalledWith("is is in the ledger already");
  });

  it("refuses a note whose name is not kebab-case, an item it does not have, and a tick that is not a time", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = { ASSEMBLY_HOME: home };
    expect(await add(join(home, "My Issue.md"), home)).toBe(1);
    expect(err).toHaveBeenLastCalledWith(
      "My Issue: an issue's name is kebab-case, from its note",
    );
    expect(await main(["explain", "typo"], env)).toBe(1);
    expect(err).toHaveBeenLastCalledWith("no item typo in the ledger");
    expect(await main(["run", "--every", "5s"], env)).toBe(1);
    expect(await main(["run", "--every", "0"], env)).toBe(1);
  });

  it("prints its usage for a verb it does not know, or one missing its arguments", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = { ASSEMBLY_HOME: home };
    expect(await main(["land"], env)).toBe(2);
    expect(existsSync(join(home, "ledger.db"))).toBe(false);
    expect(await main(["add", "x.md"], env)).toBe(2);
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/^factory add/));
  });
});
