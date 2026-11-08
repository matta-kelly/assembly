import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compose } from "../main.ts";
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

describe("the command line", () => {
  const add = (note: string, repo: string) =>
    main(
      ["add", note, "--repo", repo, "--image", "img", "--test", "npm test"],
      {
        ASSEMBLY_HOME: home,
      },
    );

  it("adds an issue by its note, named by the file", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const note = join(home, "my-issue.md");
    writeFileSync(note, "an issue\n");
    mkdirSync(join(home, "repo", ".git"), { recursive: true });
    expect(await add(note, join(home, "repo"))).toBe(0);
    expect(log).toHaveBeenCalledWith("added my-issue, open");
    expect(compose({ home }).ledger.item("my-issue")).toMatchObject({
      path: note,
      repo: join(home, "repo"),
      test: "npm test",
      state: "open",
    });
  });

  it("refuses an issue with no note, a repo that is not one, or a name it has", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const note = join(home, "is.md");
    const repo = join(home, "repo");
    expect(await add(note, repo)).toBe(1);
    expect(err).toHaveBeenLastCalledWith(`no issue note at ${note}`);
    writeFileSync(note, "an issue\n");
    expect(await add(note, repo)).toBe(1);
    expect(err).toHaveBeenLastCalledWith(`${repo} is not a git repo`);
    mkdirSync(join(repo, ".git"), { recursive: true });
    expect(await add(note, repo)).toBe(0);
    expect(await add(note, repo)).toBe(1);
    expect(err).toHaveBeenLastCalledWith("is is in the ledger already");
  });

  it("refuses a note whose name is not kebab-case, an item it does not have, and a tick that is not a time", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = { ASSEMBLY_HOME: home };
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
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/^factory add/));
  });
});
