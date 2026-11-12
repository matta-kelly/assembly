#!/usr/bin/env bash
# The factory's recipe, `scripts/factory.sh`, on the laptop and on the server. The test runs the script the justfile's
# `factory` recipe calls, so it runs in the check's image too, where there is no `just`. With ASSEMBLY_SERVER set, the
# verb runs on the server over ssh: the stub `ssh` on the PATH shows the command, and the stubs for the local runners
# show it ran nothing here. With it unset, the verb runs here, and only `run` takes the model key through rbw-run. Each
# case asserts its own result.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# The script reads the engine's socket folder. The check image has no XDG_RUNTIME_DIR, so the test gives it one in its
# own temp folder, and no case takes the caller's.
export XDG_RUNTIME_DIR="$tmp/run"
mkdir -p "$XDG_RUNTIME_DIR"

stub=$tmp/bin
mkdir -p "$stub"

# What each local runner was asked to do, written into the case's CALLS folder by name.

# podman: its arguments, and the environment the run was given.
cat >"$stub/podman" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$CALLS/podman"
printf 'ASSEMBLY_REPOS=%s\nASSEMBLY_HOME=%s\nASSEMBLY_DEV_IMAGES=%s\n' \
  "${ASSEMBLY_REPOS-}" "${ASSEMBLY_HOME-}" "${ASSEMBLY_DEV_IMAGES-}" >"$CALLS/podman-env"
exit 0
STUB

# ssh: the command the laptop runs, then the answer the server gives it.
cat >"$stub/ssh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$CALLS/ssh"
printf '%s\n' "${SAID:-}"
exit "${SAID_CODE:-0}"
STUB

# rbw-run: the key, then the command it gives the key to.
cat >"$stub/rbw-run" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$CALLS/rbw-run"
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done
[ "$#" -eq 0 ] || shift
exec "$@"
STUB

