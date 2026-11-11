/**
 * The orchestrator's own moves: the ones no agent makes, decided by code from the ledger, each tick. Each goes through
 * the ledger's one door (apply), as the orchestrator.
 * - an issue just building: its cls go into the ledger, from its spec, each with its phase. A spec the factory's
 *   planner made is written as notes first, the plan note and a cl note per cut; one Matt made is his notes already
 * - a phase starts once every cl of the phases before it has landed on main, and all its cls start together. A cl
 *   whose repo depends on a package a landed cl made waits until that version is on npm, with why as its last message;
 *   a wait past its limit escalates the issue
 * - an issue whose cls have all landed is built, and its acceptance starts
 * - a cl that raised relays its message to its issue: findings about the cl or the plan send it to the planner, and
 *   about the issue to Matt; its cls not landed are dropped. A cl escalated escalates its issue. An issue whose spec
 *   Matt made goes to Matt instead of the planner, on a raise or a send-back, escalated
 */

import {
  clFields,
  clNote,
  clPath,
  type PlanSpec,
  planNote,
  planPath,
  type Spec,
  specOf,
} from "../process/plan.ts";
import type { Message } from "../process/step.ts";
import type { Item, Ledger } from "./ledger.ts";
import { writeNote } from "../effects/notes.ts";
import type { Reader } from "../effects/repo.ts";
import type { Registry } from "../effects/registry.ts";
import { top } from "../process/table.ts";

const link = (name: string) => `[[${name}]]`;

/** A message from the orchestrator, with no findings unless it relays some. */
const say = (
  word: Message["word"],
  reason: string,
  findings: Message["findings"] = [],
): Message => ({ word, reason, findings });

/** Writes a spec the factory's planner made as kinetic's notes: the plan note, when it has a plan, and a cl note per cut. */
function writeNotes(ledger: Ledger, issue: Item, s: Spec) {
  // A cl in the ledger already has its note: a build a stop cut off leaves it as it is.
  const had = new Set(ledger.cls(issue.name).map((c) => c.name));
  if (s.plan)
    writeNote(
      planPath(issue.path, issue.name),
      {
        type: "plan",
        description: `The plan of ${issue.name}: why its cls are cut and ordered as they are. Read to see how ${issue.name} is cut.`,
        belongsTo: link(issue.name),
        status: "active",
      },
      planNote(issue.name, s as Spec & { plan: PlanSpec }),
      true,
    );
  for (const c of s.cls.filter((x) => !had.has(`${issue.name}-${x.name}`)))
    writeNote(
      clPath(issue.path, issue.name, c.name),
      clFields(issue.name, c, Boolean(s.plan)),
      clNote(c),
      true,
    );
}

/**
 * Puts a spec's cls in the ledger, at their notes beside the issue's, after every cl of the plans before it, each with
 * its phase, and its repo with that repo's image and setup: phase 1 ready, the rest waiting. A cl the ledger has
 * already is left as it is.
 */
function addCls(ledger: Ledger, issue: Item, s: Spec) {
  const names = new Set(s.cls.map((c) => `${issue.name}-${c.name}`));
  const had = ledger.cls(issue.name);
  // This spec's cls come after every cl of the plans before it.
  const seq = Math.max(
    0,
    ...had.filter((c) => !names.has(c.name)).map((c) => c.seq),
  );
  s.cls.forEach((c, i) => {
    const name = `${issue.name}-${c.name}`;
    if (had.some((h) => h.name === name)) return;
    const phase = c.phase ?? 1;
    // Its repo: the one it names, of the issue's several, or the issue's one. The spec lint holds that it is there.
    const at = issue.repos.find((p) => p.name === c.repo) ?? issue;
    ledger.addCl(
      {
        name,
        issue: issue.name,
        seq: seq + i + 1,
        phase,
        path: clPath(issue.path, issue.name, c.name),
        repo: at.repo,
        image: at.image,
        test: c.test,
        setup: at.setup,
      },
      phase === 1 ? "ready" : "waiting",
    );
  });
}

