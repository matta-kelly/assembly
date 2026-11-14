/**
 * The factory's command line: one verb and its arguments, parsed here, run by its command (levers.ts, run.ts,
 * report.ts) on the factory factory/main.ts builds. Output goes to stdout; a refusal goes to stderr with exit 1, and a usage
 * error with exit 2 (clig.dev). The factory is opened only for a verb it has, so a usage error leaves nothing behind.
 *
 *   factory submit <issue> [--repo <path>]...
 *   factory stop <item>
 *   factory resume <item> [<state>]
 *   factory drop <item>
 *   factory run [--every <seconds>]
 *   factory status
 *   factory blocked
 *   factory explain <item>
 *   factory top
 *
 * An issue may change the repos given, or, given none, every repo on crate under $ASSEMBLY_REPOS, and its planner picks.
 * Its note is in the notes repo, $ASSEMBLY_NOTES, else $ASSEMBLY_REPOS/kinetic: the only spec, read at its main.
 *
 * The home is $ASSEMBLY_HOME, else $XDG_STATE_HOME/assembly, else ~/.local/state/assembly.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { compose } from "../main.ts";
import { gitReader, type Reader } from "../repos/repo.ts";
import { type Done, drop, resume, stop, submit } from "./levers.ts";
import { blocked, explain, status } from "./report.ts";
import { run } from "./run.ts";
import { top, version } from "./top.ts";

/** Where the factory keeps everything, from the environment. */
export function homeOf(env: NodeJS.ProcessEnv = process.env): string {
  if (env["ASSEMBLY_HOME"]) return env["ASSEMBLY_HOME"];
  const state = env["XDG_STATE_HOME"] || join(homedir(), ".local", "state");
  return join(state, "assembly");
}

/** The notes repo, from the environment: $ASSEMBLY_NOTES, else kinetic among the clones. Undefined when neither is set. */
export function notesOf(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env["ASSEMBLY_NOTES"]) return env["ASSEMBLY_NOTES"];
  return env["ASSEMBLY_REPOS"] && join(env["ASSEMBLY_REPOS"], "kinetic");
}

export const usage = `factory submit <issue> [--repo <path>]...
factory stop <item>
factory resume <item> [<state>]
factory drop <item>
factory run [--every <seconds>]
factory status
factory blocked
factory explain <item>
factory top`;

const print = ({ code, lines }: Done) => {
  (code === 0 ? console.log : console.error)(lines.join("\n"));
  return code;
};

/** The command line: one verb, and its arguments. Gives back the exit code. */
export async function main(
  argv: string[],
  env = process.env,
  read: Reader = gitReader,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        repo: { type: "string", multiple: true },
        every: { type: "string", default: "5" },
      },
    });
  } catch (e) {
    // an option it does not know, or one with no value: a usage error
    console.error(`${(e as Error).message}\n${usage}`);
    return 2;
  }
  const { positionals, values } = parsed;
  const [verb, arg] = positionals;
  const notes = notesOf(env);
  const factory = () =>
    compose({ home: homeOf(env), ...(notes ? { notes } : {}) });
  switch (verb) {
    case "submit": {
      if (!arg) break;
      if (!notes)
        return print({
          code: 2,
          lines: [
            "submit needs the notes repo: ASSEMBLY_NOTES, or ASSEMBLY_REPOS",
            usage,
          ],
        });
      const done = await submit(factory, arg, {
        repos: values.repo ?? [],
        root: env["ASSEMBLY_REPOS"],
        notes,
        read,
      });
      if (done.code === 2) done.lines.push(usage);
      return print(done);
    }
    case "stop":
      if (!arg) break;
      return print(stop(factory, arg));
    case "drop":
      if (!arg) break;
      return print(drop(factory, arg));
    case "resume":
      if (!arg) break;
      return print(await resume(factory, arg, positionals[2], { notes }));
    case "run": {
      const every = Number(values.every);
      if (!Number.isFinite(every) || every <= 0)
        return print({
          code: 1,
          lines: [`--every is a number of seconds above 0: ${values.every}`],
        });
      await run(factory(), every);
      return 0;
    }
    case "status":
      return print({ code: 0, lines: status(factory().ledger, version()) });
    case "top":
      await top(factory(), 2);
      return 0;
    case "blocked":
      return print({ code: 0, lines: blocked(factory().ledger) });
    case "explain": {
      if (!arg) break;
      const f = factory();
      if (!f.ledger.items().some((i) => i.name === arg))
        return print({ code: 1, lines: [`no item ${arg} in the ledger`] });
      return print({ code: 0, lines: explain(f.ledger, f.runs, arg) });
    }
  }
  console.error(usage);
  return 2;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = await main(process.argv.slice(2));
