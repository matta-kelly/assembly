import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compose } from "../main.ts";
import { gitReader, type Reader } from "../effects/repo.ts";
import { homeOf, main } from "./index.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "factory-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

describe("the factory's home", () => {
  it("is ASSEMBLY_HOME, else under XDG_STATE_HOME", () => {
    expect(homeOf({ ASSEMBLY_HOME: "/a", XDG_STATE_HOME: "/s" })).toBe("/a");
    expect(homeOf({ XDG_STATE_HOME: "/s" })).toBe("/s/assembly");
  });
});

/** A repo on crate: its image and its full suite. */
function onCrate(at: string, image: string) {
  mkdirSync(join(at, ".git"), { recursive: true });
  mkdirSync(join(at, "scripts"), { recursive: true });
  writeFileSync(join(at, "crate.toml"), `image = "${image}"\n`);
  writeFileSync(join(at, "scripts", "check.sh"), "#!/bin/sh\n");
}

/** The repo as a test has it: its files on disk are its main's, and it is on crate when it has a crate.toml. */
const read: Reader = {
  file: (path, file) =>
    existsSync(join(path, file))
      ? readFileSync(join(path, file), "utf8")
      : undefined,
  onCrate: (path) => existsSync(join(path, "crate.toml")),
};

describe("the command line", () => {
  const add = (note: string, repo: string) =>
    main(
      ["add", note, "--repo", repo],
      {
        ASSEMBLY_HOME: home,
        ASSEMBLY_DEV_IMAGES: "repo=ghcr.io/x/repo-dev:abc",
      },
      read,
    );

  it("adds an issue by its note, named by the file", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const note = join(home, "my-issue.md");
    writeFileSync(note, "---\ntype: issue\n---\nan issue\n");
    const repo = join(home, "repo");
    onCrate(repo, "dev");
    expect(await add(note, repo)).toBe(0);
    expect(log).toHaveBeenCalledWith("added my-issue, open, in repo");
    expect(compose({ home }).ledger.item("my-issue")).toMatchObject({
      path: note,
      repo,
      image: "ghcr.io/x/repo-dev:abc",
      test: "scripts/check.sh all",
      state: "open",
    });
  });

  it("submits an issue by its name at the commit --at gives, and refuses a name with no note there", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repo = join(home, "repo");
    const kinetic = join(home, "kinetic");
    onCrate(repo, "img");
    mkdirSync(kinetic);
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        ["-c", "user.name=t", "-c", "user.email=t@t", "-C", kinetic, ...args],
        { encoding: "utf8" },
      ).trim();
    git("init", "-q", "-b", "main");
    onCrate(kinetic, "img");
    mkdirSync(join(kinetic, "_well"));
    git("add", "-A");
    git("commit", "-q", "-m", "before the issue");
    const before = git("rev-parse", "HEAD");
    writeFileSync(
      join(kinetic, "_well", "fx.md"),
      "---\ntype: issue\nstatus: new\n---\nfx.\n\n---\n## Done\n\n- a is 2\n",
    );
    writeFileSync(
      join(kinetic, "_well", "fx-a.md"),
      `---
type: cl
description: "A cut of fx."
belongsTo: "[[fx]]"
status: new
repo: repo
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
`,
    );
    git("add", "-A");
    git("commit", "-q", "-m", "the spec");
    const at = git("rev-parse", "HEAD");
    const env = { ASSEMBLY_HOME: home };
    const submit = (c: string) =>
      main(
        ["submit", "fx", "--repo", repo, "--repo", kinetic, "--at", c],
        env,
        read,
      );
    expect(await submit(before)).toBe(1);
    expect(err).toHaveBeenLastCalledWith(
      expect.stringContaining("_well/fx.md"),
    );
    expect(compose({ home }).ledger.items()).toEqual([]);
    expect(await submit(at)).toBe(0);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^submitted fx, building, with 1 cl:/),
    );
    expect(compose({ home }).ledger.spec("fx")?.commit).toBe(at);
  });

  it("refuses an issue with no note, a repo that is not one, or a name it has", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const note = join(home, "is.md");
    const repo = join(home, "repo");
    expect(await add(note, repo)).toBe(1);
    expect(err).toHaveBeenLastCalledWith(`no note at ${note}`);
    writeFileSync(note, "---\ntype: issue\n---\nan issue\n");
    expect(await add(note, repo)).toBe(1);
    expect(err).toHaveBeenLastCalledWith(`${repo} is not a git repo`);
    mkdirSync(join(repo, ".git"), { recursive: true });
    expect(await add(note, repo)).toBe(1);
    expect(err).toHaveBeenLastCalledWith(
      `${repo} is not on crate: its server/main has no crate.toml`,
    );
    onCrate(repo, "img");
    expect(await add(note, repo)).toBe(0);
    expect(await add(note, repo)).toBe(1);
    expect(err).toHaveBeenLastCalledWith("is is in the ledger already");
  });

  it("refuses a note whose name is not kebab-case, an item it does not have, and a tick that is not a time", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = { ASSEMBLY_HOME: home };
    writeFileSync(join(home, "My Issue.md"), "---\ntype: issue\n---\n");
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
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/\nfactory add/));
    const note = join(home, "is.md");
    writeFileSync(note, "---\ntype: issue\n---\n");
    expect(await main(["add", note], env)).toBe(2);
    expect(err).toHaveBeenLastCalledWith(
      expect.stringMatching(/^an issue needs its repos: --repo, or a root/),
    );
    expect(existsSync(join(home, "ledger.db"))).toBe(false);
  });
});

