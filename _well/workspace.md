---
type: doc
description: "Workspace: the place one change is made, its own branch, worktree and running copy of the repo's environment, made for the change and removed after it lands. Read when making, running or removing a workspace, yours or an attempt's."
status: active
---
Workspace: the place one change (CL) is made, so that many changes can be made at once and none touches another. A person and an agent work the same way: all reading, editing and running for a change happen inside its workspace. It is one running copy of the environment its repo defines ([[repo#Environment]]): the same image, services and check as every other workspace, CI and an attempt.

- [[#Parts]] what one is made of
- [[#Services]] its network, its pod and its route
- [[#Bar]] what holds for every one
- [[#Machine]] set up once per machine
- [[#Run]] make, use and remove one
- [[#Agents]] the rules for an agent that runs a container

- [[repo]]: the environment it runs, and the platform under it
- [[changelist]]: a CL is made in a workspace
- [[ci]]: the check it runs, and how its change lands
- [[assembly]]: makes one per attempt

---
## Parts

*Each part is the platform's shared piece, filled by the repo's own, under the workspace's name ([[repo#Platform]])*

- branch: one per change, a short branch from main
- worktree: its own checkout on disk, in `~/worktrees`. Parallel changes never share files
- container: one, made from the repo's dev image by its `devcontainer.json`, with the worktree mounted in. Everyone on the change works in it: they differ by permission, not by box
- network: its own, `<repo>-<folder>`, isolated from every other workspace ([[#Services]])
- services: the repo's `pod.yaml`, played on the network, its database first ([[#Services]])
- route: `<name>.localhost`, to the app port the repo names in `forwardPorts` ([[#Services]])
- setup: the install, from the dev image's cache into the workspace's own `node_modules` volume ([[repo#devcontainer.json]])
- an attempt: the same parts, on an internal network with no route ([[assembly]])

## Bar

- what it writes is its own: its packages, its database, its port, its preview. Made with it, used only by it, removed with it. Only a cache that is the same for every workspace is shared, such as the dev image
- its services are its own: reachable only from inside it, never a database on a shared server
- what it takes on the host takes the workspace's name: a port, a URL
- what it takes of the machine is bounded: its container has a CPU budget below the machine's cores, at low priority, in the repo's `devcontainer.json` ([[repo#devcontainer.json]]). So several workspaces run their checks at once, and the machine stays usable
- nobody works in the main checkout. It is for reading, and for notes
- credentials are scoped to the workspace; model keys never enter it
- made when the change starts, removed when it lands. The record of what happened is in the commit and the issue, not the workspace

## Services

`scripts/workspace.sh`: what a workspace runs beside its container, made by `up` and removed by `down`. A platform part, copied today from kinetic's template ([[repo#Platform]]).

- the name: `<repo>-<folder>`, a DNS label. It names the network, the pod, its volumes and the URL. A folder that is not one is refused
- the network: the workspace's own, `--opt isolate=strict`, so no workspace reaches another. Podman 5.4 isolates none by default
- the pod: the repo's `pod.yaml`, played on the network. The app reaches its database by the alias `postgres`, the same in every workspace, and the database runs the branch's migrations at start
- the router: one Caddy container per machine, `workspace-router`, started on demand at `127.0.0.1:80`. It joins each workspace's network and routes `<name>.localhost` to `<name>-app`, the dev container's alias. A container cannot reach a port published on the host's loopback, so it proxies by name
- an attempt: `up --attempt`. Its network is `--internal`, so its services are reachable and the outside is not, and it gets no route, so it cannot reach another workspace through the router
- in use: que-pasa, landl, publicpersona and stateball call it. stateball has a `pod.yaml`, and publicpersona and stateball have a route. Not built: its place in crate, and basis's call ([[workspace-on-crate]])

## Machine

1. Podman, rootless. A container's walls are rootless Podman, its own user namespace, and seccomp
2. podman writes its events to a file, not journald: `events_logger = "file"` in `~/.config/containers/containers.conf`, from deeotee. On a cold journal the dev container CLI misses its container's start event and waits forever ([devcontainers/cli#1236](https://github.com/devcontainers/cli/issues/1236))
3. log in to ghcr once, since each repo's dev image is pulled from there: `gh auth refresh -h github.com -s read:packages`, then `gh auth token | podman login ghcr.io -u matta-kelly --password-stdin`
4. VS Code (the Microsoft build) with the **Dev Containers** extension, and `dev.containers.dockerPath` set to `podman`
5. let a rootless podman bind port 80, for the router: `echo net.ipv4.ip_unprivileged_port_start=80 | sudo tee /etc/sysctl.d/90-workspace-router.conf && sudo sysctl --system`

## Run

- make it: `just up` in the worktree, or VS Code's **Reopen in Container**. Both call `npx @devcontainers/cli up --workspace-folder <root> --docker-path podman`, and the repo's file holds every setting, so both find one container
	- a start costs one pull of the dev image per new hash on this machine, then an install from the image's cache: seconds. que's whole `up` takes about 25 s, against a bound of 60 s
	- one container starts at a time: a second cold one beside it can wedge with the folder mounted and the install never begun. A wedged start is killed and run again, never waited on
- use it: run every command in the container, never on the host. A host install puts `node_modules` back in the vault
	- `just run <command>`, or `npx @devcontainers/cli exec --workspace-folder . --docker-path podman <command>`
	- while working, run the change's own tests. The full check runs once, before it lands: it starts a process per test file, and two at once can take every core
	- the lockfile changed: run the install again in the container. It reads the image's cache and fetches only what is new
	- a new dev image on main: `just down`, then `just up`. A container keeps the image it was made from
- find it: by the label the CLI sets, `devcontainer.local_folder=<root>`. The CLI invents a name at each create, so no name is stable
- remove it: `just down`, before the worktree is removed. It removes the container, then the volumes named with `${devcontainerId}`, whose names are readable from its mounts only while it exists
- per repo
	- basis, publicpersona and landl have `up`, `run` and `down`
	- que has `up <deployment>`, `start <deployment>`, `stop`, `logs` and `down`; its `scripts/container.sh` adds a deployment folder outside the repo, and makes a create again when its bound cuts it before the install. landl-que's recipes call que's of the same name
	- que's and landl-que's `stop` pauses: `start` resumes with no create and no install
	- que's container mounts no data folder: with `QUE_DATA_DIR` unset, a conversation's files live in the container, and go with it at `just down`

## Agents

- start a container only from a worktree in `~/worktrees`, never in the vault
- a container an agent runs itself, a probe, takes the same budget: `--cpus=3 --cpu-shares=256`. One uncapped check takes every core
- a probe that runs as the host's user: `--userns=keep-id:uid=1000,gid=1000 --user 1000:1000 -e HOME=/home/node`. The dev image sets no `USER`, so without `--user` it runs as root, and what it writes belongs to a subuid: `podman unshare rm -rf <folder>` removes it
- never stop, restart, kill or remove a container, a volume, a process or a folder you did not start. Ask its owner
- watch a create or an install, never wait it out: read the real process state every 30 to 90 seconds (`ps -o pid,stat,etime,cmd`, the container's state from `podman ps`). A printed line is no proof of progress
	- a process in state `T` is stopped, and never goes on by itself
	- no progress across two reads: stop it, and report it as a hang
- an agent's shell has no terminal. What a person runs on a terminal is tested under a pty too (`script -qec '<command>' /dev/null`)
- pause with `stop`, not `down`, where the repo has it: `down` throws away the install
