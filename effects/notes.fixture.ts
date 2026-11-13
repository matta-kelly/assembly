/**
 * A notes repo for a test: a real git repo in a new folder, its notes committed on main, as the factory reads notes
 * only from a commit. `commit` adds or changes notes in a new commit on main and gives it back.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { NotesAt } from "../process/step.ts";

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

/** A notes repo holding `notes`, by path from its root, and a way to commit more. */
export function notesRepo(
  notes: Record<string, string>,
  at = mkdtempSync(join(tmpdir(), "notes-")),
) {
  mkdirSync(at, { recursive: true });
  git(at, "init", "-q", "-b", "main");
  const commit = (more: Record<string, string>): NotesAt => {
    for (const [path, text] of Object.entries(more)) {
      mkdirSync(dirname(join(at, path)), { recursive: true });
      writeFileSync(join(at, path), text);
    }
    git(at, "add", "-A");
    git(at, "commit", "-q", "--allow-empty", "-m", "notes");
    return { repo: at, commit: git(at, "rev-parse", "HEAD") };
  };
  return { repo: at, first: commit(notes), commit };
}
