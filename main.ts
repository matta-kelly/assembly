/**
 * The factory: the one place its parts are put together, and its command line.
 *
 * compose builds the system from its three layers: the process (the steps, and the agents they name, each put on its
 * bin here), the engine (the ledger and the loop) and the effects (the runner on the bins' models; git, the sandbox and
 * the test runs, which the loop calls). Everything the factory keeps is under one home: the ledger (ledger.db), pi's store (pi.db) and the run
 * folders (runs/). The e2e test builds through compose too, with scripted models in place of the bins'.
 *
 *   factory add <issue.md> --repo <path> --image <image> --test <command>
 *   factory run [--every <seconds>]
 *   factory status
 *   factory blocked
 *   factory explain <item>
 *
 * The home is $ASSEMBLY_HOME, else $XDG_STATE_HOME/assembly, else ~/.local/state/assembly.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Models } from "@earendil-works/pi-ai";
import { models as hostModels } from "./effects/models.ts";
import { agents } from "./agents/index.ts";
import { modelOf } from "./effects/models.ts";
import { type Agents, quePasa } from "./effects/runner.ts";
import { runOf } from "./effects/runs.ts";
import { traceFile } from "./effects/trace.ts";
import { steps as all } from "./process/index.ts";
import { kebab } from "./process/plan.ts";
import type { Step } from "./process/step.ts";
import { open, type Ledger } from "./orchestrator/ledger.ts";
import { loop } from "./orchestrator/loop.ts";

export interface Factory {
  home: string; // where the factory keeps everything
  agents?: Agents; // the agents and the model each attempt runs on: the bins' when left out
  models?: Models; // the providers those models come from: the host's when left out
  steps?: Step<{ word: "done" }>[]; // every step when left out
  concurrent?: number;
  timeoutMs?: number;
}

/** The factory's agents on their bins: each attempt runs on its bin's default, and a retry on its fallback. */
export function onBins(): Agents {
  return {
    make: Object.fromEntries(
      Object.entries(agents).map(([name, a]) => [name, a.make]),
    ),
    modelFor: (name, retry) => {
      const a = agents[name as keyof typeof agents];
      if (!a) throw new Error(`no agent ${name}`);
      return modelOf(a.bin, retry);
    },
  };
}

/** Builds the factory: its ledger now, and its loop when asked, which opens the runner and tracing. */
export function compose(f: Factory) {
  mkdirSync(f.home, { recursive: true });
  const ledger = open(join(f.home, "ledger.db"));
  const runs = join(f.home, "runs");
  return {
    ledger,
    runs,
    loop: () =>
      loop({
        ledger,
        steps: f.steps ?? all,
        runner: () =>
          quePasa(
            f.agents ?? onBins(),
            f.models ?? hostModels(),
            join(f.home, "pi.db"),
          ),
        runs,
        ...(f.concurrent !== undefined ? { concurrent: f.concurrent } : {}),
        ...(f.timeoutMs !== undefined ? { timeoutMs: f.timeoutMs } : {}),
      }),
  };
}

/** Where the factory keeps everything, from the environment. */
export function homeOf(env: NodeJS.ProcessEnv = process.env): string {
  if (env["ASSEMBLY_HOME"]) return env["ASSEMBLY_HOME"];
  const state = env["XDG_STATE_HOME"] || join(homedir(), ".local", "state");
  return join(state, "assembly");
}

const usage = `factory add <issue.md> --repo <path> --image <image> --test <command>
factory run [--every <seconds>]
factory status
factory blocked
factory explain <item>`;

const money = (n: number) => `$${n.toFixed(4)}`;

/** Each issue and its state, its cls under it, the attempts open now, and what the factory has spent. */
export function status(ledger: Ledger): string[] {
  const open = ledger.open();
  return [
    ...ledger
      .items()
      .filter((i) => i.kind === "issue")
      .flatMap((i) => [
        `${i.name}  ${i.state}`,
        ...ledger.cls(i.name).map((c) => `  ${c.name}  ${c.state}`),
      ]),
    "",
    `open attempts: ${open.length ? open.map((a) => `${a.name}/${a.n} (${a.step})`).join(", ") : "none"}`,
    `spent: ${money(ledger.spent())}`,
  ];
}

/** The items that wait for Matt: each one raised or escalated, with the reason of its last move. */
export function blocked(ledger: Ledger): string[] {
  const stuck = ledger
    .items()
    .filter((i) => i.state === "raised" || i.state === "escalated");
  if (!stuck.length) return ["nothing is blocked"];
  return stuck.map((i) => {
    const last = ledger.events(i.name).at(-1) as
      { reason: string | null; cause: string | null } | undefined;
    const cause = last?.cause ? ` [${last.cause}]` : "";
    return `${i.name}  ${i.state}${cause}: ${last?.reason ?? ""}`;
  });
}

