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
import { gitReader, type Reader } from "../repos/repo.ts";
import { homeOf, main, notesOf } from "./index.ts";

// The notes' main is the notes repo's own main: it has no remote to fetch.
vi.mock("../repos/git.ts", async (original) => ({
  ...(await original<typeof import("../repos/git.ts")>()),
  mainOf: vi.fn(async () => "main"),
}));

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

describe("the notes repo", () => {
  it("is ASSEMBLY_NOTES, else kinetic under ASSEMBLY_REPOS, else none", () => {
    expect(notesOf({ ASSEMBLY_NOTES: "/n", ASSEMBLY_REPOS: "/r" })).toBe("/n");
    expect(notesOf({ ASSEMBLY_REPOS: "/r" })).toBe("/r/kinetic");
    expect(notesOf({})).toBeUndefined();
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

const git = (at: string, ...args: string[]) =>
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", "-C", at, ...args],
    { encoding: "utf8" },
  ).trim();

const issueNote =
  "---\ntype: issue\nstatus: new\n---\nfx.\n\n---\n## Done\n\n- a is 2\n";
const clNote = `---
type: cl
description: "A cut of fx."
belongsTo: "[[fx]]"
status: new
repo: repo
shape:
  change: behavior
  checked: repo
test: npx vitest run test/a.test.ts
---
src/a.ts exports a, which is 2.

---
## Promises

- given a, when imported, then it is 2

## Seam

a's name and type.

## Core context

- test/a.test.ts: the test
`;

/** A notes repo at `at`: a real git repo, `notes` committed on its main. */
function notesAt(at: string, notes: Record<string, string>) {
  mkdirSync(join(at, "_well"), { recursive: true });
  git(at, "init", "-q", "-b", "main");
  for (const [name, text] of Object.entries(notes))
    writeFileSync(join(at, "_well", `${name}.md`), text);
  git(at, "add", "-A");
  git(at, "commit", "-q", "--allow-empty", "-m", "notes");
  return at;
}

describe("the command line", () => {
  it("submits an issue by its name, from the notes repo's main, and refuses a name with no note there", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repo = join(home, "repo");
    onCrate(repo, "img");
    const notes = notesAt(join(home, "notes"), {
      fx: issueNote,
      "fx-a": clNote,
    });
    const env = { ASSEMBLY_HOME: home, ASSEMBLY_NOTES: notes };
    expect(await main(["submit", "gx", "--repo", repo], env, read)).toBe(1);
    expect(err).toHaveBeenLastCalledWith(
      expect.stringContaining("_well/gx.md"),
    );
    expect(compose({ home }).ledger.items()).toEqual([]);
    expect(await main(["submit", "fx", "--repo", repo], env, read)).toBe(0);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^submitted fx, building, with 1 cl:/),
    );
    expect(compose({ home }).ledger.item("fx")).toMatchObject({
      note: "_well/fx.md",
      repo,
      state: "building",
    });
  });

  it("stops an item and resumes it, at a station it is given", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repo = join(home, "repo");
    onCrate(repo, "img");
    const notes = notesAt(join(home, "notes"), { fx: issueNote });
    const env = { ASSEMBLY_HOME: home, ASSEMBLY_NOTES: notes };
    expect(await main(["submit", "fx", "--repo", repo], env, read)).toBe(0);
    expect(await main(["stop", "fx"], env)).toBe(0);
    expect(log).toHaveBeenLastCalledWith("stopped fx, at open");
    expect(await main(["resume", "fx", "ready"], env)).toBe(1);
    expect(err).toHaveBeenLastCalledWith(
      "ready is no station of an issue: open, approved, building, built",
    );
    expect(await main(["resume", "fx"], env)).toBe(0);
    expect(log).toHaveBeenLastCalledWith("resumed fx, at open");
    expect(compose({ home }).ledger.item("fx").state).toBe("open");
    expect(await main(["resume"], env)).toBe(2);
  });

  it("refuses a repo that is not one, or a name it has", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const notes = notesAt(join(home, "notes"), { is: issueNote });
    const env = { ASSEMBLY_HOME: home, ASSEMBLY_NOTES: notes };
    const repo = join(home, "repo");
    const submit = () => main(["submit", "is", "--repo", repo], env, read);
    expect(await submit()).toBe(1);
    expect(err).toHaveBeenLastCalledWith(`${repo} is not a git repo`);
    onCrate(repo, "img");
    expect(await submit()).toBe(0);
    expect(await submit()).toBe(1);
    expect(err).toHaveBeenLastCalledWith("is is in the ledger already");
  });

  it("refuses a name that is not kebab-case, an item it does not have, and a tick that is not a time", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = { ASSEMBLY_HOME: home, ASSEMBLY_NOTES: join(home, "notes") };
    expect(await main(["submit", "My Issue", "--repo", home], env)).toBe(1);
    expect(err).toHaveBeenLastCalledWith(
      "My Issue: an issue's name is kebab-case",
    );
    expect(await main(["explain", "typo"], env)).toBe(1);
    expect(err).toHaveBeenLastCalledWith("no item typo in the ledger");
    expect(await main(["run", "--every", "5s"], env)).toBe(1);
    expect(await main(["run", "--every", "0"], env)).toBe(1);
  });

  it("prints its usage for a verb it does not know, or one missing its arguments or its notes repo", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = { ASSEMBLY_HOME: home };
    expect(await main(["land"], env)).toBe(2);
    expect(existsSync(join(home, "ledger.db"))).toBe(false);
    expect(await main(["add", "x.md"], env)).toBe(2);
    expect(await main(["submit"], env)).toBe(2);
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/^factory submit/m));
    expect(await main(["submit", "is"], env)).toBe(2);
    expect(err).toHaveBeenLastCalledWith(
      expect.stringMatching(/^submit needs the notes repo/),
    );
    expect(await main(["submit", "is"], { ...env, ASSEMBLY_NOTES: home })).toBe(
      2,
    );
    expect(err).toHaveBeenLastCalledWith(
      expect.stringMatching(/^an issue needs its repos: --repo, or a root/),
    );
    expect(existsSync(join(home, "ledger.db"))).toBe(false);
  });
});

describe("the repos under ASSEMBLY_REPOS", () => {
  it("are the clones on crate an issue may change when submit names none, and kinetic among them is the notes repo, not one of them", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const root = join(home, "clones");
    const clone = (name: string, onServer: boolean) => {
      const at = join(root, name);
      mkdirSync(at, { recursive: true });
      git(at, "init", "-q", "-b", "main");
      onCrate(at, "img");
      if (onServer)
        git(at, "remote", "add", "server", `core@localhost:git/${name}.git`);
      git(at, "add", "-A");
      git(at, "commit", "-q", "-m", "main");
      return at;
    };
    const kinetic = clone("kinetic", true);
    const repo = clone("repo", true);
    clone("loose", false);
    mkdirSync(join(kinetic, "_well"));
    writeFileSync(join(kinetic, "_well", "fx.md"), issueNote);
    writeFileSync(join(kinetic, "_well", "fx-a.md"), clNote);
    git(kinetic, "add", "-A");
    git(kinetic, "commit", "-q", "-m", "the spec");
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
    expect(compose({ home }).ledger.item("fx")).toMatchObject({
      repo,
      repos: [],
    });
  });
});
