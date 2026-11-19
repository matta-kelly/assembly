/**
 * The attempt's workspace on the real engine (`just e2e`): crate makes it from a repo's own crate.toml on the item's
 * worktree, with a lockfile no image has yet, and the factory works in it only through crate: up, the agent's sandbox
 * (files over stdin, a shell with no network), the check's run and its exit code, and down. A lockfile newer than every
 * dev image is what a cl's move commits, so the workspace's setup installs it from the image crate makes for it.
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../line/step.ts";
import { containerfile, devToml } from "../repos/dev-image.fixture.ts";
import { boxOf, down, imageOf, runIn, up } from "./workspace.ts";
import { sh } from "../sh.ts";

const git = (repo: string, ...args: string[]) =>
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
      repo,
      ...args,
    ],
    { encoding: "utf8" },
  ).trim();

describe.skipIf(!process.env["ASSEMBLY_E2E"])("an attempt's workspace", () => {
  let dir: string;
  let r: Run;

  beforeAll(() => {
    mkdirSync(".e2e", { recursive: true });
    dir = mkdtempSync(join(process.cwd(), ".e2e", "workspace-"));
    const repo = join(dir, "repo");
    mkdirSync(join(repo, "scripts"), { recursive: true });
    mkdirSync(join(repo, ".crate"), { recursive: true });
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, "crate.toml"), devToml("repo"));
    writeFileSync(
      join(repo, "scripts", "check.sh"),
      '#!/bin/sh\ntest -f node_modules/is-odd/package.json && exit "${1:-0}"\n',
    );
    chmodSync(join(repo, "scripts", "check.sh"), 0o755);
    writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
    writeFileSync(join(repo, ".crate", "Containerfile"), containerfile("repo"));
    writeFileSync(
      join(repo, "package.json"),
      `${JSON.stringify({ name: "repo", version: "1.0.0", private: true }, null, 2)}\n`,
    );
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "the repo, with no dependencies");
    // the item's worktree, named for it, on a branch whose lockfile asks a package main's has not
    const work = join(dir, "is-a");
    git(repo, "worktree", "add", "-q", "-b", "moved", work);
    execFileSync(
      "npm",
      ["install", "is-odd@3.0.1", "--no-audit", "--no-fund"],
      {
        cwd: work,
        stdio: "ignore",
        timeout: 300_000,
      },
    );
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", "build(deps): is-odd to 3.0.1");
    r = {
      name: "is-a",
      kind: "cl",
      issue: "is",
      seq: 1,
      n: 1,
      note: "_well/is-a.md",
      notes: { repo: "", commit: "" },
      repo,
      test: "scripts/check.sh",
      tests: [],
      dir: join(dir, "runs", "1"),
      work,
    };
  });
  afterAll(async () => {
    await down(r).catch(() => undefined);
    if (!process.env["ASSEMBLY_E2E_KEEP"])
      rmSync(dir, { recursive: true, force: true });
  });

  it(
    "comes up from the repo's crate.toml, and the agent and the check work in it through crate alone",
    { timeout: 600_000 },
    async () => {
      await up(r);
      // a second up changes nothing: a taken-up attempt brings its workspace up again
      await up(r);
      const image = await imageOf(r);
      expect(image?.name).toMatch(/repo/);

      // the agent's sandbox: a file written over stdin is in the worktree, read back, and its shell has no network
      const box = boxOf(r);
      expect(
        await box.write("src/a.ts", "export const a = 1;\n"),
      ).toMatchObject({ path: "src/a.ts" });
      const read = await box.read("src/a.ts", 0, 100);
      expect(JSON.stringify(read)).toContain("export const a = 1;");
      const shell = box as unknown as {
        execute(c: string): Promise<{ output: string; exitCode: number }>;
      };
      expect(
        await shell.execute("ls node_modules/is-odd/package.json"),
      ).toMatchObject({ exitCode: 0 });
      expect(
        (await shell.execute("getent hosts registry.npmjs.org")).exitCode,
      ).not.toBe(0);

      // the check: its exit code, recorded with the tree and the image it ran in
      const green = await runIn(r, "scripts/check.sh 0");
      expect(green.code).toBe(0);
      expect(green.check).toMatchObject({
        command: "scripts/check.sh 0",
        code: 0,
        image: image?.name,
      });
      expect((await runIn(r, "scripts/check.sh 3")).code).toBe(3);

      await down(r);
      expect(await imageOf(r)).toBeUndefined();
      const left = await sh("podman", ["ps", "-a", "--format", "{{.Names}}"]);
      expect(left.stdout).not.toMatch(/repo-is-a/);
    },
  );
});
