/**
 * A repo's dev image, as the factory takes it: from crate's `dev-image`, run in the orchestrator, never from the
 * repo's own `scripts/dev-image.sh`. The command is a stand-in on the PATH, at the seam the Seam names, and the
 * promise is read where it is decided: the tag an issue's repo carries, and the call crate is given.
 */

import { execFileSync } from "node:child_process";
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
import { compose } from "../main.ts";
import { main } from "../cli/index.ts";
import type { Reader } from "./repo.ts";

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

const git = (at: string, ...args: string[]) =>
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
      at,
      ...args,
    ],
    { encoding: "utf8" },
  ).trim();

const commit = (at: string, message: string) => {
  git(at, "add", "-A");
  git(at, "commit", "-q", "-m", message);
  return git(at, "rev-parse", "HEAD");
};

/** A repo on crate, a real git repo: its full suite, a lockfile, and main at its one commit. */
function onCrate(at: string, image = "img") {
  mkdirSync(at, { recursive: true });
  git(at, "init", "-q", "-b", "main");
  mkdirSync(join(at, "scripts"), { recursive: true });
  writeFileSync(join(at, "crate.toml"), `crate = "1"\nimage = "${image}"\n`);
  writeFileSync(join(at, "scripts", "check.sh"), "#!/bin/sh\n");
  writeFileSync(join(at, "package-lock.json"), "{}\n");
  const main = commit(at, "main");
  git(at, "update-ref", "refs/remotes/server/main", main);
  return main;
}

/** The repo as a test has it: its files on disk are its main's, and it is on crate when it has a crate.toml. */
const read: Reader = {
  file: (p, f) =>
    existsSync(join(p, f)) ? readFileSync(join(p, f), "utf8") : undefined,
  onCrate: (p) => existsSync(join(p, "crate.toml")),
};

const issue =
  "---\ntype: issue\nstatus: new\n---\nfx.\n\n---\n## Done\n\n- a is 2\n";

/** The lone cl of an issue, in the repo given. */
const cl = (repo: string) => `---
type: cl
description: "A cut of fx."
belongsTo: "[[fx]]"
status: new
repo: ${repo}
shape:
  change: behavior
  checked: repo
checkout:
  - src/a.ts
  - test/a.test.ts
test: npx vitest run test/a.test.ts
---
src/a.ts exports a, which is 2.

---
## Check

- given a, when imported, then it is 2

## Seam

a's name and type.

## Checkout

- test/a.test.ts: the test
`;

/** A dev repo and the issue note that takes it. */
function devRepo(name = "repo") {
  const at = join(home, name);
  onCrate(at, "dev");
  const note = join(home, "fx.md");
  writeFileSync(note, issue);
  return { at, note };
}

const ledgerItem = (name: string) => compose({ home }).ledger.item(name);

