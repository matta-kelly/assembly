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

# Who the e2e commits and pushes as: Matt, by the host's git config, with git-land, the host's, mounted read-only, for
# the land to a repo not on crate.
as_matt := '-e GIT_AUTHOR_NAME="$(git config user.name)" -e GIT_AUTHOR_EMAIL="$(git config user.email)" -e GIT_COMMITTER_NAME="$(git config user.name)" -e GIT_COMMITTER_EMAIL="$(git config user.email)" -v "$HOME/.local/bin/git-land:/usr/local/bin/git-land:ro"'

# The factory's image, the one the server runs (factory/Containerfile), built from this checkout.
image:
    podman build -q -t localhost/assembly:dev -f factory/Containerfile "{{root}}" >/dev/null

# The end-to-end test: the factory's image, starting real containers through the host's podman socket, on this
# checkout's code mounted over its own. crate, the host's install, is mounted where the image's PATH has it, so the
# factory makes each dev image, and a crate land target takes its hooks from it (CRATE_ROOT).
e2e: image
    @just _node true
    podman run --rm --entrypoint= --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable -u node -e ASSEMBLY_E2E=1 -e ASSEMBLY_E2E_KEEP -e CRATE_ROOT=/usr/local/share/crate -v "$HOME/.local/share/crate:/usr/local/share/crate:ro" {{as_matt}} -v "$XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock" -v "{{root}}:{{root}}" -w "{{root}}" localhost/assembly:dev npx vitest run e2e.test

# One real call per model the bins name, through que-pasa: the key, the model ids and structured output, for a fraction
# of a cent. The key comes from the vault (secrets.toml, through rbw-run) into the orchestrator's environment only.
smoke-model: image
    @just _node true
    rbw-run -f "{{root}}/secrets.toml" -- podman run --rm --entrypoint= --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable -u node -e FIREWORKS_API_KEY -v "{{root}}:{{root}}" -w "{{root}}" localhost/assembly:dev node scripts/smoke-model.ts

# The factory, on the server, through its door: `just factory status`, `just factory top`. A live screen asks for a
# terminal.
factory +args:
    ssh {{ if args =~ "^top" { "-t" } else { "" } }} assembly@monkeybusiness factory "$@"

# `factory top` on this laptop, on a copy of the server's ledger and traces, redrawn on each save of its code: to change
# top and see it at once, before it ships. The copy is taken once, read-only to the server; `fresh` takes a new one.
top-local fresh="":
    #!/usr/bin/env bash
    set -euo pipefail
    copy="${XDG_CACHE_HOME:-$HOME/.cache}/assembly-top"
    if [ -n "{{fresh}}" ] || [ ! -d "$copy/assembly" ]; then
      rm -rf "$copy" && mkdir -p "$copy"
      ssh core@monkeybusiness 'sudo tar -C /home/assembly/.local/state -cf - assembly' | tar -C "$copy" -xf -
    fi
    ASSEMBLY_HOME="$copy/assembly" exec node --watch --disable-warning=ExperimentalWarning factory/cli/index.ts top

# Run a command in the Node image: `just run npm install zod`
run +command:
    @just _node "$@"

# The check runs in this pinned Node image, never on the host, and installs only when the lockfile is newer. It is the
# image crate.toml names, so the check here and crate's on the server run in the same image, git in it.
node_image := "docker.io/library/node@sha256:63538dfe497cc29dfafdda25ada09b46db68a3f4cc205abf1f5d6bf0913f3384"

_node +command:
    @podman run --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable --cpus=3 --cpu-shares=256 -u node -e NPM_CONFIG_UPDATE_NOTIFIER=false -v "{{root}}:{{root}}" -w "{{root}}" {{node_image}} sh -c '[ node_modules/.package-lock.json -nt package-lock.json ] || npm ci --ignore-scripts --no-audit --no-fund >/dev/null; '"$*"
