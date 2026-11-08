/**
 * The notes the orchestrator writes: a section of a note, a note's status, and a new note. Agents never write a note;
 * the orchestrator writes each one from an agent's checked result.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Puts `text` under the note's `## <heading>`, in place of what was there, or at the end when it has none. */
export function writeSection(path: string, heading: string, text: string) {
  const doc = readFileSync(path, "utf8");
  const at = doc.search(new RegExp(`^## ${heading}\\n`, "m"));
  if (at < 0) {
    writeFileSync(path, `${doc.trimEnd()}\n\n## ${heading}\n\n${text}\n`);
    return;
  }
  const body = at + `## ${heading}\n`.length;
  const rest = doc.slice(body).search(/^## /m);
  const end = rest < 0 ? doc.length : body + rest;
  writeFileSync(
    path,
    `${doc.slice(0, body)}\n${text}\n${rest < 0 ? "" : `\n${doc.slice(end)}`}`,
  );
}

/** Takes the note's `## <heading>` section out, when it has one: a raise, once it is answered. */
export function removeSection(path: string, heading: string) {
  const doc = readFileSync(path, "utf8");
  const at = doc.search(new RegExp(`^## ${heading}\\n`, "m"));
  if (at < 0) return;
  const body = at + `## ${heading}\n`.length;
  const rest = doc.slice(body).search(/^## /m);
  writeFileSync(
    path,
    `${doc.slice(0, at).trimEnd()}\n${rest < 0 ? "" : `\n${doc.slice(body + rest)}`}`,
  );
}

/** The text of a note's `## <heading>` section, or "" when it has none. */
export const section = (path: string, heading: string): string =>
  sectionIn(readFileSync(path, "utf8"), heading);

/** The top-level items of a note's `## <heading>` list. */
export const items = (path: string, heading: string): string[] =>
  itemsIn(readFileSync(path, "utf8"), heading);

/** The text of `## <heading>` in a note's text, or "" when it has none: for a note read once. */
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

/** Sets a note's frontmatter status. */
export function setStatus(path: string, status: string) {
  const doc = readFileSync(path, "utf8");
  writeFileSync(
    path,
    doc.replace(/^(---\n[\s\S]*?^status: ).*$/m, `$1${status}`),
  );
}

/** Writes a note: its frontmatter fields, then its body. It writes over a note that is there only when told to. */
export function writeNote(
  path: string,
  fields: Record<string, string>,
  body: string,
  replace = false,
) {
  if (!replace && existsSync(path)) throw new Error(`${path} is there already`);
  const head = Object.entries(fields)
    // quoted when YAML would read it otherwise: a mapping or comment mark, a newline, or a leading indicator
    .map(
      ([k, v]) =>
        `${k}: ${/[:#[\]"\n]|^[\s\-?!&*|>%@`{}',]/.test(v) ? JSON.stringify(v) : v}`,
    )
    .join("\n");
  writeFileSync(path, `---\n${head}\n---\n${body.trim()}\n`);
}

/** A note's text, or "" when it is not there. */
export const read = (path: string) =>
  existsSync(path) ? readFileSync(path, "utf8") : "";