/** Builds an issue from its spec: its notes when the factory made it, then its cls. It can run again after a stop. */
function build(ledger: Ledger, issue: Item, s: Spec, by: string) {
  if (by === "factory") writeNotes(ledger, issue, s);
  addCls(ledger, issue, s);
}

const live = (c: Item) => c.state !== "dropped" && c.state !== "raised";

/**
 * Makes one item's move. A move that fails (a spec the ledger lacks) escalates the item, with
 * why: the factory cannot fix it, and the other items go on.
 */
async function guarded(ledger: Ledger, item: Item, move: () => unknown) {
  try {
    await move();
  } catch (e) {
    ledger.apply(
      item.name,
      say(
        "escalate",
        `the orchestrator's move failed: ${(e as Error).message.slice(0, 400)}`,
      ),
      "orchestrator",
    );
  }
}

/** What a waiting cl needs to know of the world: its repos' files, the tags a land put on main, and the registry. */
export interface World {
  registry: Registry;
  reader: Reader;
  /** The version tags the land target holds on the commit main took for the landed cl `cl`, of `repo`. */
  tags(repo: string, cl: string): Promise<string[]>;
  /** The longest a cl waits for a version, counted from the land that made it: 30 minutes when not set. */
  limitMs?: number;
}

/** The wait limit when the factory sets none. */
const defaultLimitMs = 30 * 60_000;

/** Why a cl still waits for a version, and what it waits for: its package and version, and when the land made it. */
interface Hold {
  reason: string;
  package?: string;
  version?: string;
  since?: number;
}

/** A version tag crate puts on a commit: `v<version>` for the package at `.`, `<folder>-v<version>` for one in a folder. */
const versionTag = /^(?:(.+)-)?v(\d+\.\d+\.\d+\S*)$/;

/** The package names a repo's `package.json` depends on, runtime or dev. */
function dependsOn(reader: Reader, repo: string): Set<string> {
  const json = reader.file(repo, "package.json");
  if (json === undefined) return new Set();
  const p = JSON.parse(json) as Record<string, Record<string, string>>;
  return new Set([
    ...Object.keys(p.dependencies ?? {}),
    ...Object.keys(p.devDependencies ?? {}),
  ]);
}

/**
 * Why a waiting cl cannot start yet: a package its repo depends on, made by a landed cl of its issue, has a version not
 * on npm. Undefined when nothing holds it. A landed commit with no version tag makes no wait.
 */
async function unpublished(
  ledger: Ledger,
  cl: Item,
  world: World,
): Promise<Hold | undefined> {
  const needs = dependsOn(world.reader, cl.repo);
  if (!needs.size) return undefined;
  for (const landed of ledger.cls(cl.issue)) {
    if (landed.state !== "landed" || landed.repo === cl.repo) continue;
    for (const tag of await world.tags(landed.repo, landed.name)) {
      const [, folder, version] = versionTag.exec(tag) ?? [];
      if (!version) continue;
      const json = world.reader.file(
        landed.repo,
        folder ? `${folder}/package.json` : "package.json",
      );
      if (json === undefined) continue;
      const name = (JSON.parse(json) as { name?: string }).name;
      if (!name || !needs.has(name)) continue;
      if (!(await world.registry.published(name, version))) {
        const land = ledger
          .events(landed.name)
          .findLast((e) => e.to_state === "landed");
        return {
          reason: `${name}@${version}, made by ${landed.name}, is not on npm yet`,
          package: name,
          version,
          ...(land ? { since: Date.parse(land.at) } : {}),
        };
      }
    }
  }
  return undefined;
}

/**
 * Keeps a waiting cl waiting, with why. The reason is written when it differs from the last one written, so many ticks
 * for one reason leave one message. A wait past its limit escalates the cl's issue, once.
 */
function hold(ledger: Ledger, cl: Item, h: Hold, world: World) {
  const last = ledger.events(cl.name).findLast((e) => e.word === "retry");
  if (last?.reason !== h.reason)
    ledger.apply(cl.name, say("retry", h.reason), "orchestrator");
  if (h.since === undefined) return;
  const waited = Date.now() - h.since;
  if (waited <= (world.limitMs ?? defaultLimitMs)) return;
  if (ledger.item(cl.issue).state === "escalated") return;
  ledger.apply(
    cl.issue,
    say(
      "escalate",
      `${cl.name} waits for ${h.package}@${h.version} to be on npm: ${Math.floor(waited / 60_000)} min, past its limit`,
    ),
    "orchestrator",
  );
}

