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
exit 1
