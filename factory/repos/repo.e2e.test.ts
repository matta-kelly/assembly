/**
 * The dev image of a lockfile no image has yet, on the real engine (`just e2e`): crate makes the image from the cl's
 * worktree, as an attempt reads its settings, and an offline `npm ci` in it passes, in a container of its own. This is
 * what a cl's move rests on: the lockfile it commits is newer than any dev image the repo has.
 *
 * The repo's own checkout stays at main: the image comes from the worktree, at the cl's branch.
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../line/step.ts";
import { containerfile, devToml, smoke } from "./dev-image.fixture.ts";
import { npmSetup, settingsAt } from "./repo.ts";
import { needsSetup, runSetup } from "../runs/setup.ts";

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

describe.skipIf(!process.env["ASSEMBLY_E2E"])(
  "a repo's dev image for a new lockfile",
  () => {
    let dir: string;

    beforeAll(() => {
      mkdirSync(".e2e", { recursive: true });
      dir = mkdtempSync(join(process.cwd(), ".e2e", "dev-image-"));
    });
    afterAll(() => {
      if (!process.env["ASSEMBLY_E2E_KEEP"])
        rmSync(dir, { recursive: true, force: true });
    });

    it(
      "is made for a commit no image has, and an offline npm ci in it passes",
      { timeout: 420_000 },
      async () => {
        const repo = join(dir, "repo");
        mkdirSync(join(repo, "scripts"), { recursive: true });
        mkdirSync(join(repo, ".crate"), { recursive: true });
        git(repo, "init", "-q", "-b", "main");
        writeFileSync(join(repo, "crate.toml"), devToml("repo"));
        writeFileSync(join(repo, "scripts", "check.sh"), "#!/bin/sh\nexit 0\n");
        chmodSync(join(repo, "scripts", "check.sh"), 0o755);
        // crate builds the image and then runs this: an offline install from its cache.
        writeFileSync(join(repo, "scripts", "dev-image-smoke.sh"), smoke());
        chmodSync(join(repo, "scripts", "dev-image-smoke.sh"), 0o755);
        writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
        writeFileSync(
          join(repo, ".crate", "Containerfile"),
          containerfile("repo"),
        );
        writeFileSync(
          join(repo, "package.json"),
          `${JSON.stringify({ name: "repo", version: "1.0.0", private: true }, null, 2)}\n`,
        );
        git(repo, "add", "-A");
        git(repo, "commit", "-q", "-m", "the repo, with no dependencies");

        // A branch whose lockfile asks a package main's has not: the commit a cl's move makes.
        const work = join(dir, "work");
        git(repo, "worktree", "add", "-q", "-b", "moved", work);
        execFileSync(
          "npm",
          [
            "install",
            "is-odd@3.0.1",
            "--save-exact=false",
            "--no-audit",
            "--no-fund",
          ],
          { cwd: work, stdio: "ignore", timeout: 300_000 },
        );
        git(work, "add", "-A");
        git(work, "commit", "-q", "-m", "build(deps): is-odd to 3.0.1");
        const commit = git(work, "rev-parse", "HEAD");
        expect(readFileSync(join(work, "package-lock.json"), "utf8")).toMatch(
          /is-odd/,
        );

        // The image is made from the worktree, at the moved commit.
        expect(git(work, "rev-parse", "HEAD")).toBe(commit);
        const settings = await settingsAt(work, "repo").then(
          (s) => s,
          (e: Error) => ({ image: `no tag: ${e.message}`, setup: "" }),
        );
        const made = settings.image;
        expect(made).not.toMatch(/^no tag: /);
        expect(settings.setup).toBe(npmSetup);

        // An attempt of that commit: its setup installs the lockfile from that image's cache, with no network.
        const r: Run = {
          name: "is-a",
          kind: "cl",
          issue: "is",
          seq: 1,
          n: 1,
          note: "_well/is-a.md",
          notes: { repo: "", commit: "" },
          repo,
          image: made,
          test: "true",
          setup: npmSetup,
          dir: join(dir, "runs", "1"),
          work,
        };
        expect(needsSetup(r)).toBe(true);
        const ran = await runSetup(r).then(
          () => undefined,
          (e: Error) => `the setup failed: ${e.message}`,
        );
        expect(ran).toBeUndefined();
        expect(needsSetup(r)).toBe(false);
        expect(
          JSON.parse(
            readFileSync(
              join(work, "node_modules", "is-odd", "package.json"),
              "utf8",
            ),
          ),
        ).toMatchObject({ version: "3.0.1" });
      },
    );
  },
);
