import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keepClones, servedBy } from "./clones.ts";

const dir = () => mkdtempSync(join(tmpdir(), "clones-"));

describe("the factory's clones", () => {
  it("reads the repos crate serves from its env file's REPOS line", () => {
    const d = dir();
    const env = join(d, "crate.env");
    writeFileSync(
      env,
      '# crate\nGIT_HOME=~/git\nREPOS="kinetic lot  assembly"\nINTAKE="refs/heads/x"\n',
    );
    expect(servedBy(env)).toEqual(["kinetic", "lot", "assembly"]);
    writeFileSync(env, "GIT_HOME=~/git\n");
    expect(servedBy(env)).toEqual([]);
  });

  it("clones each repo it has no clone of, from crate's bare repo, and leaves a clone there already", async () => {
    const root = dir();
    mkdirSync(join(root, "kinetic", ".git"), { recursive: true });
    const made: [string, string][] = [];
    const done = await keepClones(
      root,
      ["kinetic", "loke"],
      "core@localhost:git",
      async (url, into) => {
        made.push([url, into]);
      },
    );
    expect(made).toEqual([["core@localhost:git/loke.git", join(root, "loke")]]);
    expect(done).toEqual({ cloned: ["loke"], failed: [] });
  });

  it("names a repo that does not clone, and still clones the others", async () => {
    const root = dir();
    const done = await keepClones(
      root,
      ["gone", "loke", "../x"],
      "core@localhost:git",
      async (url) => {
        if (url.includes("gone")) throw new Error("no such repo\nmore");
      },
    );
    expect(done.cloned).toEqual(["loke"]);
    expect(done.failed).toEqual([
      { name: "gone", error: "no such repo" },
      { name: "../x", error: "not a repo name" },
    ]);
  });
});
