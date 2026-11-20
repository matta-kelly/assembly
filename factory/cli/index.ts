/**
 * The factory's command line: one verb and its arguments, parsed here, run by its command (levers.ts, run.ts,
 * report.ts) on the factory factory/main.ts builds. Output goes to stdout; a refusal goes to stderr with exit 1, and a usage
 * error with exit 2 (clig.dev). The factory is opened only for a verb it has, so a usage error leaves nothing behind.
 *
 *   factory submit <issue> [--repo <path>]...
 *   factory stop <item>
 *   factory go <item>
 *   factory resume <item> [<state>]
 *   factory drop <item>
 *   factory rebase <cl>
 *   factory note <item> <agent>     the note's text on stdin
 *   factory compact <item> [<agent>]
 *   factory run [--every <seconds>]
 *   factory status
 *   factory blocked
 *   factory explain <item>
 *   factory top
 *   factory door [--caller <name>]
 *
 * door is the way in for a caller with no shell: its key's forced command runs it, and it runs the command ssh was given,
 * `[factory] <verb> [args...]`, for a remote verb, or, for a caller it names with --caller, a verb of work on code
 * (door.ts, work.ts). run is never one: it is the server's.
 * An issue may change the repos given, or, given none, every repo on crate under $ASSEMBLY_REPOS, and its planner picks.
 * Its note is in the notes repo, $ASSEMBLY_NOTES, else $ASSEMBLY_REPOS/kinetic: the only spec, read at its main.
 *
 * The home is $ASSEMBLY_HOME, else $XDG_STATE_HOME/assembly, else ~/.local/state/assembly. run keeps a clone of each
 * repo crate serves under $ASSEMBLY_REPOS, given $ASSEMBLY_CRATE_ENV and $ASSEMBLY_GIT (factory/repos/clones.ts).
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { compose } from "../main.ts";
import { gitReader, type Reader } from "../repos/repo.ts";
import {
  compact,
  type Done,
  drop,
  go,
  note,
  rebase,
  resume,
  stop,
  submit,
} from "./levers.ts";
import { blocked, explain, status } from "./report.ts";
import { door } from "./door.ts";
import { run } from "./run.ts";
import { keepClones, servedBy } from "../repos/clones.ts";
import { top, version } from "./top.ts";

/** Where the factory keeps everything, from the environment. */
export function homeOf(env: NodeJS.ProcessEnv = process.env): string {
  if (env["ASSEMBLY_HOME"]) return env["ASSEMBLY_HOME"];
  const state = env["XDG_STATE_HOME"] || join(homedir(), ".local", "state");
  return join(state, "assembly");
}

/**
 * The clones kept ahead of each tick: one of each repo crate serves (ASSEMBLY_CRATE_ENV, crate's env file), cloned
 * from ASSEMBLY_GIT (crate's git, `core@localhost:git`) into ASSEMBLY_REPOS. None when any of the three is not set.
 */
function clonesOf(env: NodeJS.ProcessEnv): (() => Promise<void>) | undefined {
  const root = env["ASSEMBLY_REPOS"];
  const crate = env["ASSEMBLY_CRATE_ENV"];
  const git = env["ASSEMBLY_GIT"];
  if (!root || !crate || !git) return undefined;
  return async () => {
    const { cloned, failed } = await keepClones(root, servedBy(crate), git);
    for (const name of cloned) console.log(`cloned ${name}, a repo on crate`);
    for (const f of failed)
      console.error(`${f.name} did not clone: ${f.error}`);
  };
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
factory go <item>
factory resume <item> [<state>]
factory drop <item>
factory rebase <cl>
factory note <item> <agent>   (the note's text on stdin)
factory compact <item> [<agent>]
factory run [--every <seconds>]
factory status
factory blocked
factory explain <item>
factory top`;

const print = ({ code, lines }: Done) => {
  (code === 0 ? console.log : console.error)(lines.join("\n"));
  return code;
};

/** All of stdin, as text: a note's body. A terminal with nothing piped gives nothing, not a wait. */
async function stdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** The command line: one verb, and its arguments. Gives back the exit code. */
export async function main(
  argv: string[],
  env = process.env,
  read: Reader = gitReader,
  input: () => Promise<string> = stdin,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        repo: { type: "string", multiple: true },
        every: { type: "string", default: "5" },
        caller: { type: "string" },
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
    case "note": {
      const agent = positionals[2];
      if (!arg || !agent) break;
      return print(note(factory, arg, agent, await input()));
    }
    case "compact":
      if (!arg) break;
      return print(compact(factory, arg, positionals[2]));
    case "go":
      if (!arg) break;
      return print(await go(factory, arg, { notes }));
    case "rebase":
      if (!arg) break;
      return print(await rebase(factory, arg));
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
      // run takes its two keys from its environment, and starts nothing without them
      const missing = ["FIREWORKS_API_KEY", "GH_TOKEN"].filter((k) => !env[k]);
      if (missing.length)
        return print({
          code: 2,
          lines: [
            `factory: run needs ${missing.join(" and ")} in its environment`,
          ],
        });
      await run(factory(), every, clonesOf(env));
      return 0;
    }
    case "status":
      return print({ code: 0, lines: status(factory().ledger, version()) });
    case "top":
      await top(factory(), 2);
      return 0;
    case "blocked":
      return print({ code: 0, lines: blocked(factory().ledger) });
    case "door": {
      // A caller named by its forced command works on code too, in worktrees of the clones; the laptop's old door,
      // with no caller, has the factory's verbs alone.
      const home = homeOf(env);
      const repos = env["ASSEMBLY_REPOS"];
      return door(env, (args) => main(args, env, read, input), {
        caller: values.caller ?? "laptop",
        input,
        log: join(home, "door.log"),
        ...(values.caller && repos
          ? { desk: { repos, worktrees: join(home, "worktrees") } }
          : {}),
      });
    }
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
