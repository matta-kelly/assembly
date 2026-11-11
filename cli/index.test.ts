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
import type { Reader } from "../effects/repo.ts";
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
