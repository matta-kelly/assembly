/**
 * The sparse checkout on real git, in the orchestrator's image (`just e2e`), since that git is the one that runs: a
 * bound attempt's worktree holds its checkout, the repo stays whole, and its tests see and its pass commits every
 * change it made.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../process/step.ts";
import {
  branchOf,
  commit,
  full,
  fullOf,
  stage,
  touched,
  worktree,
} from "./git.ts";

const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

/** Every file under a folder, from it, but git's own. */
function files(folder: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      if (e === ".git") continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(folder, p));
    }
  };
  walk(folder);
  return out.sort();
}

describe.skipIf(!process.env["ASSEMBLY_E2E"])("the sparse checkout", () => {
  let dir: string;
  let repo: string;
  const run = (n: number, checkout: string[]): Run => {
    const at = join(dir, "runs", "is", "cl", "x", String(n));
    return {
      name: "is-x",
      kind: "cl",
      issue: "is",
      seq: 1,
      n,
      path: join(dir, "is-x.md"),
      repo,
      image: "img",
      test: "true",
      setup: "",
      dir: at,
      work: join(at, "work"),
      checkout,
    };
  };

  beforeAll(() => {
    mkdirSync(".e2e", { recursive: true });
    dir = mkdtempSync(join(process.cwd(), ".e2e", "git-"));
    repo = join(dir, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "e2e@assembly");
    git(repo, "config", "user.name", "e2e");
    for (const f of [
      "README",
      "NOTES",
      "a.ts",
      "lib/a.ts",
      "src/a.ts",
      "src/b.ts",
      "test/a.test.ts",
    ]) {
      mkdirSync(join(repo, f, ".."), { recursive: true });
      writeFileSync(join(repo, f), `${f}\n`);
    }
    writeFileSync(join(repo, ".gitignore"), "deps/\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "init");
  });
  afterAll(() => {
    if (!process.env["ASSEMBLY_E2E_KEEP"])
      rmSync(dir, { recursive: true, force: true });
  });

  it("holds exactly its checkout's paths, a folder and a file, and leaves the repo whole", async () => {
    const r = run(1, ["src", "test/a.test.ts"]);
    expect(await worktree(r)).toBe(true);
    expect(files(r.work)).toEqual(["src/a.ts", "src/b.ts", "test/a.test.ts"]);
    expect(files(repo)).toContain("README");
    expect(git(repo, "status", "--porcelain")).toBe("");
    // unset in the repo's own config: git exits 1 for a key it does not have
    expect(() => git(repo, "config", "--get", "core.sparseCheckout")).toThrow();
  });

  it("anchors each path at the repo's root", async () => {
    const r = run(9, ["a.ts"]);
    await worktree(r);
    expect(files(r.work)).toEqual(["a.ts"]);
  });

  it("sees the attempt's changes, a write outside its checkout too, and never a path it does not hold as removed", async () => {
    const r = run(1, ["src", "test/a.test.ts"]);
    writeFileSync(join(r.work, "src/a.ts"), "changed\n");
    writeFileSync(join(r.work, "src/new.ts"), "new\n");
    rmSync(join(r.work, "test/a.test.ts"));
    writeFileSync(join(r.work, "NOTES2"), "stray\n");
    expect((await touched(r)).sort()).toEqual([
      "NOTES2",
      "src/a.ts",
      "src/new.ts",
      "test/a.test.ts",
    ]);
  });

  it("stages into the full worktree every change, a write outside the checkout too, keeping what git ignores there", async () => {
    const r = run(1, ["src", "test/a.test.ts"]);
    expect(await full(r)).toBe(true);
    mkdirSync(join(fullOf(r), "deps"));
    writeFileSync(join(fullOf(r), "deps/x"), "installed\n");
    const tree = await stage(r);
    const listed = git(repo, "ls-tree", "-r", "--name-only", tree)
      .split("\n")
      .filter(Boolean)
      .sort();
    // test/a.test.ts was removed; src/new.ts and NOTES2 are new, NOTES2 outside the checkout
    expect(listed).toEqual([
      ".gitignore",
      "NOTES",
      "NOTES2",
      "README",
      "a.ts",
      "lib/a.ts",
      "src/a.ts",
      "src/b.ts",
      "src/new.ts",
    ]);
    expect(readFileSync(join(fullOf(r), "src/a.ts"), "utf8")).toBe("changed\n");
    expect(existsSync(join(fullOf(r), "test/a.test.ts"))).toBe(false);
    expect(existsSync(join(fullOf(r), "src/new.ts"))).toBe(true);
    expect(existsSync(join(fullOf(r), "NOTES2"))).toBe(true);
    expect(existsSync(join(fullOf(r), "deps/x"))).toBe(true);
    expect(await full(r)).toBe(false);
  });

  it("commits the tree its tests saw, and moves the item's branch to it", async () => {
    const r = run(1, ["src", "test/a.test.ts"]);
    const tree = await stage(r);
    await commit(r, "da-hammer(is-x)");
    const head = git(repo, "rev-parse", branchOf("is-x")).trim();
    expect(git(repo, "rev-parse", `${head}^{tree}`).trim()).toBe(tree);
    expect(
      git(repo, "diff", "--name-only", "main", head)
        .split("\n")
        .filter(Boolean)
        .sort(),
    ).toEqual(["NOTES2", "src/a.ts", "src/new.ts", "test/a.test.ts"]);
  });

  it("forgets a file it no longer has: a second stage removes what the first put in", async () => {
    const r = run(2, ["src"]);
    await worktree(r);
    writeFileSync(join(r.work, "src/c.ts"), "c\n");
    await stage(r);
    expect(existsSync(join(fullOf(r), "src/c.ts"))).toBe(true);
    rmSync(join(r.work, "src/c.ts"));
    await stage(r);
    expect(existsSync(join(fullOf(r), "src/c.ts"))).toBe(false);
  });
});
