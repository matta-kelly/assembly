#!/usr/bin/env bash
# The factory's recipe, `scripts/factory.sh`, on the laptop and on the server. The test runs the script the justfile's
# `factory` recipe calls, so it runs in the check's image too, where there is no `just`. With ASSEMBLY_SERVER set, the
# verb runs on the server over ssh: the stub `ssh` on the PATH shows the command, and the stubs for the local runners
# show it ran nothing here. With it unset, the verb runs here, and `run` takes FIREWORKS_API_KEY and GH_TOKEN from its
# environment, never the vault. The justfile's `factory` recipe body is run for the laptop's half: it asks rbw-run for
# the vault's keys, and gives them to `scripts/factory.sh run`. Each case asserts its own result.
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

# podman: every call, in order, with its arguments and the environment the run was given.
cat >"$stub/podman" <<'STUB'
#!/usr/bin/env bash
n=0
[ -f "$CALLS/podman-count" ] && read -r n <"$CALLS/podman-count"
n=$((n + 1))
printf '%s\n' "$n" >"$CALLS/podman-count"
printf '%s\n' "$@" >"$CALLS/podman.$n"
printf 'ASSEMBLY_REPOS=%s\nASSEMBLY_HOME=%s\nASSEMBLY_DEV_IMAGES=%s\nFIREWORKS_API_KEY=%s\nGH_TOKEN=%s\n' \
  "${ASSEMBLY_REPOS-}" "${ASSEMBLY_HOME-}" "${ASSEMBLY_DEV_IMAGES-}" \
  "${FIREWORKS_API_KEY-}" "${GH_TOKEN-}" >"$CALLS/podman-env.$n"
exit 0
STUB

# ssh: the command the laptop runs, then the answer the server gives it.
cat >"$stub/ssh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$CALLS/ssh"
printf '%s\n' "${SAID:-}"
exit "${SAID_CODE:-0}"
STUB

# rbw-run: the key, then the command it gives the key to, as the real one fills the environment from the vault.
cat >"$stub/rbw-run" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$CALLS/rbw-run"
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done
[ "$#" -eq 0 ] || shift
export FIREWORKS_API_KEY="${VAULT_FIREWORKS_API_KEY-fireworks-from-vault}"
export GH_TOKEN="${VAULT_GH_TOKEN-gh-from-vault}"
exec "$@"
STUB

# just: the `just _node` the recipe runs for the packages. The recipe's call to the script is the real one.
cat >"$stub/just" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$CALLS/just"
exit 0
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
has_env() { # calls, n, variable, value, what: -e VAR=value, or -e VAR with the value in the run's environment
  local calls=$1 n=$2 var=$3 value=$4 what=$5
  if grep -qxF -- "$var=$value" "$calls/podman.$n" 2>/dev/null; then return; fi
  if grep -qxF -- "$var" "$calls/podman.$n" 2>/dev/null &&
    grep -qxF -- "$var=$value" "$calls/podman-env.$n" 2>/dev/null; then return; fi
  printf 'AssertionError: %s did not get [%s=%s]\n' "$what" "$var" "$value" >&2
  fail=1
}
exact_list() { # file, what, the argument list it must be
  local file=$1 what=$2
  shift 2
  local want got
  want=$(printf '%s\n' "$@")
  got=$(cat "$file" 2>/dev/null || true)
  if [ "$want" != "$got" ]; then
    printf 'AssertionError: %s did not match\n' "$what" >&2
    printf 'wanted:\n%s\ngot:\n%s\n' "$want" "$got" >&2
    fail=1
  fi
}
exact_call() { # calls, n, what, the argument list it must be
  local calls=$1 n=$2
  shift 2
  exact_list "$calls/podman.$n" "$@"
}

factory=$root/scripts/factory.sh
if [ ! -x "$factory" ]; then
  echo "AssertionError: scripts/factory.sh is not there, or not executable" >&2
  exit 1
fi

