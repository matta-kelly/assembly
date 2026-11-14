/**
 * The land on real git and the real `git land`, in the orchestrator's image (`just e2e`), against a bare repo on this
 * machine as the land target: a cl lands on main, two cls built from one main both land, a conflict is a back about
 * the plan, a red on main is a back about the code, and a land run again lands nothing twice.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../line/step.ts";
import { branchOf } from "./git.ts";
import { land } from "./land.ts";
import { landTarget } from "./land-target.fixture.ts";

const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

const image = "docker.io/library/node:22.23.4-slim";

describe.skipIf(!process.env["ASSEMBLY_E2E"])("the land", () => {
  let dir: string;
  let repo: string;
  let bare: string;
  const main = () => git(bare, "rev-parse", "main");
  const onMain = (path: string) => git(bare, "show", `main:${path}`);

  /** The cl's one worktree, which every attempt of it, its land too, works in. */
  const workOf = (cut: string) => join(dir, "runs", "is", "cl", cut, "work");

  /** A cl's passed work: its branch and worktree, made from main as the target has it, with `files` in one commit. */
  const built = (cut: string, files: Record<string, string>) => {
    git(repo, "fetch", "-q", "local", "main");
    const work = workOf(cut);
    git(
      repo,
      "worktree",
      "add",
      "-q",
      "-b",
      branchOf(`is-${cut}`),
      work,
      "local/main",
    );
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(work, path)), { recursive: true });
      writeFileSync(join(work, path), text);
    }
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", `da-hammer(is-${cut})`);
  };

  /** The land's attempt of a cl: its run folder beside the cl's worktree. */
  const run = (cut: string, n = 1): Run => {
    const at = join(dir, "runs", "is", "cl", cut, String(n));
    return {
      name: `is-${cut}`,
      kind: "cl",
      issue: "is",
      seq: 1,
      n,
      note: `_well/is-${cut}.md`,
      notes: { repo: "", commit: "" },
      repo,
      image,
      test: `node --test test/${cut}.test.mjs`,
      setup: "",
      dir: at,
      work: workOf(cut),
    };
  };

  const test = (cut: string, want: number) =>
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { value } from "../src/value.mjs";\ntest("${cut}", () => assert.equal(value, ${want}));\n`;

  beforeAll(() => {
    mkdirSync(".e2e", { recursive: true });
    dir = mkdtempSync(join(process.cwd(), ".e2e", "land-"));
    repo = join(dir, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, "README"), "a repo\n");
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "value.mjs"), "export const value = 1;\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "init");
    bare = landTarget(repo, dir);
  });
  afterAll(() => {
    if (!process.env["ASSEMBLY_E2E_KEEP"])
      rmSync(dir, { recursive: true, force: true });
  });

  it("lands a cl on main, gives back the files it changed, and moves its branch to the commit main took", async () => {
    built("a", {
      "src/a.mjs": "export const a = 1;\n",
      "test/a.test.mjs": test("a", 1),
    });
    const out = await land(run("a"));
    expect(out.message).toMatchObject({ word: "pass" });
    expect(out.message.reason).toMatch(/^landed on local\/main at /);
    expect(out.files.sort()).toEqual(["src/a.mjs", "test/a.test.mjs"]);
    expect(onMain("src/a.mjs")).toBe("export const a = 1;");
    expect(git(repo, "rev-parse", branchOf("is-a"))).toBe(main());
    expect(out.commit).toBe(main());
    // main had not moved under it: no test run
    expect(out.ran).toBeUndefined();
  });

  it("lands a cl again as landed, and main does not move", async () => {
    const before = main();
    const out = await land(run("a", 2));
    expect(out.message.word).toBe("pass");
    expect(out.message.reason).toMatch(/holds its change/);
    expect(out.commit).toBe(before);
    expect(main()).toBe(before);
  });

  it("lands two cls built from one main: the second is rebased onto the first, tested green, and landed", async () => {
    built("b", {
      "src/b.mjs": "export const b = 1;\n",
      "test/b.test.mjs": test("b", 1),
    });
    built("c", {
      "src/c.mjs": "export const c = 1;\n",
      "test/c.test.mjs": test("c", 1),
    });
    expect((await land(run("b"))).message.word).toBe("pass");
    const second = await land(run("c"));
    expect(second.message.word).toBe("pass");
    expect(second.ran?.code).toBe(0);
    expect(onMain("src/b.mjs")).toBe("export const b = 1;");
    expect(onMain("src/c.mjs")).toBe("export const c = 1;");
  });

  it("sends a cl that conflicts with one landed before it back about the plan, and main does not move", async () => {
    built("d", { README: "d's readme\n", "test/d.test.mjs": test("d", 1) });
    built("e", { README: "e's readme\n", "test/e.test.mjs": test("e", 1) });
    expect((await land(run("d"))).message.word).toBe("pass");
    const before = main();
    const out = await land(run("e"));
    expect(out.message).toMatchObject({
      word: "back",
      cause: "restack_conflict",
      findings: [{ about: "plan", where: "is-e" }],
    });
    expect(out.message.findings[0]?.what).toMatch(/README/);
    expect(main()).toBe(before);
  });

  it("sends a cl red on main back about the code, with its branch on the rebased tree", async () => {
    built("f", { "test/f.test.mjs": test("f", 1) });
    built("g", {
      "src/value.mjs": "export const value = 2;\n",
      "test/g.test.mjs": test("g", 2),
    });
    expect((await land(run("g"))).message.word).toBe("pass");
    const before = main();
    const out = await land(run("f"));
    expect(out.message).toMatchObject({
      word: "back",
      cause: "check_failed",
      findings: [{ about: "code", where: "node --test test/f.test.mjs" }],
    });
    expect(out.ran?.code).not.toBe(0);
    expect(main()).toBe(before);
    // da-hammer's next attempt starts from the code main will hold
    expect(
      git(repo, "merge-base", "--is-ancestor", before, branchOf("is-f")),
    ).toBe("");
  });
});
