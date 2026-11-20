import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Desk, work } from "./work.ts";

const git = (at: string, ...args: string[]) =>
  execFileSync("git", ["-C", at, ...args], { encoding: "utf8" });

let d: Desk;
let calls: string;
let path: string | undefined;

// A repo on crate as the factory's clone has it: a bare `server` with main, and its clone under the repos.
beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "work-"));
  const bare = join(root, "server", "app.git");
  mkdirSync(bare, { recursive: true });
  git(bare, "init", "-q", "--bare", "-b", "main");
  const seed = join(root, "seed");
  execFileSync("git", ["clone", "-q", bare, seed]);
  git(seed, "config", "user.email", "op@example.test");
  git(seed, "config", "user.name", "op");
  writeFileSync(join(seed, "a.txt"), "one\ntwo\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "init");
  git(seed, "push", "-q", "origin", "HEAD:main");
  const repos = join(root, "repos");
  execFileSync("git", [
    "clone",
    "-q",
    "-o",
    "server",
    bare,
    join(repos, "app"),
  ]);
  d = { repos, worktrees: join(root, "home", "worktrees") };
  // crate, stubbed: it records each call and passes
  const bin = join(root, "bin");
  mkdirSync(bin);
  calls = join(root, "crate-calls");
  writeFileSync(join(bin, "crate"), `#!/bin/sh\necho "$@" >> ${calls}\n`);
  chmodSync(join(bin, "crate"), 0o755);
  path = process.env["PATH"];
  process.env["PATH"] = `${bin}:${path}`;
  process.env["GIT_AUTHOR_NAME"] = "op";
  process.env["GIT_AUTHOR_EMAIL"] = "op@example.test";
  process.env["GIT_COMMITTER_NAME"] = "op";
  process.env["GIT_COMMITTER_EMAIL"] = "op@example.test";
});

afterEach(() => {
  process.env["PATH"] = path;
});

const run = (verb: string, args: string[], stdin = "") =>
  work(d, verb, args, async () => stdin);

describe("work through the door", () => {
  it("makes a worktree off main on its own branch, and lists it", async () => {
    expect((await run("worktree", ["app", "fix-a"])).code).toBe(0);
    const at = join(d.worktrees, "fix-a");
    expect(readFileSync(join(at, "a.txt"), "utf8")).toBe("one\ntwo\n");
    expect(git(at, "branch", "--show-current").trim()).toBe("fix-a");
    expect((await run("worktrees", [])).out).toBe("fix-a app fix-a");
    expect((await run("worktree", ["app", "fix-a"])).code).toBe(1);
    expect((await run("worktree", ["nope", "x"])).err).toContain("no repo");
  });

  it("reads, writes and edits a file, and an edit's old text must occur once", async () => {
    await run("worktree", ["app", "w"]);
    expect((await run("read", ["w", "a.txt"])).out).toBe("one\ntwo\n");
    expect((await run("write", ["w", "src/b.txt"], "bee\n")).code).toBe(0);
    expect((await run("read", ["w", "src/b.txt"])).out).toBe("bee\n");
    const edit = (old: string, now: string) =>
      run("edit", ["w", "a.txt"], JSON.stringify({ old, new: now }));
    expect((await edit("two", "2")).code).toBe(0);
    expect((await run("read", ["w", "a.txt"])).out).toBe("one\n2\n");
    expect((await edit("absent", "x")).err).toContain("0 times");
    await run("write", ["w", "a.txt"], "x x\n");
    expect((await edit("x", "y")).err).toContain("2 times");
    expect((await run("edit", ["w", "a.txt"], "not json")).code).toBe(1);
  });

  it("keeps every path inside the worktree and out of its .git", async () => {
    await run("worktree", ["app", "w"]);
    for (const p of ["../x", "/etc/passwd", ".git/config", "."])
      expect((await run("read", ["w", p])).code).toBe(1);
    expect((await run("write", ["w", "../../escape"], "x")).code).toBe(1);
    expect(existsSync(join(d.worktrees, "..", "escape"))).toBe(false);
    expect((await run("read", ["nope", "a.txt"])).err).toContain("no worktree");
  });

  it("searches tracked files and shows the change against main, new files with it", async () => {
    await run("worktree", ["app", "w"]);
    expect((await run("search", ["w", "two"])).out).toBe("a.txt:2:two\n");
    expect((await run("search", ["w", "absent"])).out).toBe("");
    await run("write", ["w", "new.txt"], "fresh\n");
    const diff = (await run("diff", ["w"])).out;
    expect(diff).toContain("new.txt");
    expect(diff).toContain("+fresh");
  });

  it("runs a command and the check in the worktree's workspace, brought up as an attempt's", async () => {
    await run("worktree", ["app", "w"]);
    const at = join(d.worktrees, "w");
    expect((await run("run", ["w", "npm", "test"])).code).toBe(0);
    expect((await run("check", ["w"])).code).toBe(0);
    expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual([
      `-C ${at} up --attempt`,
      `-C ${at} run -- npm test`,
      `-C ${at} up --attempt`,
      `-C ${at} run -- scripts/check.sh all`,
    ]);
  });

  it("commits every change with the message on stdin, and lands through crate", async () => {
    await run("worktree", ["app", "w"]);
    const at = join(d.worktrees, "w");
    expect((await run("commit", ["w"], "feat: b\n")).err).toBe(
      "nothing to commit",
    );
    await run("write", ["w", "b.txt"], "bee\n");
    expect((await run("commit", ["w"], "")).code).toBe(1);
    expect((await run("commit", ["w"], "feat: b\n")).code).toBe(0);
    expect(git(at, "log", "-1", "--format=%s").trim()).toBe("feat: b");
    expect((await run("land", ["w"])).code).toBe(0);
    expect(readFileSync(calls, "utf8")).toContain(`-C ${at} land`);
  });

  it("closes a worktree: its workspace down, the worktree and its branch gone", async () => {
    await run("worktree", ["app", "w"]);
    expect((await run("close", ["w"])).code).toBe(0);
    expect(existsSync(join(d.worktrees, "w"))).toBe(false);
    expect(git(join(d.repos, "app"), "branch", "--list", "w").trim()).toBe("");
    expect(readFileSync(calls, "utf8")).toContain("down");
  });
});