# The laptop's half: the `factory` recipe's body as the justfile holds it, with just's values put in, so the test runs
# what `just factory <verb>` runs. The recipe's own `just _node` is a stub on the PATH.
recipe_body() { # cwd: the recipe's body, with just's values put in
  local cwd=$1
  awk '
    /^factory \+args:/ { body = 1; next }
    body && /^[^ \t]/ { body = 0 }
    body { print }
  ' "$root/justfile" | sed -e 's/^    //' \
    -e "s|{{root}}|$root|g" \
    -e "s|{{justfile_directory()}}|$root|g" \
    -e "s|{{invocation_directory()}}|$cwd|g"
}

# One place for every call's records, made afresh.
calls_for() {
  local dir=$tmp/$1
  mkdir -p "$dir"
  printf '%s' "$dir"
}

# The git identity is the host's, empty in the check image: the test masks every source git config reads, the
# checkout's local config included, so it expects `-e GIT_*=` exactly whatever the clone holds.
# crate's install on the host is what the factory mounts read-only: the run here needs it, and one case runs without.
fake_home=$tmp/fake-home
mkdir -p "$fake_home/.local/share/crate/bin"
printf '#!/usr/bin/env bash\nexit 0\n' >"$fake_home/.local/share/crate/bin/crate"
chmod +x "$fake_home/.local/share/crate/bin/crate"
git_identity=(
  HOME="$fake_home"
  GIT_CONFIG_GLOBAL=/dev/null
  GIT_CONFIG_SYSTEM=/dev/null
  GIT_CONFIG_COUNT=2
  GIT_CONFIG_KEY_0=user.name
  GIT_CONFIG_VALUE_0=
  GIT_CONFIG_KEY_1=user.email
  GIT_CONFIG_VALUE_1=
)

# The two calls a run here makes: the build, then the run. `launch_args` fills build_args and run_args for the exact
# comparison; its arguments are the working directory, the repos folder, the home, the verb and its arguments.
launch_args() { # cwd, repos, home, verb, args...
  local cwd=$1 want_repos=$2 want_home=$3 verb=$4
  shift 4
  build_args=(
    build
    -q
    -t
    localhost/assembly-orchestrator
    -f
    "$root/orchestrator/Containerfile"
    "$root/orchestrator"
  )
  run_args=(
    run
    --rm
    --userns=keep-id:uid=1000,gid=1000
    --security-opt
    label=disable
    -u
    node
    -e
    FIREWORKS_API_KEY
    -e
    GH_TOKEN
    -e
    ASSEMBLY_REPOS
    -e
    GIT_AUTHOR_NAME=
    -e
    GIT_AUTHOR_EMAIL=
    -e
    GIT_COMMITTER_NAME=
    -e
    GIT_COMMITTER_EMAIL=
    -v
    "$fake_home/.local/bin/git-land:/usr/local/bin/git-land:ro"
    -v
    "$crate_mount"
    -e
    ASSEMBLY_HOME
    -e
    "HOST_HOME=$fake_home"
    -v
    "$XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock"
    -v
    "$want_repos:$want_repos"
    -v
    "$want_home:$want_home"
  )
  if [ "$want_repos" != "$lot" ]; then run_args+=(-v "$lot:$lot"); fi
  run_args+=(
    -w
    "$cwd"
    localhost/assembly-orchestrator
    node
    --disable-warning=ExperimentalWarning
    "$root/cli/index.ts"
    "$verb"
  )
  run_args+=("$@")
}

