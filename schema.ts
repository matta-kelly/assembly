/**
 * assembly: the software factory's schema, on basis. It defines no types of its own yet. The cl a change moves
 * through is kinetic's: kinetic lints it where it lives, and assembly reads it by path when it runs. It imports it
 * for the root note's type.
 */

import { defineSchema } from "@mku1tra/basis";
import it from "@mku1tra/it";

export default defineSchema({
  name: "assembly",
  description: "The software factory. It reads the cl from kinetic.",
  types: {},
  imports: [it],
  typeNotes: new URL("./types/", import.meta.url),
  notes: new URL("./", import.meta.url),
  exports: () => import("./schema.ts"),
});