export async function advance(ledger: Ledger, world?: World) {
  for (const issue of ledger.inState("building"))
    await guarded(ledger, issue, () => {
      const made = specOf(ledger, issue.name);
      if (!made)
        throw new Error(`issue ${issue.name} is building with no spec`);
      const cls = ledger.cls(issue.name);
      const added = made.spec.cls.every((c) =>
        cls.some((i) => i.name === `${issue.name}-${c.name}`),
      );
      if (!added) build(ledger, issue, made.spec, made.by);
      // Built once every cl has landed or is dropped: a raised one is still the plan's, until its raise is handled.
      else if (!cls.some((c) => c.state !== "landed" && c.state !== "dropped"))
        ledger.apply(
          issue.name,
          say("pass", "its cls have all landed"),
          "orchestrator",
        );
    });

  // A phase starts once every live cl of the phases before it has landed.
  for (const cl of ledger.inState("waiting")) {
    const before = ledger
      .cls(cl.issue)
      .filter(
        (c) =>
          live(c) && (c.phase ?? 1) < (cl.phase ?? 1) && c.state !== "landed",
      );
    if (before.length) continue;
    // A failed ask is a reason too: the cl waits and the others go on.
    const held =
      world &&
      (await unpublished(ledger, cl, world).catch((e: Error): Hold => ({
        reason: e.message.slice(0, 400),
      })));
    if (held && world) hold(ledger, cl, held, world);
    else
      ledger.apply(
        cl.name,
        say(
          "pass",
          `phase ${cl.phase ?? 1} starts: the phases before it have landed`,
        ),
        "orchestrator",
      );
  }

  for (const cl of ledger.inState("raised")) {
    const issue = ledger.item(cl.issue);
    if (issue.state !== "building") continue;
    // The message that raised the cl, relayed to its issue as it is.
    const back = ledger.events(cl.name).at(-1)?.findings ?? [];
    // A spec Matt made is Matt's to answer: the issue is escalated to him, with its cls as they are.
    if (specOf(ledger, issue.name)?.by === "matt") {
      ledger.apply(
        issue.name,
        say(
          "escalate",
          `${cl.name} raised, and Matt made its spec: Matt answers it`,
          back,
        ),
        "orchestrator",
      );
      continue;
    }
    const rest = ledger
      .cls(issue.name)
      .filter((c) => c.name !== cl.name && live(c) && c.state !== "landed");
    // The raising cl is dropped with the rest: its raise is the issue's now, so it is handed over once. The issue itself
    // is Matt's; a cl or the plan is the planner's, by the table.
    ledger.transaction(() => {
      for (const c of [cl, ...rest]) {
        ledger.apply(
          c.name,
          say(
            "drop",
            c === cl
              ? "its raise goes to the issue"
              : `${cl.name} raised: its plan goes back`,
          ),
          "orchestrator",
        );
      }
      ledger.apply(
        issue.name,
        say(
          "back",
          `${cl.name} raised: ${top(back.map((f) => f.about)) === "issue" ? "the issue goes to Matt" : "back to the planner"}`,
          back,
        ),
        "orchestrator",
      );
    });
  }

  for (const cl of ledger.inState("escalated").filter((c) => c.kind === "cl")) {
    const issue = ledger.item(cl.issue);
    if (issue.state === "building")
      ledger.apply(
        issue.name,
        say("escalate", `${cl.name} is escalated`),
        "orchestrator",
      );
  }

  // An issue sent back to the planner whose spec Matt made goes to Matt, who made it.
  for (const issue of ledger.inState("open"))
    if (specOf(ledger, issue.name)?.by === "matt")
      ledger.apply(
        issue.name,
        say(
          "escalate",
          "sent back to its spec, which Matt made: Matt replans it",
        ),
        "orchestrator",
      );
}
