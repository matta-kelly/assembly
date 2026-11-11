/**
 * An agent's types: the notes in workspace/types/ it works to and is judged against, always in its context. que-pasa's
 * memory middleware reads them once when a run is made, on the orchestrator, and keeps them with the run, so a run that
 * resumes has the notes it started with.
 */

import { fileURLToPath } from "node:url";
import { memory } from "@mku1tra/que-pasa/middleware";
import { local } from "@mku1tra/que-pasa/sandbox";

/** The workspace folder, which the sources are read from. */
const root = fileURLToPath(new URL("..", import.meta.url));

/** The source of a type, from the workspace folder: `tests` is `types/tests.md`. */
export const sourceOf = (name: string) => `types/${name}.md`;

/** The memory of an agent that works to these types, by name, in this order. */
export const types = (...names: string[]) =>
  memory({ backend: local({ root }), sources: names.map(sourceOf) });