# The host's crate install, mounted read-only at a fixed path: the source and the mode are the promise, the path is the
# builder's. `launch_args` puts the mount the run got where the exemplar, git-land, sits.
crate_mount=""
crate_mount_of() { # podman call file
  grep -F -- "$fake_home/.local/share/crate:" "$1" 2>/dev/null | grep -E ':ro$' | head -1 || true
}
expect_crate_mount() { # calls, what
  crate_mount=$(crate_mount_of "$1/podman.2")
  if [ -z "$crate_mount" ]; then
    printf 'AssertionError: %s did not mount crate, the host install, read-only\n' "$2" >&2
    fail=1
    return
  fi
  check_crate_on_path "$crate_mount" "$2"
}
# The orchestrator runs `crate` by name, so the mounted install's bin must be on the image's PATH: the mount target and
# the Containerfile's PATH are one promise, and neither side alone proves it.
check_crate_on_path() { # mount, what
  local target=${1#*:} bin path
  target=${target%:ro}
  bin="$target/bin"
  path=$(grep -E '^ENV PATH=' "$root/orchestrator/Containerfile" 2>/dev/null | sed -E 's/^ENV PATH=//' || true)
  case ":$path:" in
    *":$bin:"*) return 0 ;;
  esac
  printf 'AssertionError: %s mounts crate at %s, and the image PATH [%s] does not name %s\n' \
    "$2" "$target" "$path" "$bin" >&2
  fail=1
}
no_run() { # calls, what
  local f ran=0
  for f in "$1"/podman.[0-9]*; do
    [ -e "$f" ] || continue
    if [ "$(head -1 "$f")" = run ]; then ran=$((ran + 1)); fi
  done
  if [ "$ran" -ne 0 ]; then
    printf 'AssertionError: %s ran the container\n' "$2" >&2
    fail=1
  fi
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
absent "$calls/podman-count" "podman"
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
absent "$calls/podman-count" "podman"
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
absent "$calls/podman-count" "podman"
absent "$calls/rbw-run" "rbw-run"

# a verb with no argument still reaches the server: its usage is the server's to print
calls=$(calls_for bare)
out=$(
  cd "$root" &&
    PATH="$stub:$PATH" CALLS="$calls" SAID="usage from the server" SAID_CODE=0 \
      ASSEMBLY_SERVER=assembly@monkeybusiness XDG_STATE_HOME="$tmp/state" \
      "$factory" submit 2>"$calls/err"
)
code=$?
check "submit with no argument gives back the server's exit code" 0 "$code"
check "submit with no argument gives back the server's output" "usage from the server" "$out"
check "submit with no argument runs over ssh" \
  "$(printf 'assembly@monkeybusiness\nfactory\nsubmit')" \
  "$(cat "$calls/ssh" 2>/dev/null || true)"
absent "$calls/podman-count" "podman"
absent "$calls/rbw-run" "rbw-run"

# an option's value is not the issue: --at's ref, with a slash, goes to the server too
calls=$(calls_for at)
out=$(
  cd "$root" &&
    PATH="$stub:$PATH" CALLS="$calls" SAID="submitted" SAID_CODE=0 \
      ASSEMBLY_SERVER=assembly@monkeybusiness XDG_STATE_HOME="$tmp/state" \
      "$factory" submit --at server/main fx 2>"$calls/err"
)
code=$?
check "submit takes an --at ref to the server" 0 "$code"
check "the --at ref and the issue go over ssh in order" \
  "$(printf 'assembly@monkeybusiness\nfactory\nsubmit\n--at\nserver/main\nfx')" \
  "$(cat "$calls/ssh" 2>/dev/null || true)"
absent "$calls/podman-count" "podman"
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
absent "$calls/podman-count" "podman"
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
# on its own: the folder to lot, the home to the state folder. The build and the run carry them and mount the folder.
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
        PATH="$stub:$PATH" CALLS="$calls" XDG_STATE_HOME="$xdg" \
        "${git_identity[@]}" "$@" "$factory" status 2>"$calls/err"
  )
  local code=$?
  check "$name: status runs here" 0 "$code"
  has_env "$calls" 2 ASSEMBLY_REPOS "$want_repos" "$name: the folder"
  has_env "$calls" 2 ASSEMBLY_HOME "$want_home" "$name: the home"
  expect_crate_mount "$calls" "$name: crate"
  launch_args "$root" "$want_repos" "$want_home" status
  check "$name: podman's two calls" 2 "$(cat "$calls/podman-count" 2>/dev/null || true)"
  exact_call "$calls" 1 "$name: the build" "${build_args[@]}"
  exact_call "$calls" 2 "$name: the run" "${run_args[@]}"
  absent "$calls/ssh" "ssh ($name)"
}
check_here both "$repos" "$given_home" "$tmp/state-both" \
  ASSEMBLY_REPOS="$repos" ASSEMBLY_HOME="$given_home"
