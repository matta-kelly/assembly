/**
 * The notes: the only spec, read with git from a commit of the notes repo's main (kinetic), never from a working tree,
 * and written only as the orchestrator's own (a plan and its cl notes, which the issue's land commits). Agents never
 * write a note, and no finding is written into one: findings are messages, in the ledger.
 */

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import type { NotesAt } from "../line/step.ts";

/** The text of `## <heading>` in a note's text, or "" when it has none. */
export function sectionIn(doc: string, heading: string): string {
  const s = doc.split(/^## /m).find((p) => p.startsWith(`${heading}\n`));
  return s ? s.slice(heading.length + 1) : "";
}

/** The top-level items of `## <heading>`'s list in a note's text. */
export function itemsIn(doc: string, heading: string): string[] {
  return sectionIn(doc, heading)
    .split("\n")
    .filter((line) => line.startsWith("- "));
}

/** A note's frontmatter field, as is: a link's name for a link. Empty when it has none. */
export const field = (doc: string, key: string) => {
  const front = /^---\n([\s\S]*?)\n---/.exec(doc)?.[1] ?? "";
  const v = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(front)?.[1]?.trim() ?? "";
  return /^"?\[\[([^\]|#]+)/.exec(v)?.[1] ?? v.replace(/^"(.*)"$/, "$1");
};

const git = (repo: string, args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

/** The full sha a commit or ref names in the repo, or undefined when it names no commit. */
export function commitOf(repo: string, ref: string): string | undefined {
  try {
    return git(repo, [
      "rev-parse",
      "--verify",
      "--quiet",
      `${ref}^{commit}`,
    ]).trim();
  } catch {
    return undefined;
  }
}

/** A note's text at a commit, or "" when the commit holds none. */
export function readAt(repo: string, commit: string, path: string): string {
  try {
    return git(repo, ["show", `${commit}:${path}`]);
  } catch {
    return "";
  }
}

/** Where notes are read from: the text of a note by its path, and the file names of the notes in a folder. */
export interface Notes {
  text(path: string): string;
  names(dir: string): string[];
}

/** The notes as a repo holds them at a commit: a path is the note's path in the repo. */
export const notesAt = (repo: string, commit: string): Notes => ({
  text: (path) => readAt(repo, commit, path),
  names: (dir) =>
    git(repo, ["ls-tree", "--name-only", commit, `${dir}/`])
      .split("\n")
      .filter((f) => f.endsWith(".md"))
      .map((f) => basename(f)),
});

/** The notes an attempt reads: the notes repo at the commit its run carries. */
export const notesOf = (r: { notes: NotesAt }): Notes =>
  notesAt(r.notes.repo, r.notes.commit);

/**
 * Writes a note: its frontmatter fields, then its body. A list or a mapping is written as a JSON flow value, which YAML
 * reads as the same. It writes over a note that is there only when told to.
 */
export function writeNote(
  path: string,
  fields: Record<string, string | number | object>,
  body: string,
  replace = false,
) {
  if (!replace && existsSync(path)) throw new Error(`${path} is there already`);
  const head = Object.entries(fields)
    // a string quoted when YAML would read it otherwise: a mapping or comment mark, a newline, or a leading indicator
    .map(
      ([k, v]) =>
        `${k}: ${typeof v !== "string" ? JSON.stringify(v) : /[:#[\]"\n]|^[\s\-?!&*|>%@`{}',]/.test(v) ? JSON.stringify(v) : v}`,
    )
    .join("\n");
  writeFileSync(path, `---\n${head}\n---\n${body.trim()}\n`);
}
