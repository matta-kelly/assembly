# assembly

The software factory: a deployment of que-pasa (`@mku1tra/que-pasa`) that moves an issue through its plan and its cls, one cl at a time, to accepted. How it works as a system, and what is built: `assembly.md`.

## Parts

- `process/`, `agents/`: what the work is, the states, steps and agents. Unit tests, beside each file
- `orchestrator/`: the engine, the loop, the orchestrator's own moves and the ledger. Unit tests, with git and podman faked; the end-to-end test, `loop.e2e.test.ts`
- `effects/`: how it touches the world, git, the sandbox, test runs, the runner, notes, traces and the agents' tools. Unit tests, with the sandbox faked
- `main.ts`: the wiring. Unit tests
- `cli/`: the factory's command line, one module per command. Unit tests

## Run and check

Node runs in a pinned image, never on the host. You need `just` and `podman`, and the podman socket for the e2e and a run.

- `just check`: the check set, `scripts/check.sh`: notes, then types, lint, format and the unit tests. The pre-push hook and the pipeline run the same file
- `just e2e`: the whole loop on scripted models, with real sandboxes, through the host's podman socket. Not in the check set, since the pipeline has no podman socket
- `just factory <verb>`: the factory itself, in its own image: `add` a note by its type (an issue, for the factory's planner; a plan or a lone cl made outside it, whose cls go straight to the inner loop), `run`, `status`, `blocked`, `explain`
- `just smoke-model`: one real call per model the bins name. The key comes from the vault (`secrets.toml`, through rbw-run)
- `just run <command>`: a command in the Node image, such as `just run npm install zod`

## Ship

Nothing is published or deployed: the factory runs on this machine. A change lands on main through `git land`.
