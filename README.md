# assembly

The software factory: a deployment of que-pasa (`@mku1tra/que-pasa`) that moves an issue through its plan and its cls, each cl onto main, to accepted. How it works as a system, and what is built: `assembly.md`.

## Parts

Two folders, after que-pasa's workspace layout: who the agents are, and the host that runs them on the line.

- `workspace/`: what the agents are made of: each agent's role note and code (`agents/`), the factory's own tools, `test` and `remove` (`tools/`), and the notes a role works to (`types/`)
- `factory/`: the host, the factory itself. `main.ts` wires it
  - `stations/`: each station's step: its result's shape and its check (plan, plan review, nail, hammer, review, accept)
  - `line/`: what moves the work: the states (`table.ts`), the step's contract (`step.ts`), the ledger, the loop and the orchestrator's own moves. The end-to-end test, `loop.e2e.test.ts`
  - `runs/`: what an attempt runs in: the runner, the sandbox, the models, test runs, setup and traces
  - `repos/`: git: worktrees, the land, the notes, version moves and dev images
  - `cli/`: the factory's command line, one module per command
  - `Containerfile`: the orchestrator's image
- `work/`: the work types package (`@mku1tra/work`)

Unit tests sit beside each file, with git and podman faked; the e2e tests are `*.e2e.test.ts`.

## Run and check

Node runs in a pinned image, never on the host. You need `just` and `podman`, and the podman socket for the e2e and a run.

- `just check`: the check set, `scripts/check.sh`: notes, then types, lint, format and the unit tests. The pre-push hook and the pipeline run the same file
- `just e2e`: the whole loop on scripted models, with real sandboxes, through the host's podman socket. Not in the check set, since the pipeline has no podman socket
- `just factory <verb>`: the factory itself, on the server, through its door (`factory door`). `submit <issue> [--repo <path>]...` takes an issue by its name, its note read at the main of the notes repo (`ASSEMBLY_NOTES`, else kinetic among the clones): with Matt's cl notes it enters at building, without them at open, for the factory's planner. It runs over every repo on crate unless `--repo` narrows it; each attempt reads its repo's image, suite and setup from its worktree, a dev image made by crate from the host's install, mounted read-only. `stop <item>` holds an item; `resume <item> [<state>]` sends it back to a station once its notes are fixed; `drop <item>` lets it go, its record kept. Then `run`, `status`, `blocked`, `explain`, `top` (the factory live)
- `just smoke-model`: one real call per model the bins name. The key comes from the vault (`secrets.toml`, through rbw-run)
- `just run <command>`: a command in the Node image, such as `just run npm install zod`

## Ship

crate tags each move of main whose commits ask one (`v<x.y.z>`), and that tag is the release. The server builds the factory's image (`factory/Containerfile`, `just image` here) from its clone at the tag and runs it as a Quadlet, declared in dazoo. From this machine, `just factory <verb>` runs the verb on the server over SSH. A change lands on main through `git land`.
