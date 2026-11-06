# assembly's commands. Node runs in a pinned image, never on the host.

set positional-arguments

root := justfile_directory()

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
    podman run --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable -u node -e ASSEMBLY_E2E=1 -v "$XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock" -v "{{root}}:{{root}}" -w "{{root}}" localhost/assembly-orchestrator npx vitest run orchestrator/loop.e2e.test.ts

# Run a command in the Node image: `just run npm install zod`
run +command:
    @just _node "$@"

# The lint runs in this pinned Node image, never on the host, and installs only when the lockfile is newer.
node_image := "docker.io/library/node:22.23.4-slim"

_node +command:
    @podman run --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable --cpus=3 --cpu-shares=256 -u node -e NPM_CONFIG_UPDATE_NOTIFIER=false -v "{{root}}:{{root}}" -w "{{root}}" {{node_image}} sh -c '[ node_modules/.package-lock.json -nt package-lock.json ] || npm ci --ignore-scripts --no-audit --no-fund >/dev/null; '"$*"
