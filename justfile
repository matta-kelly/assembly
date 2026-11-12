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

# Who the factory commits and pushes as: Matt, by the host's git config, with git-land, the host's, mounted read-only.
as_matt := '-e GIT_AUTHOR_NAME="$(git config user.name)" -e GIT_AUTHOR_EMAIL="$(git config user.email)" -e GIT_COMMITTER_NAME="$(git config user.name)" -e GIT_COMMITTER_EMAIL="$(git config user.email)" -v "$HOME/.local/bin/git-land:/usr/local/bin/git-land:ro"'

# The end-to-end test: the orchestrator in its own image, starting real containers through the host's podman socket.
# crate, the host's install, is mounted where the image's PATH has it, so the orchestrator makes each dev image.
e2e:
    podman build -q -t localhost/assembly-orchestrator -f orchestrator/Containerfile orchestrator >/dev/null
    @just _node true
    podman run --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable -u node -e ASSEMBLY_E2E=1 -e ASSEMBLY_E2E_KEEP -e CRATE_ROOT="{{lot}}/daworks/crate" -v "{{lot}}/daworks/crate:{{lot}}/daworks/crate:ro" -v "$HOME/.local/share/crate:/usr/local/share/crate:ro" {{as_matt}} -v "$XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock" -v "{{root}}:{{root}}" -w "{{root}}" localhost/assembly-orchestrator npx vitest run e2e.test

# One real call per model the bins name, through que-pasa: the key, the model ids and structured output, for a fraction
# of a cent. The key comes from the vault (secrets.toml, through rbw-run) into the orchestrator's environment only.
smoke-model:
    podman build -q -t localhost/assembly-orchestrator -f orchestrator/Containerfile orchestrator >/dev/null
    @just _node true
    rbw-run -f "{{root}}/secrets.toml" -- podman run --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable -u node -e FIREWORKS_API_KEY -v "{{root}}:{{root}}" -w "{{root}}" localhost/assembly-orchestrator node scripts/smoke-model.ts

# The factory's command line (cli/), in the orchestrator's image: `just factory status`. Its body is scripts/factory.sh,
# so scripts/check.sh runs the same code where there is no `just`: ASSEMBLY_SERVER, ASSEMBLY_REPOS and ASSEMBLY_HOME
# are read there. Here, and on the server, the packages the command line imports are put in place first.
#
factory +args:
    #!/usr/bin/env bash
    set -euo pipefail
    [ -n "${ASSEMBLY_SERVER:-}" ] || just _node true
    cd "{{invocation_directory()}}"
    # run here takes its keys from the vault, into its environment: the laptop's way. The server's service fills it.
    if [ "$1" = run ] && [ -z "${ASSEMBLY_SERVER:-}" ]; then
      exec rbw-run -f "{{root}}/secrets.toml" -- "{{root}}/scripts/factory.sh" "$@"
    fi
    exec "{{root}}/scripts/factory.sh" "$@"

# Run a command in the Node image: `just run npm install zod`
run +command:
    @just _node "$@"

# The check runs in this pinned Node image, never on the host, and installs only when the lockfile is newer. It is the
# image crate.toml names, so the check here and crate's on the server run in the same image, git in it.
node_image := "docker.io/library/node@sha256:63538dfe497cc29dfafdda25ada09b46db68a3f4cc205abf1f5d6bf0913f3384"

_node +command:
    @podman run --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable --cpus=3 --cpu-shares=256 -u node -e NPM_CONFIG_UPDATE_NOTIFIER=false -v "{{root}}:{{root}}" -w "{{root}}" {{node_image}} sh -c '[ node_modules/.package-lock.json -nt package-lock.json ] || npm ci --ignore-scripts --no-audit --no-fund >/dev/null; '"$*"