check_here folder "$repos" "$tmp/state-folder/assembly" "$tmp/state-folder" \
  ASSEMBLY_REPOS="$repos"
check_here home "$lot" "$given_home" "$tmp/state-home" \
  ASSEMBLY_HOME="$given_home"
check_here neither "$lot" "$tmp/state-neither/assembly" "$tmp/state-neither"

# with ASSEMBLY_HOME and XDG_STATE_HOME both unset, the home is the state folder under HOME
calls=$(calls_for here-home-home)
(
  cd "$root" &&
    env -u ASSEMBLY_SERVER -u ASSEMBLY_REPOS -u ASSEMBLY_HOME -u ASSEMBLY_DEV_IMAGES \
      -u XDG_STATE_HOME PATH="$stub:$PATH" CALLS="$calls" "${git_identity[@]}" \
      "$factory" status 2>"$calls/err"
)
code=$?
check "with no ASSEMBLY_HOME or XDG_STATE_HOME, status runs here" 0 "$code"
has_env "$calls" 2 ASSEMBLY_REPOS "$lot" "home under HOME: the folder"
has_env "$calls" 2 ASSEMBLY_HOME "$fake_home/.local/state/assembly" "home under HOME: the home"
expect_crate_mount "$calls" "home under HOME: crate"
launch_args "$root" "$lot" "$fake_home/.local/state/assembly" status
check "home under HOME: podman's two calls" 2 "$(cat "$calls/podman-count" 2>/dev/null || true)"
exact_call "$calls" 1 "home under HOME: the build" "${build_args[@]}"
exact_call "$calls" 2 "home under HOME: the run" "${run_args[@]}"
absent "$calls/ssh" "ssh (home under HOME)"

# the folder searched for the repos that need a dev image is ASSEMBLY_REPOS, not lot. The repo has no copy of
# scripts/dev-image.sh: the factory takes it all the same, and gets the image in its own container, from crate.
roots=$tmp/roots
dev=$roots/devrepo
mkdir -p "$dev/scripts"
git -C "$dev" init -q -b main
git -C "$dev" remote add server core@localhost:git/devrepo.git
printf 'image = "dev"\n' >"$dev/crate.toml"
git -C "$dev" -c user.name=t -c user.email=t@t add -A
git -C "$dev" -c user.name=t -c user.email=t@t commit -q -m main
git -C "$dev" update-ref refs/remotes/server/main HEAD
calls=$(calls_for here-dev)
(
  cd "$root" &&
    env -u ASSEMBLY_SERVER -u ASSEMBLY_DEV_IMAGES PATH="$stub:$PATH" \
      CALLS="$calls" XDG_STATE_HOME="$tmp/state-dev" ASSEMBLY_REPOS="$roots" \
      ASSEMBLY_HOME="$tmp/home-dev" "${git_identity[@]}" \
      "$factory" submit fx 2>"$calls/err"
)
code=$?
check "a dev repo under the given folder, submit runs here" 0 "$code"
has_env "$calls" 2 ASSEMBLY_REPOS "$roots" "the folder given"
check "the dev image is no longer passed in, the orchestrator makes it" \
  "ASSEMBLY_DEV_IMAGES=" \
  "$(grep '^ASSEMBLY_DEV_IMAGES=' "$calls/podman-env.2" 2>/dev/null || true)"
expect_crate_mount "$calls" "a dev repo under the given folder: crate"
launch_args "$root" "$roots" "$tmp/home-dev" submit fx
check "a dev repo under the given folder: podman's two calls" 2 \
  "$(cat "$calls/podman-count" 2>/dev/null || true)"
exact_call "$calls" 1 "a dev repo under the given folder: the build" "${build_args[@]}"
exact_call "$calls" 2 "a dev repo under the given folder: the run" "${run_args[@]}"
absent "$calls/rbw-run" "rbw-run (submit takes no key)"
absent "$calls/ssh" "ssh (a dev repo under the given folder)"