describe("a repo's dev image", () => {
  it("comes from crate dev-image local, for a dev repo with no scripts/dev-image.sh", async () => {
    fakeCrate("printf '%s\\n' localhost/repo-dev:local");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { at, note } = devRepo();
    expect(
      await main(["add", note, "--repo", at], { ASSEMBLY_HOME: home }, read),
    ).toBe(0);
    expect(calls()).toEqual([
      ["-C", at, "dev-image", "local", "--name", "repo"],
    ]);
    expect(existsSync(join(at, "scripts", "dev-image.sh"))).toBe(false);
    expect(ledgerItem("fx")).toMatchObject({
      image: "localhost/repo-dev:local",
      state: "open",
    });
  });

  it("is left alone, and crate is not run, for a repo whose crate.toml pins its image", async () => {
    fakeCrate("printf '%s\\n' localhost/should-not-be-used");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const at = join(home, "repo");
    onCrate(at, "img");
    const note = join(home, "fx.md");
    writeFileSync(note, issue);
    expect(
      await main(["add", note, "--repo", at], { ASSEMBLY_HOME: home }, read),
    ).toBe(0);
    expect(calls()).toEqual([]);
    expect(ledgerItem("fx")?.image).toBe("img");
  });

  it("comes from crate dev-image local at submit, when the repo's checkout is at its main", async () => {
    fakeCrate("printf '%s\\n' localhost/kinetic-dev:local");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const kinetic = join(home, "kinetic");
    onCrate(kinetic, "dev");
    mkdirSync(join(kinetic, "_well"));
    writeFileSync(join(kinetic, "_well", "fx.md"), issue);
    writeFileSync(join(kinetic, "_well", "fx-a.md"), cl("kinetic"));
    const at = commit(kinetic, "the spec");
    git(kinetic, "update-ref", "refs/remotes/server/main", at);
    expect(
      await main(
        ["submit", "fx", "--repo", kinetic],
        { ASSEMBLY_HOME: home },
        read,
      ),
    ).toBe(0);
    expect(calls()).toEqual([
      ["-C", kinetic, "dev-image", "local", "--name", "kinetic"],
    ]);
    expect(ledgerItem("fx")?.image).toBe("localhost/kinetic-dev:local");
  });

  it("comes from crate dev-image ref --rev, at submit, where the repo has no checkout at its main", async () => {
    fakeCrate("printf '%s\\n' localhost/kinetic-dev:ref");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const kinetic = join(home, "kinetic");
    onCrate(kinetic, "dev");
    mkdirSync(join(kinetic, "_well"));
    writeFileSync(join(kinetic, "_well", "fx.md"), issue);
    writeFileSync(join(kinetic, "_well", "fx-a.md"), cl("kinetic"));
    const base = commit(kinetic, "the spec");
    // main stays at the spec's commit, and the checkout moves on: there is no checkout at main
    git(kinetic, "update-ref", "refs/remotes/server/main", base);
    writeFileSync(join(kinetic, "later.txt"), "later\n");
    commit(kinetic, "after main");
    expect(
      await main(
        ["submit", "fx", "--repo", kinetic],
        { ASSEMBLY_HOME: home },
        read,
      ),
    ).toBe(0);
    expect(calls()).toEqual([
      ["-C", kinetic, "dev-image", "ref", "--rev", base, "--name", "kinetic"],
    ]);
    expect(ledgerItem("fx")?.image).toBe("localhost/kinetic-dev:ref");
  });

  it("at submit, takes kinetic's dev image at the --at commit, and each other dev repo's at its own main", async () => {
    fakeCrate(`name=""
prev=""
for a in "$@"; do
  [ "$prev" = --name ] && name=$a
  prev=$a
done
printf '%s\\n' "localhost/$name-dev:made"`);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const kinetic = join(home, "kinetic");
    onCrate(kinetic, "dev");
    mkdirSync(join(kinetic, "_well"));
    writeFileSync(join(kinetic, "_well", "fx.md"), issue);
    writeFileSync(join(kinetic, "_well", "fx-a.md"), cl("other"));
    const spec = commit(kinetic, "the spec");
    // kinetic's main moves on, so its checkout is not at the spec's commit
    writeFileSync(join(kinetic, "later.txt"), "later\n");
    const kineticMain = commit(kinetic, "after the spec");
    git(kinetic, "update-ref", "refs/remotes/server/main", kineticMain);
    const other = join(home, "other");
    onCrate(other, "dev");
    const otherMain = git(other, "rev-parse", "HEAD");
    // the other repo's checkout moves on too, so it has no checkout at its own main
    writeFileSync(join(other, "later.txt"), "later\n");
    commit(other, "after main");
    expect(
      await main(
        ["submit", "fx", "--repo", kinetic, "--repo", other, "--at", spec],
        { ASSEMBLY_HOME: home },
        read,
      ),
    ).toBe(0);
    expect(calls()).toHaveLength(2);
    expect(calls()).toEqual(
      expect.arrayContaining([
        ["-C", kinetic, "dev-image", "ref", "--rev", spec, "--name", "kinetic"],
        [
          "-C",
          other,
          "dev-image",
          "ref",
          "--rev",
          otherMain,
          "--name",
          "other",
        ],
      ]),
    );
    expect(ledgerItem("fx")?.repos.map((r) => [r.name, r.image])).toEqual(
      expect.arrayContaining([
        ["kinetic", "localhost/kinetic-dev:made"],
        ["other", "localhost/other-dev:made"],
      ]),
    );
    expect(compose({ home }).ledger.spec("fx")?.commit).toBe(spec);
  });

  it("is resolved for each repo of an issue of several dev repos, and each repo carries its own tag", async () => {
    fakeCrate(`name=""
prev=""
for a in "$@"; do
  [ "$prev" = --name ] && name=$a
  prev=$a
done
printf '%s\\n' "localhost/$name-dev:local"`);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const first = join(home, "first");
    const second = join(home, "second");
    onCrate(first, "dev");
    onCrate(second, "dev");
    const note = join(home, "fx.md");
    writeFileSync(note, issue);
    expect(
      await main(
        ["add", note, "--repo", first, "--repo", second],
        { ASSEMBLY_HOME: home },
        read,
      ),
    ).toBe(0);
    expect(ledgerItem("fx")?.repos.map((r) => [r.name, r.image])).toEqual([
      ["first", "localhost/first-dev:local"],
      ["second", "localhost/second-dev:local"],
    ]);
  });

  it("is resolved for a repo found under ASSEMBLY_REPOS, when add names none", async () => {
    fakeCrate("printf '%s\\n' localhost/repo-dev:under-root");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { note } = devRepo();
    expect(
      await main(
        ["add", note],
        { ASSEMBLY_HOME: home, ASSEMBLY_REPOS: home },
        read,
      ),
    ).toBe(0);
    expect(calls()).toEqual([
      ["-C", join(home, "repo"), "dev-image", "local", "--name", "repo"],
    ]);
    expect(ledgerItem("fx")?.image).toBe("localhost/repo-dev:under-root");
  });

  it("stops with crate's output and exit code when crate dev-image fails, and takes no issue", async () => {
    fakeCrate("printf '%s\\n' 'crate cannot build this image' >&2\nexit 7");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { at, note } = devRepo();
    expect(
      await main(["add", note, "--repo", at], { ASSEMBLY_HOME: home }, read),
    ).toBe(7);
    expect(err).toHaveBeenLastCalledWith(
      expect.stringContaining("crate cannot build this image"),
    );
    expect(compose({ home }).ledger.items()).toEqual([]);
  });

  it("stops when crate is not there, naming crate, and takes no issue", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { at, note } = devRepo();
    process.env.PATH = path
      .split(delimiter)
      .filter((dir) => !existsSync(join(dir, "crate")))
      .join(delimiter);
    expect(
      await main(["add", note, "--repo", at], { ASSEMBLY_HOME: home }, read),
    ).not.toBe(0);
    expect(err).toHaveBeenLastCalledWith(expect.stringMatching(/crate/));
    expect(compose({ home }).ledger.items()).toEqual([]);
  });
});
