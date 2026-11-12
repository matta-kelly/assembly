/**
 * assembly: the software factory's schema, on basis. It defines no types of its own: its agents' notes are of it's type
 * role, and the issue, plan and cl it runs are of work, the package of the work's types in work/, which other graphs
 * install from npm and assembly imports from its source. The work itself is in the graphs that import work: assembly
 * reads those notes by path, and holds none. It imports it for the root note's type and the role.
 */

import { defineSchema } from "@mku1tra/basis";
import it from "@mku1tra/it";
import work from "./work/src/schema.ts";

export default defineSchema({
  name: "assembly",
  description:
    "The software factory: its notes, its agents' roles among them, on the types of it and of work.",
  types: {},
  imports: [it, work],
  notes: new URL("./", import.meta.url),
  // The README is for GitHub, with no frontmatter: not a note.
  skip: (path) => path === "README.md",
  exports: () => import("./schema.ts"),
});
