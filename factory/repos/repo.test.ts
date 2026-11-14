/**
 * A repo's settings, as an attempt reads them from its worktree: the image its crate.toml names, a dev repo's made by
 * crate's `dev-image local` from that worktree, never from the repo's own `scripts/dev-image.sh`; its full suite; and
 * its setup, by its lockfile. crate is a stand-in on the PATH, so the call it is given is what is read.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CrateError,
  fullSuite,
  NotOnCrate,
  npmSetup,
  settingsAt,
} from "./repo.ts";

let home: string;
let bin: string;
let path: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "repo-"));
  bin = join(home, "bin");
  mkdirSync(bin);
  path = process.env.PATH ?? "";
  process.env.PATH = `${bin}${delimiter}${path}`;
  process.env.CRATE_ARGS = join(home, "crate-args");
});
afterEach(() => {
  process.env.PATH = path;
  delete process.env.CRATE_ARGS;
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

/** A stand-in for `crate` on the PATH: it records each call, then runs `body`. */
function fakeCrate(body = ""): void {
  const at = join(bin, "crate");
  writeFileSync(
    at,
    `#!/usr/bin/env bash
printf -- '--call--\\n' >> "$CRATE_ARGS"
printf '%s\\n' "$@" >> "$CRATE_ARGS"
${body}
`,
  );
  chmodSync(at, 0o755);
}

/** The calls the stand-in was given, each as its arguments. */
const calls = (): string[][] => {
  const at = process.env.CRATE_ARGS;
  if (!at || !existsSync(at)) return [];
  return readFileSync(at, "utf8")
    .split("--call--\n")
    .filter((call) => call !== "")
    .map((call) => call.replace(/\n$/, "").split("\n"));
};

/** A worktree of a repo on crate: its image, its full suite, and a lockfile unless told not to. */
function worktree(image = "img", lock = true) {
  const at = join(home, "work");
  mkdirSync(join(at, "scripts"), { recursive: true });
  writeFileSync(join(at, "crate.toml"), `crate = "1"\nimage = "${image}"\n`);
  writeFileSync(join(at, "scripts", "check.sh"), "#!/bin/sh\n");
  if (lock) writeFileSync(join(at, "package-lock.json"), "{}\n");
  return at;
}

describe("a repo's settings", () => {
  it("are its worktree's: the image its crate.toml pins, its full suite, and an offline npm ci for its lockfile", async () => {
    fakeCrate("printf '%s\\n' localhost/should-not-be-used");
    expect(await settingsAt(worktree(), "repo")).toEqual({
      image: "img",
      test: fullSuite,
      setup: npmSetup,
    });
    expect(calls()).toEqual([]);
  });

  it("have no setup when the worktree has no lockfile", async () => {
    expect((await settingsAt(worktree("img", false), "repo")).setup).toBe("");
  });

  it("refuse a worktree that is not on crate: no crate.toml, no image, or no full suite", async () => {
    const at = worktree();
    rmSync(join(at, "scripts", "check.sh"));
    await expect(settingsAt(at, "repo")).rejects.toThrow(
      /repo has no scripts\/check\.sh/,
    );
    writeFileSync(join(at, "crate.toml"), 'crate = "1"\n');
    await expect(settingsAt(at, "repo")).rejects.toThrow(/names no image/);
    rmSync(join(at, "crate.toml"));
    await expect(settingsAt(at, "repo")).rejects.toBeInstanceOf(NotOnCrate);
  });
});

describe("a repo's dev image", () => {
  it("comes from crate dev-image local, run on the worktree, for a dev repo", async () => {
    fakeCrate("printf '%s\\n' building 'localhost/repo-dev:local'");
    const at = worktree("dev");
    expect((await settingsAt(at, "repo")).image).toBe(
      "localhost/repo-dev:local",
    );
    expect(calls()).toEqual([["-C", at, "dev-image", "local"]]);
    expect(existsSync(join(at, "scripts", "dev-image.sh"))).toBe(false);
  });

  it("fails with crate's output and exit code when crate dev-image fails", async () => {
    fakeCrate("printf '%s\\n' 'crate cannot build this image' >&2\nexit 7");
    const failed = settingsAt(worktree("dev"), "repo");
    await expect(failed).rejects.toBeInstanceOf(CrateError);
    await expect(failed).rejects.toMatchObject({
      exitCode: 7,
      output: expect.stringContaining("crate cannot build this image"),
    });
  });

  it("fails, naming crate, when crate is not there", async () => {
    process.env.PATH = path
      .split(delimiter)
      .filter((dir) => !existsSync(join(dir, "crate")))
      .join(delimiter);
    await expect(settingsAt(worktree("dev"), "repo")).rejects.toThrow(/crate/);
  });
});
