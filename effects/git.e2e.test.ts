/**
 * The worktrees on real git, in the orchestrator's image (`just e2e`), since that git is the one that runs: a cl's one
 * worktree on its branch, made from main as the land target has it, the whole repo in it; a pass commits there, and a
 * failed attempt leaves its change as a diff and a clean worktree; an issue's worktree moves to main; and the sweep
 * keeps a live item's worktree and branch and nothing else.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tree } from "../process/step.ts";
import { landTarget } from "./land-target.fixture.ts";
import {
  branchOf,
  changed,
  commit,
  fresh,
  landedTags,
  sweep,
  touched,
  worktree,
} from "./git.ts";

const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

/** A repo with a few files and a land target, in a new folder under .e2e. */
function repoIn(prefix: string) {
  mkdirSync(".e2e", { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".e2e", prefix));
  const repo = join(dir, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "e2e@assembly");
  git(repo, "config", "user.name", "e2e");
  for (const f of ["README", "NOTES", "src/a.ts", "test/a.test.ts"]) {
    mkdirSync(join(repo, f, ".."), { recursive: true });
    writeFileSync(join(repo, f), `${f}\n`);
  }
  writeFileSync(join(repo, ".gitignore"), "deps/\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  const bare = landTarget(repo, dir);
  return { dir, repo, bare };
}

/** A commit on main from another clone of the target, after the repo last fetched. */
function landElsewhere(dir: string, bare: string, file: string) {
  const other = join(dir, `other-${file}`);
  execFileSync("git", ["clone", "-q", bare, other]);
  git(other, "config", "user.email", "e2e@assembly");
  git(other, "config", "user.name", "e2e");
  writeFileSync(join(other, file), "landed elsewhere\n");
  git(other, "add", "-A");
  git(other, "commit", "-q", "-m", file);
  git(other, "push", "-q", "origin", "main");
}

describe.skipIf(!process.env["ASSEMBLY_E2E"])("an item's worktree", () => {
  let dir: string;
  let repo: string;
  let bare: string;
  const run = (n: number, kind: "cl" | "issue" = "cl"): Tree => {
    const under =
      kind === "cl"
        ? join(dir, "runs", "is", "cl", "x")
        : join(dir, "runs", "is", "issue");
    return {
      name: kind === "cl" ? "is-x" : "is",
      kind,
      issue: "is",
      n,
      repo,
      dir: join(under, String(n)),
      work: join(under, "work"),
    };
  };

  beforeAll(() => ({ dir, repo, bare } = repoIn("git-")));
  afterAll(() => {
    if (!process.env["ASSEMBLY_E2E_KEEP"])
      rmSync(dir, { recursive: true, force: true });
  });

  it("is made once, on the cl's branch from main as the land target has it, with the whole repo, and kept after", async () => {
    landElsewhere(dir, bare, "UPSTREAM");
    const r = run(1);
    expect(await worktree(r)).toBe(true);
    expect(git(r.work, "symbolic-ref", "--short", "HEAD")).toBe(
      branchOf("is-x"),
    );
    for (const f of ["README", "NOTES", "src/a.ts", "UPSTREAM"])
      expect(existsSync(join(r.work, f))).toBe(true);
    expect(git(repo, "status", "--porcelain")).toBe("");
    // the next attempt works in the same worktree
    expect(await worktree(run(2))).toBe(false);
  });

  it("commits a pass on the cl's branch, and its next attempt starts from it", async () => {
    const r = run(1);
    writeFileSync(join(r.work, "src/a.ts"), "passed\n");
    writeFileSync(join(r.work, "src/new.ts"), "new\n");
    expect((await touched(r)).sort()).toEqual(["src/a.ts", "src/new.ts"]);
    await commit(r, "feat(is-x): it");
    expect(git(repo, "show", `${branchOf("is-x")}:src/new.ts`)).toBe("new");
    expect(git(repo, "log", "-1", "--format=%s", branchOf("is-x"))).toBe(
      "feat(is-x): it",
    );
    expect(await touched(run(2))).toEqual([]);
  });

  it("sees a failed attempt's change, new and removed files too, and keeps it, with what git ignores", async () => {
    const r = run(2);
    mkdirSync(join(r.work, "deps"));
    writeFileSync(join(r.work, "deps/x"), "installed\n");
    writeFileSync(join(r.work, "src/a.ts"), "failed\n");
    writeFileSync(join(r.work, "src/stray.ts"), "stray\n");
    rmSync(join(r.work, "NOTES"));
    expect(await changed(r, ["src/a.ts", "test/a.test.ts"])).toEqual([
      "src/a.ts",
    ]);
    expect((await touched(r)).sort()).toEqual(
      ["NOTES", "src/a.ts", "src/stray.ts"].sort(),
    );
    expect(await worktree(r)).toBe(false);
    expect(readFileSync(join(r.work, "src/a.ts"), "utf8")).toBe("failed\n");
    expect(existsSync(join(r.work, "src/stray.ts"))).toBe(true);
    expect(existsSync(join(r.work, "deps/x"))).toBe(true);
    // the next case starts from the branch
    git(r.work, "reset", "-q", "--hard", "HEAD");
    git(r.work, "clean", "-q", "-f", "-d");
  });

  it("is made again on its branch, with its commits, when its folder is gone", async () => {
    const r = run(4);
    rmSync(r.work, { recursive: true, force: true });
    expect(await worktree(r)).toBe(true);
    expect(readFileSync(join(r.work, "src/a.ts"), "utf8")).toBe("passed\n");
  });

  it("of an issue, is detached at main, and moves to main as the target has it now", async () => {
    const r = run(1, "issue");
    expect(await worktree(r)).toBe(true);
    expect(git(r.work, "rev-parse", "HEAD")).toBe(
      git(bare, "rev-parse", "main"),
    );
    expect(await fresh(r)).toBe(false);
    landElsewhere(dir, bare, "LATER");
    expect(await fresh(r)).toBe(true);
    expect(readFileSync(join(r.work, "LATER"), "utf8")).toBe(
      "landed elsewhere\n",
    );
    expect(git(repo, "branch", "--list", branchOf("is"))).toBe("");
  });
});

describe.skipIf(!process.env["ASSEMBLY_E2E"])("the sweep", () => {
  let dir: string;
  let repo: string;
  let runs: string;
  const add = (path: string, branch?: string) =>
    branch
      ? git(repo, "worktree", "add", "-q", "-b", branch, path, "main")
      : git(repo, "worktree", "add", "-q", "--detach", path, "main");
  const worktrees = () =>
    git(repo, "worktree", "list", "--porcelain")
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice("worktree ".length))
      .sort();
  const branches = () =>
    git(
      repo,
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads/assembly/",
    )
      .split("\n")
      .filter(Boolean)
      .sort();

  beforeAll(() => {
    ({ dir, repo } = repoIn("sweep-"));
    runs = join(dir, "runs");
    // live: is-a's worktree and branch. Ended: is-b's. An older scheme's: an attempt branch and its worktree, and a
    // full worktree. Outside the runs folder: someone's own worktree.
    add(join(runs, "is", "cl", "a", "work"), branchOf("is-a"));
    add(join(runs, "is", "cl", "b", "work"), branchOf("is-b"));
    add(join(runs, "is", "cl", "a", "3", "work"), "assembly/is-a/3");
    add(join(runs, "is", "cl", "a", "full"));
    add(join(dir, "mine"), "assembly/mine/head");
    git(repo, "branch", "assembly/gone/head", "main");
  });
  afterAll(() => {
    if (!process.env["ASSEMBLY_E2E_KEEP"])
      rmSync(dir, { recursive: true, force: true });
  });

  it("removes every worktree under the runs folder and every assembly branch no live item holds, and nothing else", async () => {
    const live = join(runs, "is", "cl", "a", "work");
    await expect(
      sweep(repo, runs, new Set([live]), new Set([branchOf("is-a")])),
    ).rejects.toThrow(/assembly\/mine\/head/);
    expect(worktrees()).toEqual([join(dir, "mine"), repo, live].sort());
    expect(existsSync(join(runs, "is", "cl", "b", "work"))).toBe(false);
    // the branch checked out outside the runs folder stays: it is someone's
    expect(branches()).toEqual(["assembly/is-a/head", "assembly/mine/head"]);
  });

  it("is safe to run again, and keeps what it kept", async () => {
    git(repo, "worktree", "remove", "--force", join(dir, "mine"));
    git(repo, "branch", "-D", "assembly/mine/head");
    const live = join(runs, "is", "cl", "a", "work");
    await sweep(repo, runs, new Set([live]), new Set([branchOf("is-a")]));
    await sweep(repo, runs, new Set([live]), new Set([branchOf("is-a")]));
    expect(worktrees()).toEqual([repo, live].sort());
    expect(branches()).toEqual(["assembly/is-a/head"]);
  });
});