# a repo given by --repo, outside ASSEMBLY_REPOS, goes to the run, and its dev image is made in the orchestrator too
outside=$tmp/outside
outside_note=$tmp/outside-issue.md
printf -- '---\ntype: issue\n---\n' >"$outside_note"
mkdir -p "$outside/scripts"
git -C "$outside" init -q -b main
git -C "$outside" remote add server core@localhost:git/outside.git
printf 'image = "dev"\n' >"$outside/crate.toml"
git -C "$outside" -c user.name=t -c user.email=t@t add -A
git -C "$outside" -c user.name=t -c user.email=t@t commit -q -m main
git -C "$outside" update-ref refs/remotes/server/main HEAD
empty_repos=$tmp/empty-repos
mkdir -p "$empty_repos"
outside_home=$tmp/home-outside
calls=$(calls_for here-repo-dev)
(
  cd "$root" &&
    env -u ASSEMBLY_SERVER -u ASSEMBLY_DEV_IMAGES PATH="$stub:$PATH" \
      CALLS="$calls" ASSEMBLY_REPOS="$empty_repos" ASSEMBLY_HOME="$outside_home" \
      "${git_identity[@]}" "$factory" add "$outside_note" --repo "$outside" \
      2>"$calls/err"
)
code=$?
check "a dev repo given by --repo outside ASSEMBLY_REPOS, add runs here" 0 "$code"
has_env "$calls" 2 ASSEMBLY_REPOS "$empty_repos" "the given --repo: the folder"
check "the dev image of the repo given by --repo is not passed in, the orchestrator makes it" \
  "ASSEMBLY_DEV_IMAGES=" \
  "$(grep '^ASSEMBLY_DEV_IMAGES=' "$calls/podman-env.2" 2>/dev/null || true)"
expect_crate_mount "$calls" "a dev repo given by --repo: crate"
launch_args "$root" "$empty_repos" "$outside_home" add "$outside_note" --repo "$outside"
check "a dev repo given by --repo: podman's two calls" 2 \
  "$(cat "$calls/podman-count" 2>/dev/null || true)"
exact_call "$calls" 1 "a dev repo given by --repo: the build" "${build_args[@]}"
exact_call "$calls" 2 "a dev repo given by --repo: the run" "${run_args[@]}"
absent "$calls/rbw-run" "rbw-run (add takes no key)"
absent "$calls/ssh" "ssh (a dev repo given by --repo)"

# --- the server ---------------------------------------------------------------------------------------------------

# given no ASSEMBLY_SERVER, the verb runs here, and no ssh is made
calls=$(calls_for here-status)
out=$(
  cd "$root" &&
    env -u ASSEMBLY_SERVER -u ASSEMBLY_REPOS -u ASSEMBLY_HOME -u ASSEMBLY_DEV_IMAGES \
      -u FIREWORKS_API_KEY -u GH_TOKEN PATH="$stub:$PATH" CALLS="$calls" \
      XDG_STATE_HOME="$tmp/state" "${git_identity[@]}" "$factory" status 2>"$calls/err"
)
code=$?
check "with no ASSEMBLY_SERVER, status runs here" 0 "$code"
present "$calls/podman-count" "podman"
absent "$calls/ssh" "ssh"
absent "$calls/rbw-run" "rbw-run (status takes no key)"
has_env "$calls" 2 ASSEMBLY_REPOS "$lot" "here status: the folder"
has_env "$calls" 2 ASSEMBLY_HOME "$tmp/state/assembly" "here status: the home"
expect_crate_mount "$calls" "here status: crate"
launch_args "$root" "$lot" "$tmp/state/assembly" status
check "here status: podman's two calls" 2 "$(cat "$calls/podman-count" 2>/dev/null || true)"
exact_call "$calls" 1 "here status: the build" "${build_args[@]}"
exact_call "$calls" 2 "here status: the run" "${run_args[@]}"

