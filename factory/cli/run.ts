/** run: the factory's loop, a tick every few seconds, until a signal stops it. */

import type { Built } from "../main.ts";

/**
 * Runs the loop until SIGINT or SIGTERM. Stopping ends no attempt: the next run takes each one up. `before`, when
 * given, runs ahead of each tick: the clones kept (factory/repos/clones.ts).
 */
export async function run(
  f: Built,
  everyS: number,
  before?: () => Promise<void>,
) {
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
    if (before) await Promise.race([before(), stopped]);
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
