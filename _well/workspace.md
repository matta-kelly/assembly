---
type: doc
description: "Workspace: the running system of one change, made by crate from the repo's crate.toml: its own network, services, tools member and app, on its own branch and worktree, removed after the change lands. Read when making, running or removing a workspace, yours or an attempt's."
status: active
---
Workspace: the running system of one change (CL), so that many changes run at once and none touches another. A person and an agent work the same way: all reading, editing and running for a change happen inside its workspace. crate makes it from the repo's `crate.toml` ([[repo#Environment]]), the same declaration it makes the check's system from ([[ci#Merge queue]]) and an attempt's.

- [[#Parts]] what one is made of
- [[#Postures]] the three kinds crate makes: a person's, an attempt's, the check's
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

*Each part is crate's, filled by the repo's `crate.toml`, under the workspace's name*

- branch: one per change, a short branch from main
- worktree: its own checkout on disk, in `~/worktrees`. Parallel changes never share files
- name: `<name>-<folder>`, crate.toml's `name` and the worktree's folder, or the name alone when the folder is the name. A DNS label: it names every other part
- network: its own, `--opt isolate=strict`, so no workspace reaches another
- services: each Pod of crate.toml's `services` file, named `WORKSPACE-<service>`, played on the network and reached by its service's name (`postgres`). No `resources` limits
- tools member: the dev image with the worktree at its own path, its folders of generated files (`[tools] volumes`, `node_modules` by default) in volumes of its own, and `[tools] setup` run once when it is made. Every command of the change runs here
- app: `[app]`. In a person's workspace and an attempt the dev server (`command`) in the dev image; in the check the built image (`build`), run as production runs it. Reached as `app` by a tool, and at `CRATE_APP_URL` by a browser, since Chromium sends the top-level domain `app` to https. Up waits until its `health` passes
- binding: `[app] needs`, the env the app must be given. A workspace gives it by `[tools] env`; a workspace that lacks one fails `up`, named
- route: `<name>.localhost:8080`, and `<port name>.<name>.localhost:8080`, to the app's ports, through the machine's router

## Postures

*One declaration, three kinds of system, each with its place in the machine's order*

- a person's (`crate up`): the dev server, its route, at the head of the order
- an attempt's (`crate up --attempt`): the same parts in a worktree of its own, on an internal network with no route, so the outside and other workspaces are out of reach ([[assembly]])
- the check's: made by crate's gate for one push, with the built app, then removed but for its tools volumes, which stay warm ([[ci#Merge queue]])

## Bar

- what it writes is its own: its packages, its database, its port, its preview. Made with it, used only by it, removed with it. Only a cache that is the same for every workspace is shared, such as the dev image
- its services are its own: reachable only from inside it, never a database on a shared server
- what it takes on the host takes the workspace's name: its route
- what it takes of the machine is ordered, not capped: crate puts each kind in a slice of its own with a CPU weight, a person's work first, then checks, then postsubmit and attempts, and counts how many checks, postsubmits and attempts run at once. The ceiling is the machine's ([[#Machine]])
- nobody works in the main checkout. It is for reading, and for notes
- credentials are scoped to the workspace; model keys never enter it. A secret reaches one command by name, never in argv: `crate run -e NAME`
- made when the change starts, removed when it lands. The record of what happened is in the commit and the issue, not the workspace

## Machine

1. Podman, rootless. A container's walls are rootless Podman, its own user namespace, and seccomp
2. crate, at its major tag `v2`, in `~/.local/share/crate` with `crate` on the PATH, from deeotee on the laptop and dazoo on the server, kept current by each
3. the ceiling, root's, on `user.slice`: a memory total at three quarters of RAM, a soft line at nine tenths of it, and systemd-oomd, which kills the worst job under lasting pressure. From deeotee and dazoo
4. the count: `/etc/crate/machine.toml` `[count]`, how many checks, postsubmits and attempts run at once
5. log in to ghcr once, since each repo's dev image is pulled from there: `gh auth refresh -h github.com -s read:packages`, then `gh auth token | podman login ghcr.io -u matta-kelly --password-stdin`
6. the router: one per machine, `workspace-router`, on `127.0.0.1:8080`, which rootless Podman binds with no change to the machine. crate makes it on demand

## Run

- make it: `just up` in the worktree (`crate up`). A second `up` changes nothing; after a stop it starts what stopped
	- a start costs one pull or build of the dev image per new hash on this machine, then `[tools] setup` from the image's cache: seconds
- use it: run every command in the workspace, never on the host. A host install puts `node_modules` back in the vault
	- `just run <command>` (`crate run`), from any folder of the worktree. A secret: `crate run -e NAME`, which passes the shell's `NAME` by its name
	- while working, run the change's own tests. The full check runs once, before it lands
	- the lockfile changed: run the install again in the workspace. It reads the image's cache and fetches only what is new
	- a new dev image: `just down`, then `just up`. A tools member keeps the image it was made from
	- its URLs: `crate url`. A member's output: `crate logs [tools|app|<service>]`. Its services again: `crate services`
- remove it: `just down` (`crate down`), before the worktree is removed. It removes the app and its routes, the members, the services, the volumes and the network. A second `down` changes nothing
- per repo
	- basis, que-pasa, landl, publicpersona and stateball: `up`, `run`, `check` and `down` call crate. stateball's `psql` and `build` run in the workspace
	- que keeps its own scripts: `up <deployment>`, `start <deployment>`, `stop`, `logs` and `down`. landl-que's recipes call que's of the same name
	- que's and landl-que's `stop` pauses: `start` resumes with no create and no install

## Agents

- start a workspace only from a worktree in `~/worktrees`, never in the vault
- a container an agent runs itself, a probe, takes a CPU budget: `--cpus=3 --cpu-shares=256`. One uncapped check takes every core
- a probe that runs as the host's user: `--userns=keep-id:uid=1000,gid=1000 --user 1000:1000 -e HOME=/home/node`. The dev image sets no `USER`, so without `--user` it runs as root, and what it writes belongs to a subuid: `podman unshare rm -rf <folder>` removes it
- never stop, restart, kill or remove a container, a volume, a process or a folder you did not start. Ask its owner
- watch a create or an install, never wait it out: read the real process state every 30 to 90 seconds (`ps -o pid,stat,etime,cmd`, the container's state from `podman ps`). A printed line is no proof of progress
	- a process in state `T` is stopped, and never goes on by itself
	- no progress across two reads: stop it, and report it as a hang
- an agent's shell has no terminal. What a person runs on a terminal is tested under a pty too (`script -qec '<command>' /dev/null`)
- pause with `stop`, not `down`, where the repo has it: `down` throws away the install
