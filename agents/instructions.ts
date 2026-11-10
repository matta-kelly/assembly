/**
 * An agent's instructions, from its role note (it's type role), beside the agent's config, which names its path. The model gets the note's one line and its sections, without the frontmatter or the links that lead the note.
 */

import { readFileSync } from "node:fs";

/** The instructions in the note at `path`, from the agent config's folder. */
export function instructions(path: string, from: string): string {
  const note = readFileSync(new URL(path, from), "utf8");
  const body = note.replace(/^---\n[\s\S]*?\n---\n/, "");
  const [head = "", ...rest] = body.split(/^---$/m);
  const line = head.split("\n").find((l) => l.trim() !== "") ?? "";
  return `${line}\n${rest.join("---")}`.trim();
}
