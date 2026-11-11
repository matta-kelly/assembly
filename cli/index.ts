/**
 * The factory's command line: one verb and its arguments, parsed here, run by its command (add.ts, run.ts,
 * report.ts) on the factory main.ts builds. Output goes to stdout; a refusal goes to stderr with exit 1, and a usage
 * error with exit 2 (clig.dev). The factory is opened only for a verb it has, so a usage error leaves nothing behind.
 *
 *   factory add <issue.md> [--repo <path>]...
 *   factory submit <issue.md> [--repo <path>]...
 *   factory approve <issue>
 *   factory replan <issue>
 *   factory run [--every <seconds>]
 *   factory status
 *   factory blocked
 *   factory explain <item>
 *
 * An issue may change the repos given, or, given none, every repo on crate under $ASSEMBLY_REPOS, and its planner picks.
 * Each repo's image, full suite and setup are read from its main (effects/repo.ts). A repo checked in its dev image needs
 * that image's tag, which the host puts in $ASSEMBLY_DEV_IMAGES as name=tag pairs (`just factory` does both).
 *
 * The home is $ASSEMBLY_HOME, else $XDG_STATE_HOME/assembly, else ~/.local/state/assembly.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { compose } from "../main.ts";
import { devImagesOf, gitReader, type Reader } from "../effects/repo.ts";
import { add, approve, type Done, replan, submit } from "./add.ts";
import { blocked, explain, status } from "./report.ts";
import { run } from "./run.ts";

/** Where the factory keeps everything, from the environment. */
export function homeOf(env: NodeJS.ProcessEnv = process.env): string {
  if (env["ASSEMBLY_HOME"]) return env["ASSEMBLY_HOME"];
  const state = env["XDG_STATE_HOME"] || join(homedir(), ".local", "state");
  return join(state, "assembly");
}

export const usage = `factory add <issue.md> [--repo <path>]...
factory submit <issue.md> [--repo <path>]...
factory approve <issue>
factory replan <issue>
factory run [--every <seconds>]
factory status
factory blocked
factory explain <item>`;

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
  const factory = () => compose({ home: homeOf(env) });
  switch (verb) {
    case "add":
    case "submit": {
      if (!arg) break;
      const done = (verb === "add" ? add : submit)(factory, arg, {
        repos: values.repo ?? [],
        root: env["ASSEMBLY_REPOS"],
        dev: devImagesOf(env["ASSEMBLY_DEV_IMAGES"]),
        read,
      });
      if (done.code === 2) done.lines.push(usage);
      return print(done);
    }
    case "approve":
      if (!arg) break;
      return print(approve(factory, arg));
    case "replan":
      if (!arg) break;
      return print(replan(factory, arg));
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
