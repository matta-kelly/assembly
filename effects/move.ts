/**
 * The move: a cl that waited on a package takes the version it waited for, before its first attempt. It installs the
 * package at that version in the cl's repo, from `registry`, in a container with the network, and commits the changed
 * `package.json` and lockfile on the cl's branch as `build(deps): <package> to <version>`: a build commit asks no
 * version of its own (crate's bump reads the type). Its attempts' setup stays offline: the move alone has the network.
 *
 * Not built: the body. The signature is the seam the tests of the move fix and mock.
 */

/** The cl a move is for: its name, which names its branch, and its repo. */
export interface Moving {
  name: string;
  repo: string;
}

/**
 * Moves `pkg` to `version` in `cl`'s repo, on its branch, from the registry at `registry`, and gives back the commit
 * it made. Throws with the command's output when the install fails.
 */
export async function move(
  cl: Moving,
  pkg: string,
  version: string,
  registry: string,
): Promise<string> {
  throw new Error(
    `the move of ${pkg}@${version} in ${cl.repo} from ${registry} is not built`,
  );
}