# top draws a live screen: here, its container gets the terminal (-it); every other verb's run line is as above
calls=$(calls_for here-top)
(
  cd "$root" &&
    env -u ASSEMBLY_SERVER -u ASSEMBLY_REPOS -u ASSEMBLY_HOME -u ASSEMBLY_DEV_IMAGES \
      -u FIREWORKS_API_KEY -u GH_TOKEN PATH="$stub:$PATH" CALLS="$calls" \
      XDG_STATE_HOME="$tmp/state" "${git_identity[@]}" "$factory" top 2>"$calls/err"
)
code=$?
check "with no ASSEMBLY_SERVER, top runs here" 0 "$code"
launch_args "$root" "$lot" "$tmp/state/assembly" top
exact_call "$calls" 2 "here top: the run, with a terminal" run -it "${run_args[@]:1}"

# top on the server: ssh asks for a terminal (-t); status above asks for none
calls=$(calls_for server-top)
(
  cd "$root" &&
    PATH="$stub:$PATH" CALLS="$calls" SAID="" SAID_CODE=0 \
      ASSEMBLY_SERVER=assembly@monkeybusiness XDG_STATE_HOME="$tmp/state" \
      "$factory" top 2>"$calls/err"
)
check "top runs over ssh with a terminal" \
  "$(printf -- '-t\nassembly@monkeybusiness\nfactory\ntop')" \
  "$(cat "$calls/ssh" 2>/dev/null || true)"
absent "$calls/podman-count" "podman (top on the server)"

# the command is called from another folder: the container's working directory is that folder, not the repo's root
elsewhere=$tmp/elsewhere
mkdir -p "$elsewhere"
calls=$(calls_for elsewhere)
(
  cd "$elsewhere" &&
    env -u ASSEMBLY_SERVER -u ASSEMBLY_REPOS -u ASSEMBLY_HOME -u ASSEMBLY_DEV_IMAGES \
      PATH="$stub:$PATH" CALLS="$calls" XDG_STATE_HOME="$tmp/state-elsewhere" \
      "${git_identity[@]}" "$factory" status 2>"$calls/err"
)
code=$?
check "from another folder, status runs here" 0 "$code"
present "$calls/podman-count" "podman"
has_env "$calls" 2 ASSEMBLY_REPOS "$lot" "elsewhere: the folder"
has_env "$calls" 2 ASSEMBLY_HOME "$tmp/state-elsewhere/assembly" "elsewhere: the home"
expect_crate_mount "$calls" "elsewhere: crate"
launch_args "$elsewhere" "$lot" "$tmp/state-elsewhere/assembly" status
check "elsewhere: podman's two calls" 2 "$(cat "$calls/podman-count" 2>/dev/null || true)"
exact_call "$calls" 1 "elsewhere: the build" "${build_args[@]}"
exact_call "$calls" 2 "elsewhere: the run" "${run_args[@]}"
if grep -A1 -xF -- -w "$calls/podman.2" 2>/dev/null | grep -qxF -- "$root"; then
  printf 'AssertionError: the container got the repo root as its working directory\n' >&2
  fail=1
fi
absent "$calls/ssh" "ssh (from another folder)"

# given an account with ~/.ssh, when a verb runs here, then its container gets that folder read-only at node's
# ~/.ssh: the key and the known hosts it reaches crate with. With no ~/.ssh (every case above), no such mount
ssh_home=$tmp/ssh-home
mkdir -p "$ssh_home/.ssh"
calls=$(calls_for here-ssh)
(
  cd "$root" &&
    env -u ASSEMBLY_SERVER -u ASSEMBLY_REPOS -u ASSEMBLY_HOME -u ASSEMBLY_DEV_IMAGES \
      -u FIREWORKS_API_KEY -u GH_TOKEN PATH="$stub:$PATH" CALLS="$calls" \
      XDG_STATE_HOME="$tmp/state" "${git_identity[@]}" HOME="$ssh_home" "$factory" status 2>"$calls/err"
)
check "with ~/.ssh, status runs here" 0 "$?"
if ! grep -A1 -xF -- -v "$calls/podman.2" 2>/dev/null | grep -qxF -- "$ssh_home/.ssh:/home/node/.ssh:ro"; then
  printf 'AssertionError: the container did not get the account'"'"'s ~/.ssh, read-only\n' >&2
  fail=1