chmod +x "$stub"/*

fail=0
check() { # what, expected, got
  if [ "$2" != "$3" ]; then
    printf 'AssertionError: %s: expected [%s], got [%s]\n' "$1" "$2" "$3" >&2
    fail=1
  fi
}
absent() { # file, what
  if [ -e "$1" ]; then
    printf 'AssertionError: %s ran on this machine\n' "$2" >&2
    fail=1
  fi
}
present() { # file, what
  if [ ! -e "$1" ]; then
    printf 'AssertionError: %s did not run\n' "$2" >&2
    fail=1
  fi
}
has_arg() { # file, argument, what
  if ! grep -qxF -- "$2" "$1" 2>/dev/null; then
    printf 'AssertionError: %s did not get [%s]\n' "$3" "$2" >&2
    fail=1
  fi
}
has_pair() { # file, flag, value, what
  if ! grep -A1 -xF -- "$2" "$1" 2>/dev/null | grep -qxF -- "$3"; then
    printf 'AssertionError: %s did not get [%s %s]\n' "$4" "$2" "$3" >&2
    fail=1
  fi
}
has_env() { # calls, variable, value, what: -e VAR=value, or -e VAR with the value in the run's environment
  local calls=$1 var=$2 value=$3 what=$4
  if grep -qxF -- "$var=$value" "$calls/podman" 2>/dev/null; then return; fi
  if grep -qxF -- "$var" "$calls/podman" 2>/dev/null &&
    grep -qxF -- "$var=$value" "$calls/podman-env" 2>/dev/null; then return; fi
  printf 'AssertionError: %s did not get [%s=%s]\n' "$what" "$var" "$value" >&2
  fail=1
}

factory=$root/scripts/factory.sh
if [ ! -x "$factory" ]; then
  echo "AssertionError: scripts/factory.sh is not there, or not executable" >&2
  exit 1
fi

# One place for every call's records, made afresh.
calls_for() {
  local dir=$tmp/$1
  mkdir -p "$dir"
  printf '%s' "$dir"
}

# --- the laptop ---------------------------------------------------------------------------------------------------

# given ASSEMBLY_SERVER, when a verb runs, then ssh runs it on the server, with its exit code and output
calls=$(calls_for status)
out=$(
  cd "$root" &&
    PATH="$stub:$PATH" CALLS="$calls" SAID="on the server" SAID_CODE=0 \
      ASSEMBLY_SERVER=assembly@monkeybusiness XDG_STATE_HOME="$tmp/state" \
      "$factory" status 2>"$calls/err"
)
code=$?
check "status gives back the server's exit code" 0 "$code"
check "status gives back the server's output" "on the server" "$out"
check "status runs over ssh" \
  "$(printf 'assembly@monkeybusiness\nfactory\nstatus')" \
  "$(cat "$calls/ssh" 2>/dev/null || true)"
absent "$calls/podman" "podman"
absent "$calls/rbw-run" "rbw-run"

# a verb takes its arguments to the server, and a name is not a path
calls=$(calls_for submit)
out=$(
  cd "$root" &&
    PATH="$stub:$PATH" CALLS="$calls" SAID="submitted" SAID_CODE=0 \
      ASSEMBLY_SERVER=assembly@monkeybusiness XDG_STATE_HOME="$tmp/state" \
      "$factory" submit fx 2>"$calls/err"
)
code=$?
check "submit gives back the server's exit code" 0 "$code"
check "submit runs over ssh, with its arguments" \
  "$(printf 'assembly@monkeybusiness\nfactory\nsubmit\nfx')" \
  "$(cat "$calls/ssh" 2>/dev/null || true)"
absent "$calls/podman" "podman"
absent "$calls/rbw-run" "rbw-run"

# an option's value is not the issue: a repo path goes to the server, and is not refused as a note path
calls=$(calls_for repo)
out=$(
  cd "$root" &&
    PATH="$stub:$PATH" CALLS="$calls" SAID="submitted" SAID_CODE=0 \
      ASSEMBLY_SERVER=assembly@monkeybusiness XDG_STATE_HOME="$tmp/state" \
      "$factory" submit --repo /srv/clones/repo fx 2>"$calls/err"
)
code=$?
check "submit takes a repo path to the server" 0 "$code"
check "the repo path and the issue go over ssh in order" \
  "$(printf 'assembly@monkeybusiness\nfactory\nsubmit\n--repo\n/srv/clones/repo\nfx')" \
  "$(cat "$calls/ssh" 2>/dev/null || true)"
absent "$calls/podman" "podman"
absent "$calls/rbw-run" "rbw-run"

# a failure on the server is the laptop's failure, with the same output
calls=$(calls_for refused)
out=$(
  cd "$root" &&
    PATH="$stub:$PATH" CALLS="$calls" SAID="refused by the server" SAID_CODE=7 \
      ASSEMBLY_SERVER=assembly@monkeybusiness XDG_STATE_HOME="$tmp/state" \
      "$factory" run --every 5 2>"$calls/err"
)
code=$?
check "a server failure is the laptop's exit code" 7 "$code"
check "a server failure keeps its output" "refused by the server" "$out"
check "run takes every argument over ssh" \
  "$(printf 'assembly@monkeybusiness\nfactory\nrun\n--every\n5')" \
  "$(cat "$calls/ssh" 2>/dev/null || true)"
absent "$calls/podman" "podman"
absent "$calls/rbw-run" "rbw-run"

# a note path is refused: the server reads its notes from git, and submit takes an issue's name
note=$tmp/fx.md
printf -- '---\ntype: issue\n---\n' >"$note"
for row in "add|$note" "submit|notes/fx.md" "add|fx.md" "submit|notes/fx"; do
  verb=${row%%|*}
  arg=${row#*|}
  calls=$(calls_for "path-${verb}-$(printf '%s' "$arg" | tr '/' '_')")
  out=$(
    cd "$root" &&
      PATH="$stub:$PATH" CALLS="$calls" SAID="on the server" SAID_CODE=0 \
        ASSEMBLY_SERVER=assembly@monkeybusiness XDG_STATE_HOME="$tmp/state" \
        "$factory" "$verb" "$arg" 2>&1
  )
  code=$?
  if [ "$code" -eq 0 ]; then
    printf 'AssertionError: %s did not refuse the note path %s\n' "$verb" "$arg" >&2
    fail=1
  fi
  absent "$calls/ssh" "ssh (after a refused note path)"
  case "$out" in
    *"$arg"*) ;;
    *)
      printf 'AssertionError: the refusal for %s does not name %s\n' "$verb" "$arg" >&2
      fail=1
      ;;
  esac
done

# --- the folder and the home --------------------------------------------------------------------------------------

# given ASSEMBLY_REPOS and ASSEMBLY_HOME, when the verb runs here, then the command line gets both, and each falls back
# on its own: the folder to lot, the home to the state folder. The final podman run carries them and mounts the folder.
repos=$tmp/repos
mkdir -p "$repos"
given_home=$tmp/given-home
lot=$(cd "$root/../.." && pwd)
check_here() { # name, want repos, want home, xdg state, assignments...
  local name=$1 want_repos=$2 want_home=$3 xdg=$4
  shift 4
  local calls
  calls=$(calls_for "here-$name")
  (
    cd "$root" &&
      env -u ASSEMBLY_SERVER -u ASSEMBLY_REPOS -u ASSEMBLY_HOME -u ASSEMBLY_DEV_IMAGES \
        PATH="$stub:$PATH" CALLS="$calls" XDG_STATE_HOME="$xdg" "$@" \
        "$factory" status 2>"$calls/err"
  )
  local code=$?
  check "$name: status runs here" 0 "$code"
  has_env "$calls" ASSEMBLY_REPOS "$want_repos" "$name: the folder"
  has_env "$calls" ASSEMBLY_HOME "$want_home" "$name: the home"
  has_arg "$calls/podman" "$want_repos:$want_repos" "$name: the folder as a mount"
  absent "$calls/ssh" "ssh ($name)"
}
check_here both "$repos" "$given_home" "$tmp/state-both" \
  ASSEMBLY_REPOS="$repos" ASSEMBLY_HOME="$given_home"
check_here folder "$repos" "$tmp/state-folder/assembly" "$tmp/state-folder" \
  ASSEMBLY_REPOS="$repos"
check_here home "$lot" "$given_home" "$tmp/state-home" \
  ASSEMBLY_HOME="$given_home"
check_here neither "$lot" "$tmp/state-neither/assembly" "$tmp/state-neither"

# the folder searched for the repos that need a dev image is ASSEMBLY_REPOS, not lot
roots=$tmp/roots
dev=$roots/devrepo
mkdir -p "$dev/scripts"
git -C "$dev" init -q -b main
git -C "$dev" remote add server core@localhost:git/devrepo.git
printf 'image = "dev"\n' >"$dev/crate.toml"
printf '#!/usr/bin/env bash\nprintf "localhost/devrepo:tag\\n"\n' >"$dev/scripts/dev-image.sh"
chmod +x "$dev/scripts/dev-image.sh"
git -C "$dev" -c user.name=t -c user.email=t@t add -A
git -C "$dev" -c user.name=t -c user.email=t@t commit -q -m main
git -C "$dev" update-ref refs/remotes/server/main HEAD
calls=$(calls_for here-dev)
(
  cd "$root" &&
    env -u ASSEMBLY_SERVER -u ASSEMBLY_DEV_IMAGES PATH="$stub:$PATH" \
      CALLS="$calls" XDG_STATE_HOME="$tmp/state-dev" ASSEMBLY_REPOS="$roots" \
      ASSEMBLY_HOME="$tmp/home-dev" "$factory" submit fx 2>"$calls/err"
)
code=$?
check "a dev repo under the given folder, submit runs here" 0 "$code"
has_env "$calls" ASSEMBLY_REPOS "$roots" "the folder given"
has_env "$calls" ASSEMBLY_DEV_IMAGES "devrepo=localhost/devrepo:tag" \
  "the dev image under the given folder"
absent "$calls/ssh" "ssh (a dev repo under the given folder)"

# --- the server ---------------------------------------------------------------------------------------------------

# given no ASSEMBLY_SERVER, the verb runs here, and no ssh is made
calls=$(calls_for here-status)
out=$(
  cd "$root" &&
    env -u ASSEMBLY_SERVER -u ASSEMBLY_REPOS -u ASSEMBLY_HOME -u ASSEMBLY_DEV_IMAGES \
      PATH="$stub:$PATH" CALLS="$calls" \
      XDG_STATE_HOME="$tmp/state" "$factory" status 2>"$calls/err"
)
code=$?
check "with no ASSEMBLY_SERVER, status runs here" 0 "$code"
present "$calls/podman" "podman"
absent "$calls/ssh" "ssh"
absent "$calls/rbw-run" "rbw-run (status takes no key)"

# the command is called from another folder: the container's working directory is that folder, not the repo's root
elsewhere=$tmp/elsewhere
mkdir -p "$elsewhere"
calls=$(calls_for elsewhere)
(
  cd "$elsewhere" &&
    env -u ASSEMBLY_SERVER -u ASSEMBLY_REPOS -u ASSEMBLY_HOME -u ASSEMBLY_DEV_IMAGES \
      PATH="$stub:$PATH" CALLS="$calls" \
      XDG_STATE_HOME="$tmp/state-elsewhere" "$factory" status 2>"$calls/err"
)
code=$?
check "from another folder, status runs here" 0 "$code"
has_pair "$calls/podman" -w "$elsewhere" "the folder the command is called from, as the working directory"
if grep -A1 -xF -- -w "$calls/podman" 2>/dev/null | grep -qxF -- "$root"; then
  printf 'AssertionError: the container got the repo root as its working directory\n' >&2
  fail=1
fi
absent "$calls/ssh" "ssh (from another folder)"

# run takes the model key through rbw-run, and only run
calls=$(calls_for here-run)
out=$(
  cd "$root" &&
    env -u ASSEMBLY_SERVER -u ASSEMBLY_REPOS -u ASSEMBLY_HOME -u ASSEMBLY_DEV_IMAGES \
      PATH="$stub:$PATH" CALLS="$calls" \
      XDG_STATE_HOME="$tmp/state" "$factory" run 2>"$calls/err"
)
code=$?
check "with no ASSEMBLY_SERVER, run runs here" 0 "$code"
present "$calls/rbw-run" "rbw-run"
present "$calls/podman" "podman"
abs=""
[ -e "$calls/rbw-run" ] && abs=$(cat "$calls/rbw-run")
case "$abs" in
  *secrets.toml*) ;;
  *)
    printf 'AssertionError: run did not read the key from secrets.toml through rbw-run\n' >&2
    fail=1
    ;;
esac
absent "$calls/ssh" "ssh"

exit "$fail"
