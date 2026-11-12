#!/usr/bin/env bash
# The body of the `factory` recipe, called as `scripts/factory.sh <verb> [args...]` by the justfile's `factory` recipe
# and by scripts/factory.test.sh. It may run from any working directory: the repo root is this file's parent's parent,
# lot is two folders above that, and the invocation directory is the working directory.
#
# It reads from the environment:
#   ASSEMBLY_SERVER   when set, the verb runs on the server: ssh "$ASSEMBLY_SERVER" factory <verb> [args...]
#   ASSEMBLY_REPOS    the folder of clones, and the folder searched for a repo that needs a dev image; lot by default
#   ASSEMBLY_HOME     the factory's home; $XDG_STATE_HOME/assembly (or ~/.local/state/assembly) by default
#   XDG_STATE_HOME    the state folder, when ASSEMBLY_HOME is not set
#   HOME              for the state folder and the host's git-land, when XDG_STATE_HOME is not set
#   PATH              ssh, podman, rbw-run, node and git, as the host has them
#
# It gives back the verb's exit code, and its output, unchanged.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
lot=$(cd "$root/../.." && pwd)
verb=${1:-}

# On the laptop, the server runs the verb, and nothing here. A note path is refused: the server reads its notes from
# git, and submit takes an issue's name. An option's value, a repo path, is not the issue.
if [ -n "${ASSEMBLY_SERVER:-}" ]; then
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
repos="${ASSEMBLY_REPOS:-$lot}"
mkdir -p "$home"
podman build -q -t localhost/assembly-orchestrator -f "$root/orchestrator/Containerfile" "$root/orchestrator" >/dev/null
key=()
[ "$verb" = run ] && key=(rbw-run -f "$root/secrets.toml" --)

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

# Who the factory commits and pushes as: Matt, by the host's git config, with git-land, the host's, mounted read-only.
name=$(git config user.name 2>/dev/null || true)
email=$(git config user.email 2>/dev/null || true)
as_matt=(-e GIT_AUTHOR_NAME="$name" -e GIT_AUTHOR_EMAIL="$email" -e GIT_COMMITTER_NAME="$name" -e GIT_COMMITTER_EMAIL="$email" -v "$HOME/.local/bin/git-land:/usr/local/bin/git-land:ro")

export ASSEMBLY_REPOS="$repos" ASSEMBLY_HOME="$home"
export ASSEMBLY_DEV_IMAGES=$(IFS=,; echo "${dev[*]}")
mounts=(-v "$repos:$repos" -v "$home:$home")
[ "$repos" = "$lot" ] || mounts+=(-v "$lot:$lot")

"${key[@]}" podman run --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable -u node -e FIREWORKS_API_KEY -e GH_TOKEN -e ASSEMBLY_DEV_IMAGES -e ASSEMBLY_REPOS "${as_matt[@]}" -e ASSEMBLY_HOME -e HOST_HOME="$HOME" -v "$XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock" "${mounts[@]}" -w "$PWD" localhost/assembly-orchestrator node --disable-warning=ExperimentalWarning "$root/cli/index.ts" "$@"