fi

# given FIREWORKS_API_KEY and GH_TOKEN in its environment, when run runs here, then the factory's container gets both,
# and no vault is asked
calls=$(calls_for here-run)
out=$(
  cd "$root" &&
    env -u ASSEMBLY_SERVER -u ASSEMBLY_REPOS -u ASSEMBLY_HOME -u ASSEMBLY_DEV_IMAGES \
      PATH="$stub:$PATH" CALLS="$calls" XDG_STATE_HOME="$tmp/state" \
      FIREWORKS_API_KEY=host-fireworks GH_TOKEN=host-gh \
      "${git_identity[@]}" "$factory" run 2>"$calls/err"
)
code=$?
check "with no ASSEMBLY_SERVER, run runs here" 0 "$code"
present "$calls/podman-count" "podman"
absent "$calls/rbw-run" "rbw-run (run takes its keys from its environment)"
has_env "$calls" 2 FIREWORKS_API_KEY host-fireworks "here run: the model key from the environment"
has_env "$calls" 2 GH_TOKEN host-gh "here run: the GitHub token from the environment"
has_env "$calls" 2 ASSEMBLY_REPOS "$lot" "here run: the folder"
has_env "$calls" 2 ASSEMBLY_HOME "$tmp/state/assembly" "here run: the home"
expect_crate_mount "$calls" "here run: crate"
launch_args "$root" "$lot" "$tmp/state/assembly" run
check "here run: podman's two calls" 2 "$(cat "$calls/podman-count" 2>/dev/null || true)"
exact_call "$calls" 1 "here run: the build" "${build_args[@]}"
exact_call "$calls" 2 "here run: the run" "${run_args[@]}"
absent "$calls/ssh" "ssh"

# given either key missing or empty, when run runs here, then it starts no container, and says which key is missing
run_refused() { # name, fireworks (unset, or its value), gh, the keys the refusal names...
  local name=$1 fw=$2 gh=$3
  shift 3
  local calls out code args=()
  calls=$(calls_for "refused-$name")
  [ "$fw" = unset ] || args+=(FIREWORKS_API_KEY="$fw")
  [ "$gh" = unset ] || args+=(GH_TOKEN="$gh")
  out=$(
    cd "$root" &&
      env -u ASSEMBLY_SERVER -u ASSEMBLY_REPOS -u ASSEMBLY_HOME -u ASSEMBLY_DEV_IMAGES \
        -u FIREWORKS_API_KEY -u GH_TOKEN PATH="$stub:$PATH" CALLS="$calls" \
        XDG_STATE_HOME="$tmp/state-refused-$name" "${git_identity[@]}" \
        "${args[@]}" "$factory" run 2>&1
  )
  code=$?
  if [ "$code" -eq 0 ]; then
    printf 'AssertionError: %s: run ran with a missing key\n' "$name" >&2
    fail=1
  fi
  no_run "$calls" "$name: run"
  absent "$calls/rbw-run" "$name: rbw-run (run reads its environment, not the vault)"
  local key
  for key in "$@"; do
    case "$out" in
      *"$key"*) ;;
      *)
        printf 'AssertionError: %s: the refusal does not name %s\n' "$name" "$key" >&2
        fail=1
        ;;
    esac
  done
}
run_refused both-missing unset unset FIREWORKS_API_KEY GH_TOKEN
run_refused fireworks-missing unset host-gh FIREWORKS_API_KEY
run_refused gh-missing host-fireworks unset GH_TOKEN
run_refused both-empty "" "" FIREWORKS_API_KEY GH_TOKEN
run_refused fireworks-empty "" host-gh FIREWORKS_API_KEY
run_refused gh-empty host-fireworks "" GH_TOKEN

