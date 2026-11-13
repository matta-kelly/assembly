# assembly

The software factory: a deployment of que-pasa (`@mku1tra/que-pasa`) that moves an issue through its plan and its cls, each cl onto main, to accepted. How it works as a system, and what is built: `assembly.md`.

## Parts

- `process/`: what the work is, the states and steps. Unit tests, beside each file
- `workspace/`: what the agents are made of: each agent's role note and code (`agents/`), the one tool of the factory's own, `test` (`tools/`), and the notes a role works to (`types/`). Unit tests, beside each file
- `orchestrator/`: the engine, the loop, the orchestrator's own moves and the ledger. Unit tests, with git and podman faked; the end-to-end test, `loop.e2e.test.ts`
- `effects/`: how it touches the world, git, the sandbox, test runs, the runner, notes and traces. Unit tests, with the sandbox faked
- `main.ts`: the wiring. Unit tests
- `cli/`: the factory's command line, one module per command. Unit tests

## Run and check

Node runs in a pinned image, never on the host. You need `just` and `podman`, and the podman socket for the e2e and a run.

- `just check`: the check set, `scripts/check.sh`: notes, then types, lint, format and the unit tests. The pre-push hook and the pipeline run the same file
- `just e2e`: the whole loop on scripted models, with real sandboxes, through the host's podman socket. Not in the check set, since the pipeline has no podman socket
- `just factory <verb>`: the factory itself, in its own image. `submit <issue> [--repo <path>]...` takes an issue by its name, its note read at the main of the notes repo (`ASSEMBLY_NOTES`, else kinetic among the clones): with Matt's cl notes it enters at building, without them at open, for the factory's planner. It runs over every repo on crate unless `--repo` narrows it; each attempt reads its repo's image, suite and setup from its worktree, a dev image made by crate from the host's install, mounted read-only. `stop <item>` holds an item; `resume <item> [<state>]` sends it back to a station once its notes are fixed; `drop <item>` lets it go, its record kept. Then `run`, `status`, `blocked`, `explain`, `top` (the factory live)
- `just smoke-model`: one real call per model the bins name. The key comes from the vault (`secrets.toml`, through rbw-run)
- `just run <command>`: a command in the Node image, such as `just run npm install zod`

## Ship

Nothing is deployed: crate tags each move of main whose commits ask one (`v<x.y.z>`), and that tag is the release. A server checks the tag out under its home, with its repos cloned beside it, and runs the factory there. From this machine, `ASSEMBLY_SERVER=assembly@monkeybusiness just factory <verb>` runs the verb on the server over SSH. A change lands on main through `git land`.
