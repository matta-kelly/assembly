#!/usr/bin/env bash
# The body of the `factory` recipe, called as `scripts/factory.sh <verb> [args...]` by the justfile's `factory` recipe
# and by scripts/factory.test.sh. It may run from any working directory: the repo root is this file's parent's parent,
# lot is two folders above that, and the invocation directory is the working directory.
#
# It reads from the environment:
#   ASSEMBLY_SERVER   when set, the verb runs on the server: ssh "$ASSEMBLY_SERVER" factory <verb> [args...]
#   ASSEMBLY_REPOS    the folder of clones, by default lot
#   ASSEMBLY_HOME     the factory's home; $XDG_STATE_HOME/assembly (or ~/.local/state/assembly) by default
#   XDG_STATE_HOME    the state folder, when ASSEMBLY_HOME is not set
#   HOME              for the state folder, the host's git-land and crate's install, when not set by another
#   XDG_RUNTIME_DIR   the folder the host's podman socket is in
#   FIREWORKS_API_KEY the model key, for `run` only; whoever starts it fills it (the laptop's `just factory`, from the vault)
#   GH_TOKEN          the GitHub token, for `run` only, as the model key
#   PATH              ssh, podman and git, as the host has them
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
  # top draws a live screen, so it asks the server for a terminal.
  tty=()
  [ "$verb" = top ] && tty=(-t)
  exec ssh "${tty[@]}" "$ASSEMBLY_SERVER" factory "$@"
fi

home="${ASSEMBLY_HOME:-${XDG_STATE_HOME:-$HOME/.local/state}/assembly}"
repos="${ASSEMBLY_REPOS:-$lot}"

# crate, the host's install, mounted read-only into the orchestrator's image: add and submit make each dev repo's image
# with it there. Without it, neither has an image to run in, so it stops before anything runs.
crate="$HOME/.local/share/crate"
if [ "$verb" = add ] || [ "$verb" = submit ]; then
  if [ ! -x "$crate/bin/crate" ]; then
    echo "crate's install is not at $crate: put it there from its release asset" >&2
    exit 1
  fi
fi

# run takes its two keys from its environment, and starts nothing without them.
if [ "$verb" = run ]; then
  missing=()
  [ -n "${FIREWORKS_API_KEY:-}" ] || missing+=(FIREWORKS_API_KEY)
  [ -n "${GH_TOKEN:-}" ] || missing+=(GH_TOKEN)
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "factory: run needs ${missing[*]} in its environment" >&2
    exit 2
  fi
fi

mkdir -p "$home"
podman build -q -t localhost/assembly-orchestrator -f "$root/orchestrator/Containerfile" "$root/orchestrator" >/dev/null

# Who the factory commits and pushes as: Matt, by the host's git config, with git-land, the host's, mounted read-only,
# and crate's install beside it, mounted read-only too.
name=$(git config user.name 2>/dev/null || true)
email=$(git config user.email 2>/dev/null || true)
as_matt=(-e GIT_AUTHOR_NAME="$name" -e GIT_AUTHOR_EMAIL="$email" -e GIT_COMMITTER_NAME="$name" -e GIT_COMMITTER_EMAIL="$email" -v "$HOME/.local/bin/git-land:/usr/local/bin/git-land:ro" -v "$crate:/usr/local/share/crate:ro")

export ASSEMBLY_REPOS="$repos" ASSEMBLY_HOME="$home"
mounts=(-v "$repos:$repos" -v "$home:$home")
[ "$repos" = "$lot" ] || mounts+=(-v "$lot:$lot")

# top draws a live screen, so its container gets the terminal.
it=()
[ "$verb" = top ] && it=(-it)

podman run "${it[@]}" --rm --userns=keep-id:uid=1000,gid=1000 --security-opt label=disable -u node -e FIREWORKS_API_KEY -e GH_TOKEN -e ASSEMBLY_REPOS "${as_matt[@]}" -e ASSEMBLY_HOME -e HOST_HOME="$HOME" -v "$XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock" "${mounts[@]}" -w "$PWD" localhost/assembly-orchestrator node --disable-warning=ExperimentalWarning "$root/cli/index.ts" "$@"
