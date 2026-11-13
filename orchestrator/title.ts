/**
 * A commit's title, in the form crate reads to decide a release (Conventional Commits): `<type>(<cl>): <what>`. The
 * tests commit is `test`, which asks no version. The code commit takes its type from the issue's kind: `fix` for a
 * problem in what runs, `feat` for new work, `refactor` for a cleanup, so the land of a feature or a fix is a release.
 */

import { field } from "../effects/notes.ts";

/** The commit type of the code an issue of this kind lands: crate releases a `feat` and a `fix`, and nothing else. */
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
 * The title of the commit `agent` makes for the cl `name`: da-nail's is its tests, any other's is its code. `what` is
 * the cl note's description, its first sentence, else the cl's name; `issueNote` and `clNote` are the notes' text.
 */
export function titleOf(
  agent: string,
  name: string,
  issueNote: string,
  clNote: string,
): string {
  const type = agent === "da-nail" ? "test" : typeOf(field(issueNote, "kind"));
  const described = field(clNote, "description")
    .split(/\.\s/)[0]
    ?.replace(/\.$/, "")
    .trim();
  const what = described || name;
  return `${type}(${name}): ${what.length > 72 ? `${what.slice(0, 71)}…` : what}`;
}
