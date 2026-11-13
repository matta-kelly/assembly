/**
 * What Matt does to the factory from the command line, each a message through the ledger's one door (apply), as Matt.
 * - submit <issue>: the issue's note, `_well/<issue>.md` at the notes' main, enters. With cl notes there that belong to
 *   it, his spec, linted as the planner's is, it enters at building; with none, at open, for the factory's planner
 * - stop <item>: his escalate. An attempt open on it finishes, and nothing new starts on it, or on an issue's cls
 * - resume <item> [<state>]: an item he holds, escalated or raised, to a station of its kind, by default where it was
 *   before, with a fresh budget. He edits the notes in between; the next attempt reads them
 * Each is checked whole before anything is written, so a refusal leaves the ledger as it was.
 */

import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Built } from "../main.ts";
import { notesNow, reconcile } from "../orchestrator/advance.ts";
import { itemsIn } from "../effects/notes.ts";
import {
  clNotesOf,
  kebab,
  noteOf,
  plannedOf,
  readSpec,
  specLint,
  typeOf,
} from "../process/plan.ts";
import { ends, held, type State, stations } from "../process/table.ts";
import type { Message } from "../process/step.ts";
import { type Reader, reposOn } from "../effects/repo.ts";

/** What a command gives back: an exit code, and the lines it prints (to stderr when it refuses). */
export type Done = { code: number; lines: string[] };

const refused = (...lines: string[]): Done => ({ code: 1, lines });
const misused = (line: string): Done => ({ code: 2, lines: [line] });
const said = (word: Message["word"], reason: string): Message => ({
  word,
  reason,
  findings: [],
});

/**
 * What submit is given: the repos the issue may change, each by its path, or none, for every repo on crate under
 * `root`, among which its planner picks; and the notes repo, which holds the issue's note and is never one of them.
 */
export interface Options {
  repos: string[];
  root?: string | undefined;
  notes: string;
  read?: Reader | undefined;
}

/** The paths of the repos an issue may change: those given, else every repo on crate under the root but the notes'. */
export function given(
  o: Options,
): { paths: string[]; done?: never } | { done: Done } {
  const notes = resolve(o.notes);
  const paths = o.repos.length
    ? o.repos.map((each) => resolve(each))
    : o.root
      ? reposOn(o.root, o.read).filter((p) => resolve(p) !== notes)
      : [];
  if (paths.length) return { paths };
  return {
    done: misused(
      o.root
        ? `no repo on crate under ${o.root}`
        : "an issue needs its repos: --repo, or a root to find every repo on crate under",
    ),
  };
}

/** The folder of the notes repo that holds the issues' notes. */
const wellDir = "_well";

/**
 * submit <issue>: the issue's note `_well/<issue>.md` at the notes' main as it is now, read with git, never from a
 * working tree. With cl notes that belong to it, the spec Matt made, it is linted as the factory's own planner's is
 * (specLint), each cl new, and enters at building, where the factory builds it from those notes. With none, it enters at
 * open, for the factory's planner.
 */
export async function submit(
  f: () => Built,
  issue: string,
  o: Options,
): Promise<Done> {
  if (!kebab.test(issue))
    return refused(`${issue}: an issue's name is kebab-case`);
  const paths = given(o);
  if (paths.done) return paths.done;
  for (const repo of paths.paths)
    if (!existsSync(join(repo, ".git")))
      return refused(`${repo} is not a git repo`);
  const names = paths.paths.map((p) => basename(p));
  const twice = names.find((n, i) => names.indexOf(n) !== i);
  if (twice)
    return refused(
      `two repos are named ${twice}: a cl names its repo by its folder`,
    );
  const { ledger } = f();
  if (ledger.items().some((i) => i.name === issue))
    return refused(`${issue} is in the ledger already`);
  let notes;
  try {
    notes = await notesNow(o.notes);
  } catch (e) {
    return refused(`the notes were not read: ${(e as Error).message}`);
  }
  const note = `${wellDir}/${issue}.md`;
  const doc = notes.text(note);
  if (!doc) return refused(`no note ${note} at the main of ${o.notes}`);
  if (typeOf(doc) !== "issue")
    return refused(
      `${note}: its type is ${typeOf(doc) || "not set"}: an issue is needed`,
    );
  const at = { name: issue, note, repos: paths.paths };
  if (!clNotesOf(notes, note, issue).length) {
    if (!itemsIn(noteOf(doc).body, "Done").length)
      return refused(`${note}: its Done has no items`);
    ledger.addIssue(at, "open");
    return {
      code: 0,
      lines: [`submitted ${issue}, open, in ${names.join(", ")}`],
    };
  }
  const spec = readSpec(notes, note, issue, true);
  if (!spec.ok) return refused(...spec.errors);
  const lint = specLint(spec.spec, {
    taken: (c) => ledger.items().some((i) => i.name === `${issue}-${c}`),
    repos: names,
  });
  if (lint.word !== "pass") return refused(lint.reason);
  ledger.addIssue(at, "building");
  const n = spec.spec.cls.length;
  return {
    code: 0,
    lines: [
      `submitted ${issue}, building, with ${n} ${n === 1 ? "cl" : "cls"}:`,
      ...spec.spec.cls.map(
        (c) => `  ${issue}-${c.name}  phase ${c.phase ?? 1}`,
      ),
    ],
  };
}

