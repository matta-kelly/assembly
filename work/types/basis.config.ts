// The config of `basis lint work/types`: the root of work's schema, whose folder of type notes this is. assembly's
// lint reads the folder as this root, through its import of the same schema.
import type { Config } from "@mku1tra/basis";
import work from "../src/schema.ts";

export default { schema: work } satisfies Config;
