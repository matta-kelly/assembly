/**
 * assembly: the software factory's schema, on basis. Its one type is instructions: what an agent is told. The cl a
 * change moves through is kinetic's: kinetic lints it where it lives, and assembly reads it by path when it runs. It
 * imports it for the root note's type.
 */

import { defineSchema, defineType } from "@mku1tra/basis";
import it from "@mku1tra/it";

/** What one of the factory's agents is told. Its agent's config names the note's path; the model reads the note. */
export const instructions = defineType({
  name: "instructions",
  description:
    "What one of the factory's agents is told: the model reads the note's one line and its sections as the agent's instructions. Its agent's config, beside it in agents/, names its path.",
  fields: {},
});

export default defineSchema({
  name: "assembly",
  description:
    "The software factory: its agents' instructions. It reads the cl from kinetic.",
  types: { instructions },
  imports: [it],
  typeNotes: new URL("./types/", import.meta.url),
  notes: new URL("./", import.meta.url),
  exports: () => import("./schema.ts"),
});