/** stop <item>: Matt's escalate. An attempt open on it finishes; nothing new starts on it, nor on an issue's cls. */
export function stop(f: () => Built, name: string): Done {
  const { ledger } = f();
  const i = ledger.items().find((x) => x.name === name);
  if (!i) return refused(`no item ${name} in the ledger`);
  if (ends.includes(i.state) || held.includes(i.state))
    return refused(`${name} is ${i.state}: stop takes an item that moves`);
  ledger.apply(name, said("escalate", "Matt stopped it"), "matt");
  const running = ledger.open().some((a) => a.name === name);
  return {
    code: 0,
    lines: [
      `stopped ${name}, at ${i.state}${running ? ": its open attempt finishes, and nothing new starts" : ""}`,
    ],
  };
}

/**
 * resume <item> [<state>]: an item Matt holds, escalated or raised, to `state`, a station of its kind, or by default
 * where it was before it was held. Its attempts and rounds count again from here. For an issue:
 * - to building: its cls are made to match its notes at the notes' main as it is now: a new cl note adds a cl, a cl
 *   whose note is gone and has not landed is dropped, and the rest keep their state; its held cls go back to where
 *   they were before
 * - to open: its cls not landed are dropped, and the planner plans it again, the notes at main its spec before
 * - to approved: the plan its planner made lands in the notes as it is, Matt's pass of plan review
 */
export async function resume(
  f: () => Built,
  name: string,
  state: string | undefined,
  o: { notes?: string | undefined },
): Promise<Done> {
  const { ledger } = f();
  const i = ledger.items().find((x) => x.name === name);
  if (!i) return refused(`no item ${name} in the ledger`);
  if (!held.includes(i.state))
    return refused(
      `${name} is ${i.state}: resume takes an item that is escalated or raised`,
    );
  if (ledger.open().some((a) => a.name === name))
    return refused(`${name} has an attempt open: it ends first`);
  if (state !== undefined && !stations[i.kind].includes(state as State))
    return refused(
      `${state} is no station of ${i.kind === "issue" ? "an issue" : "a cl"}: ${stations[i.kind].join(", ")}`,
    );
  const to = (state as State | undefined) ?? ledger.prior(name);
  if (!to || held.includes(to) || ends.includes(to))
    return refused(
      `${name} was ${to ?? "nowhere"} before: give the state to resume it at, one of ${stations[i.kind].join(", ")}`,
    );
  const why = said("resume", `Matt resumes it at ${to}`);
  const lines = [`resumed ${name}, at ${to}`];
  if (i.kind === "issue" && to === "approved" && !plannedOf(ledger, name))
    return refused(`${name} has no plan of its planner's to land`);
  if (i.kind === "issue" && to === "building") {
    if (!o.notes)
      return refused(
        "resume to building reads the notes repo: ASSEMBLY_NOTES, or ASSEMBLY_REPOS",
      );
    let read;
    try {
      read = readSpec(await notesNow(o.notes), i.note, name);
    } catch (e) {
      return refused(`the notes were not read: ${(e as Error).message}`);
    }
    if (!read.ok) return refused(...read.errors);
    const spec = read.spec;
    const lint = specLint(spec, {
      taken: () => false,
      repos: (i.repos.length ? i.repos : [i.repo]).map((r) => basename(r)),
    });
    if (lint.word !== "pass") return refused(lint.reason);
    ledger.transaction(() => {
      const before = new Map(ledger.cls(name).map((c) => [c.name, c.state]));
      for (const c of reconcile(ledger, i, spec, true))
        lines.push(`  ${c}  ${ledger.item(c).state}, added`);
      for (const c of ledger.cls(name)) {
        if (c.state === "dropped" && before.get(c.name) !== "dropped")
          lines.push(`  ${c.name}  dropped: its note is gone`);
        if (!held.includes(c.state)) continue;
        const prior = ledger.prior(c.name);
        if (!prior || held.includes(prior) || ends.includes(prior)) continue;
        ledger.apply(c.name, why, "matt", prior);
        lines.push(`  ${c.name}  ${prior}`);
      }
      ledger.apply(name, why, "matt", to);
    });
    return { code: 0, lines };
  }
  ledger.transaction(() => {
    if (i.kind === "issue" && to === "open")
      for (const c of ledger.cls(name).filter((x) => !ends.includes(x.state))) {
        ledger.apply(
          c.name,
          said("drop", "Matt plans its issue again"),
          "matt",
        );
        lines.push(`  ${c.name}  dropped`);
      }
    ledger.apply(name, why, "matt", to);
  });
  return { code: 0, lines };
}