describe.skipIf(!process.env["ASSEMBLY_E2E"])("a landed cl's tags", () => {
  let dir: string;
  let bare: string;
  let repo: string;
  /** A commit on main, pushed to the land target; gives back its hash. */
  const land = (file: string) => {
    writeFileSync(join(repo, file), `${file}\n`);
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", file);
    git(repo, "push", "-q", "local", "main");
    return git(repo, "rev-parse", "HEAD");
  };

  beforeAll(() => ({ dir, repo, bare } = repoIn("tags-")));
  afterAll(() => {
    if (!process.env["ASSEMBLY_E2E_KEEP"])
      rmSync(dir, { recursive: true, force: true });
  });

  it("are the version tags the land target holds on the commit main took, and no others", async () => {
    const before = git(repo, "rev-parse", "HEAD");
    const took = land("x.ts");
    const after = land("y.ts");
    // crate tags on the server only: the repo has fetched none of these
    git(bare, "tag", "v1.2.3", took);
    git(bare, "tag", "lib-v0.4.0", took);
    git(bare, "tag", "nightly", took);
    git(bare, "tag", "v1.2.2", before);
    git(bare, "tag", "v2.0.0", after);
    // a local tag the target does not hold
    git(repo, "tag", "v9.9.9", took);
    expect((await landedTags(repo, took)).sort()).toEqual([
      "lib-v0.4.0",
      "v1.2.3",
    ]);
  });

  it("are the bare name, once, for an annotated version tag beside a light one", async () => {
    const took = land("annotated.ts");
    git(
      bare,
      "-c",
      "user.email=e2e@assembly",
      "-c",
      "user.name=e2e",
      "tag",
      "-a",
      "-m",
      "release",
      "v3.1.0",
      took,
    );
    git(bare, "tag", "lib-v0.5.0", took);
    expect((await landedTags(repo, took)).sort()).toEqual([
      "lib-v0.5.0",
      "v3.1.0",
    ]);
  });

  it("are none for a commit crate put no version tag on", async () => {
    expect(await landedTags(repo, land("z.ts"))).toEqual([]);
  });
});
