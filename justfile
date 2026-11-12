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
e2e:
    podman build -q -t localhost/assembly-orchestrator -f orchestrator/Containerfile orchestrator >/dev/null
    @just _node true
    podman run --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable -u node -e ASSEMBLY_E2E=1 -e ASSEMBLY_E2E_KEEP -e CRATE_ROOT="{{lot}}/daworks/crate" -v "{{lot}}/daworks/crate:{{lot}}/daworks/crate:ro" {{as_matt}} -v "$XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock" -v "{{root}}:{{root}}" -w "{{root}}" localhost/assembly-orchestrator npx vitest run e2e.test

# One real call per model the bins name, through que-pasa: the key, the model ids and structured output, for a fraction
# of a cent. The key comes from the vault (secrets.toml, through rbw-run) into the orchestrator's environment only.
smoke-model:
    podman build -q -t localhost/assembly-orchestrator -f orchestrator/Containerfile orchestrator >/dev/null
    @just _node true
    rbw-run -f "{{root}}/secrets.toml" -- podman run --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable -u node -e FIREWORKS_API_KEY -v "{{root}}:{{root}}" -w "{{root}}" localhost/assembly-orchestrator node scripts/smoke-model.ts

# With ASSEMBLY_SERVER set (assembly@monkeybusiness), the verb runs there over ssh, and nothing here: a note path is
# refused, since the server reads its notes from git, and submit takes an issue's name. Without it, the verb runs here.
#
# Its home is on the host, at the same path, and so is the folder the repos are under, ASSEMBLY_REPOS (lot by default).
# Only `run` gets the model key and GH_TOKEN, from the vault (secrets.toml, through rbw-run).
# The factory's command line (cli/), in the orchestrator's image: `just factory status`
factory +args:
    #!/usr/bin/env bash
    set -euo pipefail
    verb=$1
    if [ -n "${ASSEMBLY_SERVER:-}" ]; then
      # The first positional is the issue. A path is refused: the server reads notes from git, and submit takes a name.
      if [ "$verb" = add ] || [ "$verb" = submit ]; then
        note=""
        prev=""
        first=1
        for a in "$@"; do
          if [ "$first" = 1 ]; then first=0; prev=$a; continue; fi
          case "$prev" in --repo|--at) prev=$a; continue;; esac
          case "$a" in
            --repo|--at) prev=$a ;;
            -*) ;;
            *) note=$a; break ;;
          esac
        done
        case "$note" in
          */*|*.md)
            echo "$verb takes an issue's name on the server, not the note path $note: the server reads its notes from git" >&2
            exit 2
            ;;
        esac
      fi
      exec ssh "$ASSEMBLY_SERVER" factory "$@"
    fi
    home="${ASSEMBLY_HOME:-${XDG_STATE_HOME:-$HOME/.local/state}/assembly}"
    repos="${ASSEMBLY_REPOS:-{{lot}}}"
    mkdir -p "$home"
    podman build -q -t localhost/assembly-orchestrator -f orchestrator/Containerfile orchestrator >/dev/null
    just _node true
    key=()
    [ "$verb" = run ] && key=(rbw-run -f "{{root}}/secrets.toml" --)
    # A repo checked in its dev image: put the image on this machine, from the repo's own script, and pass its tag in.
    # The repos are the ones given, or, with none, every repo on crate under ASSEMBLY_REPOS (a git repo with a `server` remote).
    dev=()
    if [ "$verb" = add ] || [ "$verb" = submit ]; then
      found=()
      prev=""
      for a in "$@"; do
        [ "$prev" = --repo ] && found+=("$(realpath "$a")")
        prev=$a
      done
      if [ "${#found[@]}" -eq 0 ]; then
        while IFS= read -r g; do
          r=$(dirname "$g")
          git -C "$r" remote get-url server >/dev/null 2>&1 && found+=("$r")
        done < <(find "$repos" -maxdepth 4 -name .git -not -path '*/node_modules/*' -not -path '*/.*/.git')
      fi
      for r in "${found[@]}"; do
        if git -C "$r" show server/main:crate.toml 2>/dev/null | grep -qE '^[[:space:]]*image[[:space:]]*=[[:space:]]*"dev"'; then
          dev+=("$(basename "$r")=$(cd "$r" && scripts/dev-image.sh local | tail -1)")
        fi
      done
    fi
    export ASSEMBLY_REPOS="$repos" ASSEMBLY_HOME="$home"
    export ASSEMBLY_DEV_IMAGES=$(IFS=,; echo "${dev[*]}")
    mounts=(-v "{{lot}}:{{lot}}" -v "$home:$home")
    case "$repos/" in "{{lot}}/"*) ;; *) mounts+=(-v "$repos:$repos") ;; esac
    "${key[@]}" podman run --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable -u node -e FIREWORKS_API_KEY -e GH_TOKEN -e ASSEMBLY_DEV_IMAGES -e ASSEMBLY_REPOS {{as_matt}} -e ASSEMBLY_HOME -e HOST_HOME="$HOME" -v "$XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock" "${mounts[@]}" -w "{{invocation_directory()}}" localhost/assembly-orchestrator node --disable-warning=ExperimentalWarning "{{root}}/cli/index.ts" "$@"

# Run a command in the Node image: `just run npm install zod`
run +command:
    @just _node "$@"

# The lint runs in this pinned Node image, never on the host, and installs only when the lockfile is newer.
node_image := "docker.io/library/node:22.23.4-slim"

_node +command:
    @podman run --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable --cpus=3 --cpu-shares=256 -u node -e NPM_CONFIG_UPDATE_NOTIFIER=false -v "{{root}}:{{root}}" -w "{{root}}" {{node_image}} sh -c '[ node_modules/.package-lock.json -nt package-lock.json ] || npm ci --ignore-scripts --no-audit --no-fund >/dev/null; '"$*"
