/**
 * The door: the way in from Matt's laptop. His ssh key's forced command is `factory door` in the running factory's
 * container, and ssh hands it the command he typed as SSH_ORIGINAL_COMMAND. The door runs it when it is
 * `factory <verb> [args...]` for a remote verb, and refuses anything else. The verbs are the factory's own, so the
 * list is here, beside them, and nowhere else.
 */

/** The verbs a remote caller may run: every lever and report. Never `run`, which is the server's, nor `door`. */
export const remote = [
  "submit",
  "stop",
  "resume",
  "drop",
  "status",
  "blocked",
  "explain",
  "top",
];

/**
 * Runs the command ssh was given through `main`, when it is a remote verb's. Gives back its exit code, or 1 with why on
 * stderr. Words are split on blanks, as ssh hands them over: no verb takes an argument with a space.
 */
export async function door(
  env: NodeJS.ProcessEnv,
  main: (args: string[]) => Promise<number>,
): Promise<number> {
  const [first, verb, ...rest] = (env["SSH_ORIGINAL_COMMAND"] ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (first !== "factory") {
    console.error("factory door: this key runs only: factory <verb> [args...]");
    return 1;
  }
  if (!verb || !remote.includes(verb)) {
    console.error(`factory door: the verbs here are ${remote.join(", ")}`);
    return 1;
  }
  return main([verb, ...rest]);
}