describe("the repos under ASSEMBLY_REPOS", () => {
  it("finds the clones, and kinetic among them, when submit names none", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const root = join(home, "clones");
    const git = (at: string, ...args: string[]) =>
      execFileSync(
        "git",
        ["-c", "user.name=t", "-c", "user.email=t@t", "-C", at, ...args],
        { encoding: "utf8" },
      ).trim();
    const clone = (name: string, onServer: boolean) => {
      const at = join(root, name);
      mkdirSync(at, { recursive: true });
      git(at, "init", "-q", "-b", "main");
      onCrate(at, "img");
      if (onServer)
        git(at, "remote", "add", "server", `core@localhost:git/${name}.git`);
      return at;
    };
    const commit = (at: string, message: string) => {
      git(at, "add", "-A");
      git(at, "commit", "-q", "-m", message);
    };
    const kinetic = clone("kinetic", true);
    const repo = clone("repo", true);
    const loose = clone("loose", false);
    mkdirSync(join(kinetic, "_well"));
    writeFileSync(
      join(kinetic, "_well", "fx.md"),
      "---\ntype: issue\nstatus: new\n---\nfx.\n\n---\n## Done\n\n- a is 2\n",
    );
    writeFileSync(
      join(kinetic, "_well", "fx-a.md"),
      `---
type: cl
description: "A cut of fx."
belongsTo: "[[fx]]"
status: new
repo: repo
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
`,
    );
    commit(kinetic, "the spec");
    commit(repo, "main");
    commit(loose, "main");
    const at = git(kinetic, "rev-parse", "HEAD");
    git(kinetic, "update-ref", "refs/remotes/server/main", at);
    const read: Reader = {
      file: (path, file) =>
        existsSync(join(path, file))
          ? readFileSync(join(path, file), "utf8")
          : undefined,
      onCrate: gitReader.onCrate,
    };
    expect(
      await main(
        ["submit", "fx"],
        { ASSEMBLY_HOME: home, ASSEMBLY_REPOS: root },
        read,
      ),
    ).toBe(0);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^submitted fx, building, with 1 cl:/),
    );
    const item = compose({ home }).ledger.item("fx");
    expect(item?.repos.map((r) => r.name).sort()).toEqual(["kinetic", "repo"]);
    expect(item?.repos.find((r) => r.name === "kinetic")?.repo).toBe(kinetic);
    expect(compose({ home }).ledger.spec("fx")?.commit).toBe(at);
  });
});