# given the laptop, when `just factory run` runs, then rbw-run fills its environment from the vault, and run gives the
# two keys to the factory's container. The justfile's `factory` recipe body is run as it is, with a stub `just`.
laptop_cwd=$tmp/laptop-cwd
mkdir -p "$laptop_cwd"
recipe=$tmp/factory-recipe.sh
recipe_body "$laptop_cwd" >"$recipe"
chmod +x "$recipe"
calls=$(calls_for laptop-run)
out=$(
  cd "$laptop_cwd" &&
    env -u ASSEMBLY_SERVER -u ASSEMBLY_REPOS -u ASSEMBLY_HOME -u ASSEMBLY_DEV_IMAGES \
      -u FIREWORKS_API_KEY -u GH_TOKEN PATH="$stub:$PATH" CALLS="$calls" \
      XDG_STATE_HOME="$tmp/state-laptop-run" "${git_identity[@]}" \
      VAULT_FIREWORKS_API_KEY=vault-fireworks VAULT_GH_TOKEN=vault-gh \
      "$recipe" run 2>"$calls/err"
)
code=$?
check "the laptop's factory run runs here" 0 "$code"
present "$calls/rbw-run" "the laptop's factory run asks the vault"
check "the laptop's factory run asks the vault with secrets.toml" \
  "$(printf -- '-f\n%s' "$root/secrets.toml")" \
  "$(head -2 "$calls/rbw-run" 2>/dev/null || true)"
check "the laptop's factory run gives rbw-run a command after --" "--" \
  "$(sed -n 3p "$calls/rbw-run" 2>/dev/null || true)"
has_env "$calls" 2 FIREWORKS_API_KEY vault-fireworks "the laptop's run: the model key from the vault"
has_env "$calls" 2 GH_TOKEN vault-gh "the laptop's run: the GitHub token from the vault"
present "$calls/podman-count" "podman (the laptop's run reaches the factory's container)"
absent "$calls/ssh" "ssh (the laptop's run)"

# given the laptop, when a verb that takes no key runs, then no vault is asked
calls=$(calls_for laptop-status)
out=$(
  cd "$laptop_cwd" &&
    env -u ASSEMBLY_SERVER -u ASSEMBLY_REPOS -u ASSEMBLY_HOME -u ASSEMBLY_DEV_IMAGES \
      -u FIREWORKS_API_KEY -u GH_TOKEN PATH="$stub:$PATH" CALLS="$calls" \
      XDG_STATE_HOME="$tmp/state-laptop-status" "${git_identity[@]}" \
      "$recipe" status 2>"$calls/err"
)
code=$?
check "the laptop's factory status runs here" 0 "$code"
present "$calls/podman-count" "podman (the laptop's status runs here)"
absent "$calls/rbw-run" "rbw-run (the laptop's status asks no key)"
absent "$calls/ssh" "ssh (the laptop's status)"

# given a home with no crate install, when add or submit runs here, then it stops before the container, naming it
bare_home=$tmp/bare-home
mkdir -p "$bare_home"
calls=$(calls_for no-crate)
out=$(
  cd "$root" &&
    env -u ASSEMBLY_SERVER -u ASSEMBLY_REPOS -u ASSEMBLY_HOME -u ASSEMBLY_DEV_IMAGES \
      PATH="$stub:$PATH" CALLS="$calls" XDG_STATE_HOME="$tmp/state-no-crate" \
      HOME="$bare_home" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
      GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0= \
      GIT_CONFIG_KEY_1=user.email GIT_CONFIG_VALUE_1= \
      "$factory" submit fx 2>&1
)
code=$?
if [ "$code" -eq 0 ]; then
  printf 'AssertionError: submit ran with no crate install\n' >&2
  fail=1
fi
no_run "$calls" "submit with no crate install"
case "$out" in
  *".local/share/crate"*) ;;
  *)
    printf "AssertionError: the refusal does not name crate's install, ~/.local/share/crate\n" >&2
    fail=1
    ;;
esac
absent "$calls/ssh" "ssh (with no crate install)"

exit "$fail"
