// The config of `basis lint`, from assembly's root: its schema gives its notes and its type notes.
import type { Config } from "@mku1tra/basis";
import assembly from "./schema.ts";

export default { schema: assembly } satisfies Config;
