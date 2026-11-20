/**
 * A commit's title, in the form crate reads to decide a release (Conventional Commits): `<type>(<cl>): <what>`. The
 * type is the cl's, from its issue's kind, and every commit of the cl carries it, whichever step made it: `fix` for a
 * problem in what runs, `feat` for new work, `refactor` for a cleanup. So the land of a feature or a fix is a release,
 * even when one step writes all of the cl's files and another commits nothing.
 */

import { field } from "../repos/notes.ts";

/** The commit type of the cl an issue of this kind lands: crate releases a `feat` and a `fix`, and nothing else. */
export function typeOf(kind: string): "feat" | "fix" | "refactor" | "chore" {
  switch (kind) {
    case "bug":
    case "vulnerability":
      return "fix";
    case "internal-cleanup":
      return "refactor";
    case "task":
      return "chore";
    default:
      // feature, feature-request, project, epic, milestone, story, and a note with no kind: new work
      return "feat";
  }
}

/**
 * The title of a commit of the cl `name`. `what` is the cl note's description, its first sentence, else the cl's name;
 * `issueNote` and `clNote` are the notes' text.
 */
export function titleOf(
  name: string,
  issueNote: string,
  clNote: string,
): string {
  const type = typeOf(field(issueNote, "kind"));
  const described = field(clNote, "description")
    .split(/\.\s/)[0]
    ?.replace(/\.$/, "")
    .trim();
  const what = described || name;
  return `${type}(${name}): ${what.length > 72 ? `${what.slice(0, 71)}…` : what}`;
}
