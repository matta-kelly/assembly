/**
 * assembly: the software factory's schema, on basis. It defines no types of its own: its agents' notes are of it's type
 * role, and the issue, plan and cl it runs are kinetic's, which kinetic lints where they live and assembly reads by
 * path. It imports it for the root note's type and the role.
 */

import { defineSchema } from "@mku1tra/basis";
import it from "@mku1tra/it";

export default defineSchema({
  name: "assembly",
  description:
    "The software factory: its notes, its agents' roles among them, on the types of it.",
  types: {},
  imports: [it],
  notes: new URL("./", import.meta.url),
  // The README is for GitHub, with no frontmatter: not a note.
  skip: (path) => path === "README.md",
  exports: () => import("./schema.ts"),
});
