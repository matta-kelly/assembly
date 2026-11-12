/**
 * An agent's types: the notes it works to and is judged against, always in its context. A work type (issue, plan, cl)
 * is its type note in work/types/, the definition itself; each other one is a note in workspace/types/. que-pasa's
 * memory middleware reads them once when a run is made, on the orchestrator, and keeps them with the run, so a run that
 * resumes has the notes it started with.
 */

import { readdirSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { memory } from "@mku1tra/que-pasa/middleware";
import { local } from "@mku1tra/que-pasa/sandbox";

/** The repo's root, which the sources are read from. */
const root = fileURLToPath(new URL("../..", import.meta.url));

/** The work types: each type note in work/types/, by its name. */
const workTypes = new Set(
  readdirSync(new URL("../../work/types/", import.meta.url)).map((file) =>
    basename(file, ".md"),
  ),
);

/** The source of a type, from the repo's root: `issue` is `work/types/issue.md`, `tests` is `workspace/types/tests.md`. */
export const sourceOf = (name: string) =>
  workTypes.has(name) ? `work/types/${name}.md` : `workspace/types/${name}.md`;

/** The memory of an agent that works to these types, by name, in this order. */
export const types = (...names: string[]) =>
  memory({ backend: local({ root }), sources: names.map(sourceOf) });
