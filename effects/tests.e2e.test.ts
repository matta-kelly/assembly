/**
 * A cl's red run on real git and podman, in the orchestrator's image (`just e2e`): after da-nail's first pass, its tests
 * run without the cl's code, in a throwaway checkout of its last tests commit, with the worktree's installed packages,
 * and the worktree is left as it was; before it, the run is the worktree's.
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
import type { Run } from "../process/step.ts";
import { worktree } from "./git.ts";
import { landTarget } from "./land-target.fixture.ts";
import { readerImage } from "./repo.ts";
import { runRed, runTests } from "./tests.ts";

const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

/** The test da-nail writes: the promised behaviour, and the package the setup installed. */
const theTest = `import { test } from "node:test";
import assert from "node:assert";
import { existsSync } from "node:fs";
import { a } from "../src/a.mjs";
test("a gives the new answer", () => {
  assert.ok(existsSync("node_modules/dep/index.js"), "the installed packages are there");
  assert.strictEqual(a(), "new");
});
`;

describe.skipIf(!process.env["ASSEMBLY_E2E"])("a cl's red run", () => {
  let dir: string;
  let repo: string;
  const run = (name: string): Run => {
    const under = join(dir, "runs", "is", "cl", name.replace("is-", ""));
    return {
      name,
      kind: "cl",
      issue: "is",
      n: 1,
      seq: 1,
      repo,
      dir: join(under, "1"),
      work: join(under, "work"),
      note: `_well/${name}.md`,
      notes: { repo, commit: "unused" },
      image: readerImage,
      test: "node --test test/a.test.mjs",
      setup: "",
    };
  };
  /** da-nail's work in the cl's worktree, and the packages its setup would install. */
  const nailed = async (r: Run) => {
    await worktree(r);
    mkdirSync(join(r.work, "test"), { recursive: true });
    writeFileSync(join(r.work, "test/a.test.mjs"), theTest);
    mkdirSync(join(r.work, "node_modules/dep"), { recursive: true });
    writeFileSync(join(r.work, "node_modules/dep/index.js"), "\n");
  };

  beforeAll(() => {
    mkdirSync(".e2e", { recursive: true });
    dir = mkdtempSync(join(process.cwd(), ".e2e", "red-"));
    repo = join(dir, "repo");
    mkdirSync(join(repo, "src"), { recursive: true });
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "e2e@assembly");
    git(repo, "config", "user.name", "e2e");
    writeFileSync(join(repo, "src/a.mjs"), 'export const a = () => "old";\n');
    writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "init");
    landTarget(repo, dir);
  });
  afterAll(() => {
    if (!process.env["ASSEMBLY_E2E_KEEP"])
      rmSync(dir, { recursive: true, force: true });
  });

  it(
    "after da-nail's pass, runs its tests without the cl's code, with the installed packages, and leaves the worktree as it was",
    { timeout: 120_000 },
    async () => {
      const r = run("is-x");
      await nailed(r);
      git(r.work, "add", "-A");
      git(r.work, "commit", "-q", "-m", "test(is-x): a gives the new answer");
      // da-hammer's code, written and not passed yet: the worktree's tests pass on it
      writeFileSync(
        join(r.work, "src/a.mjs"),
        'export const a = () => "new";\n',
      );
      const green = await runTests(r);
      expect(green.code, green.out).toBe(0);

      const red = await runRed(r, ["test/a.test.mjs"]);
      expect(red.code).not.toBe(0);
      expect(red.out).toMatch(/AssertionError|ERR_ASSERTION/);
      expect(red.out).toMatch(/'old'/);
      expect(red.out).not.toMatch(/the installed packages are there/);

      expect(readFileSync(join(r.work, "src/a.mjs"), "utf8")).toMatch(/"new"/);
      expect(existsSync(join(r.dir, "red"))).toBe(false);
      expect(git(repo, "worktree", "list")).not.toContain(join(r.dir, "red"));
    },
  );

  it(
    "before da-nail's first pass, runs in the worktree, which holds only its work",
    { timeout: 120_000 },
    async () => {
      const r = run("is-y");
      await nailed(r);
      const red = await runRed(r, ["test/a.test.mjs"]);
      expect(red.code).not.toBe(0);
      expect(red.out).toMatch(/'old'/);
      expect(existsSync(join(r.dir, "red"))).toBe(false);
    },
  );
});
