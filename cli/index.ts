/**
 * The factory's command line: one verb and its arguments, parsed here, run by its command (add.ts, run.ts,
 * report.ts) on the factory main.ts builds. Output goes to stdout; a refusal goes to stderr with exit 1, and a usage
 * error with exit 2 (clig.dev). The factory is opened only for a verb it has, so a usage error leaves nothing behind.
 *
 *   factory add <issue.md> --repo <path> --image <image> --test <command>
 *   factory add <plan.md | cl.md> --image <image> --test <command>
 *   factory run [--every <seconds>]
 *   factory status
 *   factory blocked
 *   factory explain <item>
 *
 * The home is $ASSEMBLY_HOME, else $XDG_STATE_HOME/assembly, else ~/.local/state/assembly. A cl's repo written with
 * `~` is $HOST_HOME, the host user's home, else this process's.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { compose } from "../main.ts";
import { add, type Done } from "./add.ts";
import { blocked, explain, status } from "./report.ts";
import { run } from "./run.ts";

/** Where the factory keeps everything, from the environment. */
export function homeOf(env: NodeJS.ProcessEnv = process.env): string {
  if (env["ASSEMBLY_HOME"]) return env["ASSEMBLY_HOME"];
  const state = env["XDG_STATE_HOME"] || join(homedir(), ".local", "state");
  return join(state, "assembly");
}

export const usage = `factory add <issue.md> --repo <path> --image <image> --test <command>
factory add <plan.md | cl.md> --image <image> --test <command>
factory run [--every <seconds>]
factory status
factory blocked
factory explain <item>`;

const print = ({ code, lines }: Done) => {
  (code === 0 ? console.log : console.error)(lines.join("\n"));
  return code;
};

/** The command line: one verb, and its arguments. Gives back the exit code. */
export async function main(argv: string[], env = process.env): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        repo: { type: "string" },
        image: { type: "string" },
        test: { type: "string" },
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
  const factory = () => compose({ home: homeOf(env) });
  const { repo, image, test } = values;
  switch (verb) {
    case "add": {
      if (!arg || !image || !test) break;
      const done = add(factory, arg, {
        repo,
        image,
        test,
        home: env["HOST_HOME"] || homedir(),
      });
      if (done.code === 2) done.lines.push(usage);
      return print(done);
    }
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
      return print({ code: 0, lines: status(factory().ledger) });
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
