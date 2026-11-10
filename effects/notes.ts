/**
 * The notes: read by path, and written only as the orchestrator's own (a new plan or cl note, and a note's status).
 * Agents never write a note, and no finding is written into one: findings are messages, in the ledger.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

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

/** A note's frontmatter field, as is: a link's name for a link. Empty when it has none. */
export const field = (doc: string, key: string) => {
  const front = /^---\n([\s\S]*?)\n---/.exec(doc)?.[1] ?? "";
  const v = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(front)?.[1]?.trim() ?? "";
  return /^"?\[\[([^\]|#]+)/.exec(v)?.[1] ?? v.replace(/^"(.*)"$/, "$1");
};

/** Sets a note's frontmatter status. */
export function setStatus(path: string, status: string) {
  const doc = readFileSync(path, "utf8");
  writeFileSync(
    path,
    doc.replace(/^(---\n[\s\S]*?^status: ).*$/m, `$1${status}`),
  );
}

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

/** A note's text, or "" when it is not there. */
export const read = (path: string) =>
  existsSync(path) ? readFileSync(path, "utf8") : "";
