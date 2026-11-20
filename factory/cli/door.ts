/**
 * The door: the way in for a caller with no shell. A caller's ssh key, or its certificate's principal, is forced to
 * `factory door --caller <name>` in the running factory's container, and ssh hands it the command typed as
 * SSH_ORIGINAL_COMMAND: `<verb> [args...]`, or `factory <verb> [args...]`. The door runs a remote verb of the factory's,
 * or a verb of work (work.ts), and refuses anything else. Each call is recorded with its caller (door.log in the
 * factory's home), never its stdin. The verbs are the factory's own, so the list is here, beside them, and nowhere else.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Desk, type Worked, work, workVerbs } from "./work.ts";

/** The verbs a remote caller may run: every lever and report. Never `run`, which is the server's, nor `door`. */
export const remote = [
  "submit",
  "stop",
  "resume",
  "drop",
  "rebase",
  "go",
  "note",
  "compact",
  "status",
  "blocked",
  "explain",
  "top",
];

/** What the door needs besides the command: who called, where work happens, stdin, and where each call is recorded. */
export interface Way {
  caller: string;
  desk?: Desk;
  input: () => Promise<string>;
  log?: string;
}

/** Writes a verb's result: its output to stdout, its failure to stderr. Gives back its code. */
const print = (w: Worked) => {
  if (w.out) process.stdout.write(w.out.endsWith("\n") ? w.out : `${w.out}\n`);
  if (w.err) process.stderr.write(w.err.endsWith("\n") ? w.err : `${w.err}\n`);
  return w.code;
};

/**
 * Runs the command ssh was given: a remote verb through `main`, a verb of work on the desk. Gives back its exit code, or
 * 1 with why on stderr. Words are split on blanks, as ssh hands them over.
 */
export async function door(
  env: NodeJS.ProcessEnv,
  main: (args: string[]) => Promise<number>,
  way: Way = { caller: "laptop", input: async () => "" },
): Promise<number> {
  let words = (env["SSH_ORIGINAL_COMMAND"] ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words[0] === "factory") words = words.slice(1);
  const [verb, ...rest] = words;
  const verbs = way.desk ? [...remote, ...workVerbs] : remote;
  if (!verb || !verbs.includes(verb)) {
    console.error(
      `factory door: this key runs only: <verb> [args...], the verbs ${verbs.join(", ")}`,
    );
    return 1;
  }
  if (way.log) {
    mkdirSync(dirname(way.log), { recursive: true });
    appendFileSync(
      way.log,
      `${JSON.stringify({ at: new Date().toISOString(), caller: way.caller, verb, args: rest })}\n`,
    );
  }
  if (remote.includes(verb)) return main([verb, ...rest]);
  return print(await work(way.desk as Desk, verb, rest, way.input));
}
