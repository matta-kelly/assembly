# assembly's commands. Node runs in a pinned image, never on the host.

set positional-arguments

root := justfile_directory()

# daworks, which holds assembly and que-pasa: mounted at its host path, so the file: dependency on ../que-pasa resolves
# when packages are installed. Only on this machine: CI breaks until que-pasa is published.
daworks := parent_directory(root)

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
    podman run --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable -u node -e ASSEMBLY_E2E=1 -e ASSEMBLY_E2E_KEEP -v "$XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock" -v "{{daworks}}:{{daworks}}" -w "{{root}}" localhost/assembly-orchestrator npx vitest run orchestrator/loop.e2e.test.ts

# One real call per model the bins name, through que-pasa: the key, the model ids and structured output, for a fraction
# of a cent. The key comes from the vault (secrets.toml, through rbw-run) into the orchestrator's environment only.
smoke-model:
    podman build -q -t localhost/assembly-orchestrator -f orchestrator/Containerfile orchestrator >/dev/null
    @just _node true
    rbw-run -f "{{root}}/secrets.toml" -- podman run --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable -u node -e FIREWORKS_API_KEY -v "{{daworks}}:{{daworks}}" -w "{{root}}" localhost/assembly-orchestrator node scripts/smoke-model.ts

# Take que-pasa as it is now: build it in its dev container, then copy it in again. npm keeps the copy it has while
# que-pasa's version is the same, so the old copy goes first.
que-pasa:
    cd "{{daworks}}/que-pasa" && just up >/dev/null && podman exec -u node -w "{{daworks}}/que-pasa" "$(just _container)" npm run build
    rm -rf "{{root}}/node_modules/que-pasa"
    @just _node npx -y npm@11.21.0 install --no-audit --no-fund

# Run a command in the Node image: `just run npm install zod`
run +command:
    @just _node "$@"

# The lint runs in this pinned Node image, never on the host, and installs only when the lockfile is newer.
node_image := "docker.io/library/node:22.23.4-slim"

_node +command:
    @podman run --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable --cpus=3 --cpu-shares=256 -u node -e NPM_CONFIG_UPDATE_NOTIFIER=false -v "{{daworks}}:{{daworks}}" -w "{{root}}" {{node_image}} sh -c '[ node_modules/.package-lock.json -nt package-lock.json ] || npm ci --ignore-scripts --no-audit --no-fund >/dev/null; '"$*"