/** An item's whole record: its moves, and each attempt with what it did, what it cost and where its trace is. */
export function explain(ledger: Ledger, runs: string, name: string): string[] {
  const item = ledger.item(name);
  const moves = ledger.events(name) as {
    n: number | null;
    from_state: string;
    word: string | null;
    to_state: string;
    at: string;
    reason: string | null;
    cause: string | null;
  }[];
  return [
    `${item.name} (${item.kind}${item.kind === "cl" ? ` of ${item.issue}` : ""})  ${item.state}`,
    `note: ${item.path}`,
    "",
    "moves:",
    ...moves.map(
      (e) =>
        `  ${e.at}  ${e.from_state} -${e.word ?? "add"}-> ${e.to_state}${e.cause ? ` [${e.cause}]` : ""}: ${e.reason ?? ""}`,
    ),
    "",
    "attempts:",
    ...ledger
      .attemptsOf(name)
      .flatMap((a) => [
        `  ${a.n}  ${a.step}  ${a.ended ? `${a.word}${a.cause ? ` [${a.cause}]` : ""}: ${a.reason ?? ""}` : "open"}${a.cost !== null ? `  ${money(a.cost)}` : ""}${a.resumed ? `  taken up ${a.resumed}x` : ""}`,
        `     trace: ${traceFile(runOf(item, a.n, runs))}`,
      ]),
  ];
}

/** Runs the loop until a signal stops it. Stopping ends no attempt: the next run takes each one up. */
async function run(f: ReturnType<typeof compose>, everyS: number) {
  const l = await f.loop();
  const stop = new AbortController();
  const stopped = new Promise<void>((r) =>
    stop.signal.addEventListener("abort", () => r(), { once: true }),
  );
  // A second signal while it closes is the same stop, not a kill: the attempts are left open either way.
  process.on("SIGINT", () => stop.abort());
  process.on("SIGTERM", () => stop.abort());
  console.log(`running, a tick every ${everyS}s; stop with ctrl-c`);
  while (!stop.signal.aborted) {
    await Promise.race([l.tick(), stopped]);
    let t: NodeJS.Timeout | undefined;
    await Promise.race([
      new Promise((r) => (t = setTimeout(r, everyS * 1000))),
      stopped,
    ]);
    clearTimeout(t);
  }
  await l.close();
  console.log(
    `stopped: ${f.ledger.open().length} attempts left open, for the next run to take up`,
  );
}

/** The command line: one verb, and its arguments. */
export async function main(argv: string[], env = process.env): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      repo: { type: "string" },
      image: { type: "string" },
      test: { type: "string" },
      every: { type: "string", default: "5" },
    },
  });
  const [verb, arg] = positionals;
  // The factory is opened only for a verb it has, so a usage error leaves nothing behind.
  const factory = () => compose({ home: homeOf(env) });
  const print = (lines: string[]) => console.log(lines.join("\n"));
  const fail = (why: string) => {
    console.error(why);
    return 1;
  };
  switch (verb) {
    case "add": {
      const { repo, image, test } = values;
      if (!arg || !repo || !image || !test) break;
      const path = resolve(arg);
      const name = basename(path, ".md");
      if (!kebab.test(name))
        return fail(`${name}: an issue's name is kebab-case, from its note`);
      if (!existsSync(path)) return fail(`no issue note at ${path}`);
      if (!existsSync(join(resolve(repo), ".git")))
        return fail(`${resolve(repo)} is not a git repo`);
      const f = factory();
      if (f.ledger.items().some((i) => i.name === name))
        return fail(`${name} is in the ledger already`);
      f.ledger.addIssue({ name, path, repo: resolve(repo), image, test });
      print([`added ${name}, open`]);
      return 0;
    }
    case "run": {
      const every = Number(values.every);
      if (!Number.isFinite(every) || every <= 0)
        return fail(`--every is a number of seconds above 0: ${values.every}`);
      await run(factory(), every);
      return 0;
    }
    case "status":
      print(status(factory().ledger));
      return 0;
    case "blocked":
      print(blocked(factory().ledger));
      return 0;
    case "explain": {
      if (!arg) break;
      const f = factory();
      if (!f.ledger.items().some((i) => i.name === arg))
        return fail(`no item ${arg} in the ledger`);
      print(explain(f.ledger, f.runs, arg));
      return 0;
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
