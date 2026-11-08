# assembly's commands. Node runs in a pinned image, never on the host.

set positional-arguments

root := justfile_directory()

# lot, which holds daworks and kinetic: the factory reads issue notes and changes repos under it.
lot := parent_directory(parent_directory(root))

# List the commands
default:
    @just --list

# The check set: scripts/check.sh, in the Node image: the notes lint, then the code (types, lint, format). The pre-push hook runs it.
check:
    git -C "{{root}}" config core.hooksPath .githooks
    @just _node scripts/check.sh

# The end-to-end test: the orchestrator in its own image, starting real containers through the host's podman socket.
e2e:
    podman build -q -t localhost/assembly-orchestrator -f orchestrator/Containerfile orchestrator >/dev/null
    @just _node true
    podman run --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable -u node -e ASSEMBLY_E2E=1 -e ASSEMBLY_E2E_KEEP -v "$XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock" -v "{{root}}:{{root}}" -w "{{root}}" localhost/assembly-orchestrator npx vitest run orchestrator/loop.e2e.test.ts

# One real call per model the bins name, through que-pasa: the key, the model ids and structured output, for a fraction
# of a cent. The key comes from the vault (secrets.toml, through rbw-run) into the orchestrator's environment only.
smoke-model:
    podman build -q -t localhost/assembly-orchestrator -f orchestrator/Containerfile orchestrator >/dev/null
    @just _node true
    rbw-run -f "{{root}}/secrets.toml" -- podman run --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable -u node -e FIREWORKS_API_KEY -v "{{root}}:{{root}}" -w "{{root}}" localhost/assembly-orchestrator node scripts/smoke-model.ts

# Its home is on the host, at the same path, and so is lot, where the issue notes and the repos are. Only `run` gets
# the model key, from the vault (secrets.toml, through rbw-run).
# The factory's command line (cli/), in the orchestrator's image: `just factory status`
factory +args:
    #!/usr/bin/env bash
    set -euo pipefail
    home="${XDG_STATE_HOME:-$HOME/.local/state}/assembly"
    mkdir -p "$home"
    podman build -q -t localhost/assembly-orchestrator -f orchestrator/Containerfile orchestrator >/dev/null
    just _node true
    key=()
    [ "$1" = run ] && key=(rbw-run -f "{{root}}/secrets.toml" --)
    "${key[@]}" podman run --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable -u node -e FIREWORKS_API_KEY -e ASSEMBLY_HOME="$home" -e HOST_HOME="$HOME" -v "$XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock" -v "{{lot}}:{{lot}}" -v "$home:$home" -w "{{invocation_directory()}}" localhost/assembly-orchestrator node --disable-warning=ExperimentalWarning "{{root}}/cli/index.ts" "$@"

# Run a command in the Node image: `just run npm install zod`
run +command:
    @just _node "$@"

# The lint runs in this pinned Node image, never on the host, and installs only when the lockfile is newer.
node_image := "docker.io/library/node:22.23.4-slim"

_node +command:
    @podman run --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable --cpus=3 --cpu-shares=256 -u node -e NPM_CONFIG_UPDATE_NOTIFIER=false -v "{{root}}:{{root}}" -w "{{root}}" {{node_image}} sh -c '[ node_modules/.package-lock.json -nt package-lock.json ] || npm ci --ignore-scripts --no-audit --no-fund >/dev/null; '"$*"
