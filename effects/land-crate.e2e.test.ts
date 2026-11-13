/**
 * The land through crate, on real git, crate's real hooks and the real engine, in the orchestrator's image (`just e2e`):
 * a cl lands on main with a plain push that crate checks, two cls built from one main both land, and a cl red on main
 * is refused by crate's check and sent back about the code, with main where it was.
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../process/step.ts";
import { branchOf } from "./git.ts";
import { land } from "./land.ts";
import { crateTarget } from "./land-target.fixture.ts";

const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

const image = "docker.io/library/node:22.23.4-slim";

describe.skipIf(!process.env["ASSEMBLY_E2E"])("the land through crate", () => {
  let dir: string;
  let repo: string;
  let bare: string;
  const main = () => git(bare, "rev-parse", "main");
  const onMain = (path: string) => git(bare, "show", `main:${path}`);

  /** The cl's one worktree, which every attempt of it, its land too, works in. */
  const workOf = (cut: string) => join(dir, "runs", "is", "cl", cut, "work");

  /** A cl's passed work: its branch and worktree, made from main as the server has it, with `files` in one commit. */
  const built = (cut: string, files: Record<string, string>) => {
    git(repo, "fetch", "-q", "server", "main");
    const work = workOf(cut);
    git(
      repo,
      "worktree",
      "add",
      "-q",
      "-b",
      branchOf(`is-${cut}`),
      work,
      "server/main",
    );
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(work, path)), { recursive: true });
      writeFileSync(join(work, path), text);
    }
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", `da-hammer(is-${cut})`);
  };

  const run = (cut: string): Run => {
    const at = join(dir, "runs", "is", "cl", cut, "1");
    return {
      name: `is-${cut}`,
      kind: "cl",
      issue: "is",
      seq: 1,
      n: 1,
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
    dir = mkdtempSync(join(process.cwd(), ".e2e", "crate-"));
    repo = join(dir, "repo");
    mkdirSync(join(repo, "src"), { recursive: true });
    mkdirSync(join(repo, "scripts"));
    mkdirSync(join(repo, "test"));
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(
      join(repo, "crate.toml"),
      `crate = "1"\nimage = "${image}"\n`,
    );
    writeFileSync(
      join(repo, "scripts", "check.sh"),
      '#!/bin/sh\nnode --test || { echo "check failed at: test"; exit 1; }\necho "check passed"\n',
    );
    chmodSync(join(repo, "scripts", "check.sh"), 0o755);
    writeFileSync(join(repo, "src", "value.mjs"), "export const value = 1;\n");
    writeFileSync(join(repo, "test", "base.test.mjs"), test("base", 1));
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "init");
    bare = crateTarget(repo, dir);
  });

  afterAll(() => {
    if (!process.env["ASSEMBLY_E2E_KEEP"])
      rmSync(dir, { recursive: true, force: true });
  });

  it(
    "lands a cl with a plain push that crate checks, and moves its branch to the commit main took",
    { timeout: 120_000 },
    async () => {
      built("a", {
        "src/a.mjs": "export const a = 1;\n",
        "test/a.test.mjs": test("a", 1),
      });
      const out = await land(run("a"));
      expect(out.message).toMatchObject({ word: "pass" });
      expect(out.message.reason).toMatch(/^landed on server\/main at /);
      expect(out.files.sort()).toEqual(["src/a.mjs", "test/a.test.mjs"]);
      expect(onMain("src/a.mjs")).toBe("export const a = 1;");
      expect(git(repo, "rev-parse", branchOf("is-a"))).toBe(main());
      expect(out.commit).toBe(main());
      expect(out.ran).toBeUndefined();
    },
  );

  it(
    "lands two cls built from one main: the second is rebased onto the first, and crate checks it",
    { timeout: 120_000 },
    async () => {
      built("b", { "src/b.mjs": "export const b = 1;\n" });
      built("c", { "src/c.mjs": "export const c = 1;\n" });
      expect((await land(run("b"))).message.word).toBe("pass");
      expect((await land(run("c"))).message.word).toBe("pass");
      expect(onMain("src/b.mjs")).toBe("export const b = 1;");
      expect(onMain("src/c.mjs")).toBe("export const c = 1;");
    },
  );

  it(
    "sends a cl that crate's check refuses back about the code, with its output, and main does not move",
    { timeout: 120_000 },
    async () => {
      built("f", { "test/f.test.mjs": test("f", 1) });
      built("g", {
        "src/value.mjs": "export const value = 2;\n",
        "test/base.test.mjs": test("base", 2),
        "test/a.test.mjs": test("a", 2),
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
      expect(out.message.findings[0]?.what).toMatch(/check failed at: test/);
      expect(main()).toBe(before);
      expect(
        git(repo, "merge-base", "--is-ancestor", before, branchOf("is-f")),
      ).toBe("");
    },
  );
});
