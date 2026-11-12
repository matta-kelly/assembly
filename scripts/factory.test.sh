#!/usr/bin/env bash
# The factory's recipe, `scripts/factory.sh`, on the laptop and on the server. The test runs the script the justfile's
# `factory` recipe calls, so it runs in the check's image too, where there is no `just`. With ASSEMBLY_SERVER set, the
# verb runs on the server over ssh: the stub `ssh` on the PATH shows the command, and the stubs for the local runners
# show it ran nothing here. With it unset, the verb runs here, and only `run` takes the model key through rbw-run. Each
# here case asserts the podman build and the whole run it asks for. Each case asserts its own result.
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
printf 'ASSEMBLY_REPOS=%s\nASSEMBLY_HOME=%s\nASSEMBLY_DEV_IMAGES=%s\n' \
  "${ASSEMBLY_REPOS-}" "${ASSEMBLY_HOME-}" "${ASSEMBLY_DEV_IMAGES-}" >"$CALLS/podman-env.$n"
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

# One place for every call's records, made afresh.
calls_for() {
  local dir=$tmp/$1
  mkdir -p "$dir"
  printf '%s' "$dir"
}

# The git identity is the host's, empty in the check image: the test masks every source git config reads, the
# checkout's local config included, so it expects `-e GIT_*=` exactly whatever the clone holds.
fake_home=$tmp/fake-home
mkdir -p "$fake_home"
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
    ASSEMBLY_DEV_IMAGES
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
launch_args "$root" "$lot" "$fake_home/.local/state/assembly" status
check "home under HOME: podman's two calls" 2 "$(cat "$calls/podman-count" 2>/dev/null || true)"
exact_call "$calls" 1 "home under HOME: the build" "${build_args[@]}"
exact_call "$calls" 2 "home under HOME: the run" "${run_args[@]}"
absent "$calls/ssh" "ssh (home under HOME)"

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
# a repo under the same folder whose image is not dev: it needs none, and its script must not run
plain=$roots/plain
mkdir -p "$plain/scripts"
git -C "$plain" init -q -b main
git -C "$plain" remote add server core@localhost:git/plain.git
printf 'image = "img"\n' >"$plain/crate.toml"
printf '#!/usr/bin/env bash\nprintf "localhost/plain:tag\\n"\n' >"$plain/scripts/dev-image.sh"
chmod +x "$plain/scripts/dev-image.sh"
git -C "$plain" -c user.name=t -c user.email=t@t add -A
git -C "$plain" -c user.name=t -c user.email=t@t commit -q -m main
git -C "$plain" update-ref refs/remotes/server/main HEAD
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
has_env "$calls" 2 ASSEMBLY_DEV_IMAGES "devrepo=localhost/devrepo:tag" \
  "the dev image under the given folder"
launch_args "$root" "$roots" "$tmp/home-dev" submit fx
check "a dev repo under the given folder: podman's two calls" 2 \
  "$(cat "$calls/podman-count" 2>/dev/null || true)"
exact_call "$calls" 1 "a dev repo under the given folder: the build" "${build_args[@]}"
exact_call "$calls" 2 "a dev repo under the given folder: the run" "${run_args[@]}"
absent "$calls/ssh" "ssh (a dev repo under the given folder)"

# a repo given by --repo, outside ASSEMBLY_REPOS, is searched for its dev image
outside=$tmp/outside
outside_note=$tmp/outside-issue.md
printf -- '---\ntype: issue\n---\n' >"$outside_note"
mkdir -p "$outside/scripts"
git -C "$outside" init -q -b main
git -C "$outside" remote add server core@localhost:git/outside.git
printf 'image = "dev"\n' >"$outside/crate.toml"
printf '#!/usr/bin/env bash\nprintf "localhost/outside:tag\\n"\n' >"$outside/scripts/dev-image.sh"
chmod +x "$outside/scripts/dev-image.sh"
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
has_env "$calls" 2 ASSEMBLY_DEV_IMAGES "outside=localhost/outside:tag" \
  "the dev image of the repo given by --repo"
