/** The factory's reports, each a read of the ledger: status, blocked and explain. */

import { runOf } from "../effects/runs.ts";
import { traceFile } from "../effects/trace.ts";
import type { Ledger } from "../orchestrator/ledger.ts";

const money = (n: number) => `$${n.toFixed(4)}`;

/** The version the factory runs, then each issue and its state, its cls under it, the attempts open now, and what the factory has spent. */
export function status(ledger: Ledger, version: string): string[] {
  const open = ledger.open();
  return [
    `assembly ${version}`,
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

/** How long since `at`, short: whole units elapsed, the largest that fits (`12s ago`, `4m ago`, `3h ago`, `2d ago`). */
const age = (at: string, now: number): string => {
  const s = Math.max(0, Math.floor((now - Date.parse(at)) / 1_000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};

/** The items that wait for Matt: each one raised or escalated, with the reason of its last move, and how long ago that was. */
export function blocked(ledger: Ledger): string[] {
  const stuck = ledger
    .items()
    .filter((i) => i.state === "raised" || i.state === "escalated");
  if (!stuck.length) return ["nothing is blocked"];
  const now = Date.now();
  return stuck.map((i) => {
    const last = ledger.events(i.name).at(-1) as
      { reason: string | null; cause: string | null; at: string } | undefined;
    const cause = last?.cause ? ` [${last.cause}]` : "";
    const since = last ? ` ${age(last.at, now)}` : "";
    return `${i.name}  ${i.state}${cause}: ${last?.reason ?? ""}${since}`;
  });
}

/** An item's whole record: the commit its spec was read at (a submitted issue), its messages, each with its findings, and each attempt with what it did, what it cost and where its trace is. */
export function explain(ledger: Ledger, runs: string, name: string): string[] {
  const item = ledger.item(name);
  const moves = ledger.events(name);
  const commit = item.kind === "issue" ? ledger.spec(name)?.commit : undefined;
  return [
    `${item.name} (${item.kind}${item.kind === "cl" ? ` of ${item.issue}` : ""})  ${item.state}`,
    `note: ${item.path}`,
    ...(commit ? [`spec read at commit: ${commit}`] : []),
    "",
    "messages:",
    ...moves.flatMap((e) => [
      `  ${e.at}  ${e.from_state} -${e.word ?? "move"}-> ${e.to_state}${e.cause ? ` [${e.cause}]` : ""}: ${e.reason ?? ""}`,
      ...e.findings.map((f) => `     ${f.about}: ${f.what} (${f.where})`),
      ...(e.notes ? [`     notes: ${e.notes}`] : []),
    ]),
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