launch_args "$root" "$empty_repos" "$outside_home" add "$outside_note" --repo "$outside"
check "a dev repo given by --repo: podman's two calls" 2 \
  "$(cat "$calls/podman-count" 2>/dev/null || true)"
exact_call "$calls" 1 "a dev repo given by --repo: the build" "${build_args[@]}"
exact_call "$calls" 2 "a dev repo given by --repo: the run" "${run_args[@]}"
absent "$calls/ssh" "ssh (a dev repo given by --repo)"

# --- the server ---------------------------------------------------------------------------------------------------

# given no ASSEMBLY_SERVER, the verb runs here, and no ssh is made
calls=$(calls_for here-status)
out=$(
  cd "$root" &&
    env -u ASSEMBLY_SERVER -u ASSEMBLY_REPOS -u ASSEMBLY_HOME -u ASSEMBLY_DEV_IMAGES \
      PATH="$stub:$PATH" CALLS="$calls" XDG_STATE_HOME="$tmp/state" \
      "${git_identity[@]}" "$factory" status 2>"$calls/err"
)
code=$?
check "with no ASSEMBLY_SERVER, status runs here" 0 "$code"
present "$calls/podman-count" "podman"
absent "$calls/ssh" "ssh"
absent "$calls/rbw-run" "rbw-run (status takes no key)"
has_env "$calls" 2 ASSEMBLY_REPOS "$lot" "here status: the folder"
has_env "$calls" 2 ASSEMBLY_HOME "$tmp/state/assembly" "here status: the home"
launch_args "$root" "$lot" "$tmp/state/assembly" status
check "here status: podman's two calls" 2 "$(cat "$calls/podman-count" 2>/dev/null || true)"
exact_call "$calls" 1 "here status: the build" "${build_args[@]}"
exact_call "$calls" 2 "here status: the run" "${run_args[@]}"

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
launch_args "$elsewhere" "$lot" "$tmp/state-elsewhere/assembly" status
check "elsewhere: podman's two calls" 2 "$(cat "$calls/podman-count" 2>/dev/null || true)"
exact_call "$calls" 1 "elsewhere: the build" "${build_args[@]}"
exact_call "$calls" 2 "elsewhere: the run" "${run_args[@]}"
if grep -A1 -xF -- -w "$calls/podman.2" 2>/dev/null | grep -qxF -- "$root"; then
  printf 'AssertionError: the container got the repo root as its working directory\n' >&2
  fail=1
fi
absent "$calls/ssh" "ssh (from another folder)"

# run takes the model key through rbw-run, and only run
calls=$(calls_for here-run)
out=$(
  cd "$root" &&
    env -u ASSEMBLY_SERVER -u ASSEMBLY_REPOS -u ASSEMBLY_HOME -u ASSEMBLY_DEV_IMAGES \
      PATH="$stub:$PATH" CALLS="$calls" XDG_STATE_HOME="$tmp/state" \
      "${git_identity[@]}" "$factory" run 2>"$calls/err"
)
code=$?
check "with no ASSEMBLY_SERVER, run runs here" 0 "$code"
present "$calls/rbw-run" "rbw-run"
present "$calls/podman-count" "podman"
has_env "$calls" 2 ASSEMBLY_REPOS "$lot" "here run: the folder"
has_env "$calls" 2 ASSEMBLY_HOME "$tmp/state/assembly" "here run: the home"
launch_args "$root" "$lot" "$tmp/state/assembly" run
check "here run: podman's two calls" 2 "$(cat "$calls/podman-count" 2>/dev/null || true)"
exact_call "$calls" 1 "here run: the build" "${build_args[@]}"
exact_call "$calls" 2 "here run: the run" "${run_args[@]}"
exact_list "$calls/rbw-run" "here run: rbw-run wraps the whole run" \
  -f "$root/secrets.toml" -- podman "${run_args[@]}"
absent "$calls/ssh" "ssh"

exit "$fail"
