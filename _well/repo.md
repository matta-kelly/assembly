---
type: doc
description: "A repo: one per project, and the convention all its scaffolding hangs off: the platform it calls, the environment it defines (dev image, services, check), the workspace, CI and CD that run it, its GitHub settings and its conventions, by kind. Use when setting up a repo, changing its environment, or finding where a part of CI, CD or a workspace is said."
status: active
---
A repo: one per project, and the convention all its scaffolding hangs off. Every place its code runs (a workspace, CI, an attempt, a node) runs what the repo defines, on what the platform shares.
- [[#Platform]] the shared, versioned source every repo calls
- [[#Environment]] the repo's own layer on the platform: its dev image, services and check
- [[workspace]] one running instance of the environment, for one change
- [[ci]] the stations from a change to a released version
- [[cd]] a released version, to running on a node
- [[#On GitHub]] its settings and remotes
- [[#Conventions]] what every repo has, and what each kind adds

- [[operate]]: what runs, watched against its SLOs, after cd
- [[kinetic#The checks]]: the map, where a cl lands
- [[github]]: the account the repos belong to

---
## Platform

*One source every repo calls at a version, so a fix reaches every repo with no change in it*

- the parts, by where they run
	- in CI: the reusable workflows, checks, dev-image and release. A repo calls each at `@v1`, and the workflow checks out the platform at its tag, so no repo holds a copy
	- on the machine: the host scripts, `dev-image.sh` and `workspace.sh`, as one tool installed at a version, as `git-land` is ([[deeotee]]). They run before any container exists, from `initializeCommand` and on a CI runner, so no container can carry them
	- in the container: the base dev image, upstream `devcontainers/javascript-node:22` with the shared tools (`just`, `gh`, `git-land`). Every repo's dev image is `FROM` it
- the versions: semver. A consumer takes a major: a workflow at `@v1`, the tool at its major, and the base image by digest, so a dev image's hash still names all its inputs. A breaking change is a new major, and Renovate opens the bump in each repo ([[dependency-updates]])
- the rule: a part the same in every repo is the platform's; a part that differs per repo is the repo's ([[#Environment]])
- Not built: the platform repo. Its parts are copies: kinetic's `templates/repo/scripts/`, kept byte-identical in each repo, and basis's workflows, copied and drifted, so only basis's `checks.yml` matches. The base image does not exist: each Containerfile starts from upstream ([[landing-flow]])

## Environment

*A repo defines its environment once. A workspace, CI and an attempt all run that one definition*

- four parts, all in the repo, each the repo's own
	- the dev image: its Containerfile layer, with its system libraries and the package cache of its lockfile, from `.devcontainer/Containerfile` ([[#Dev image]])
	- the services: what runs beside the dev container, its database first, from `.devcontainer/pod.yaml` (kube YAML, `WORKSPACE` standing for the workspace's name), played by `scripts/workspace.sh` ([[workspace#Services]]). A repo with no services has no file. Not built: no repo has one yet
		- the app under test: a repo with a UI runs its runtime image as one more service, `site`, on the same network as its tests, and its tests reach it by name (`http://site:3000`): on the workspace's network on a machine, on the job's own network in CI. Never `--network host`. Held by: publicpersona's check, the first; every repo with a UI follows it
	- the check: `scripts/check.sh`, one command, the same everywhere ([[ci#The check set]])
	- the ship kind: what a land to main releases, a package, an image, or nothing ([[ci#Release]])
- the template: `templates/repo/scripts/` in kinetic: `check.sh`, `dev-image.sh` with its test and its smoke, and `workspace.sh` with its test. A new repo copies them, and copies its `.devcontainer/Containerfile` and `.github/workflows/` from basis, with `<repo>` filled in. The platform replaces the copies ([[#Platform]])
- lot, kinetic and dazoo have none: their lint runs in a pinned Node image

### Dev image

- `ghcr.io/matta-kelly/<repo>-dev`. It holds the toolchain and the package cache of the lockfile, never `node_modules` or build output: a stale build output passes broken code
- the Containerfile, built from the repo's root:
	```dockerfile
	FROM mcr.microsoft.com/devcontainers/javascript-node:22 AS base
	ENV npm_config_cache=/opt/npm-cache \
	    npm_config_prefer_offline=true
	RUN install -d -o node -g node /opt/npm-cache

	FROM base AS bake
	USER node
	COPY --chown=node:node . /tmp/bake
	RUN cd /tmp/bake && npm ci --ignore-scripts

	FROM base
	COPY --from=bake --chown=node:node /opt/npm-cache /opt/npm-cache
	LABEL org.opencontainers.image.source=https://github.com/matta-kelly/<repo>
	```
	- what more than Node it needs goes in the `base` stage: system libraries, and a browser at a fixed path (`PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`), since a volume over `~/.cache` would hide it
	- the last stage sets no `USER`: a GitHub job container needs root to write its checkout
- its tag is the hash of its inputs, git's tree entries of the lockfiles, `devcontainer.json` and the Containerfile (`scripts/dev-image.sh hash`), so one commit gives one tag on every machine
- `dev-image.yml`, on a push to main that changes an input, and by hand: `scripts/dev-image.sh ensure` builds, smokes (`scripts/dev-image-smoke.sh`: an offline install from the cache, with no network) and pushes `:<hash>` only when ghcr lacks it, then `promote` points `:main` at it. The same inputs are never built twice
	- the build is tagged `<hash>-candidate` until its smoke passes, so a failed smoke leaves no image
	- a path filter is allowed: it is not a required check
- `scripts/dev-image.sh local` puts a commit's image on a machine: its copy, else a pull, else a build and a smoke with no push. A container with no network starts on it
- used by: each check job ([[ci#One command]]), each workspace (`image: ...-dev:main`), and an attempt's sandbox ([[assembly]])

### devcontainer.json

How a workspace makes its container from the image ([[workspace]]):

```json
{
  "name": "<repo>",
  "image": "ghcr.io/matta-kelly/<repo>-dev:main",
  "initializeCommand": "(podman pull ghcr.io/matta-kelly/<repo>-dev:main || echo 'could not pull: the copy this machine has is used' >&2) && scripts/workspace.sh up ${localWorkspaceFolder}",
  "workspaceMount": "source=${localWorkspaceFolder},target=${localWorkspaceFolder},type=bind",
  "workspaceFolder": "${localWorkspaceFolder}",
  "runArgs": ["--userns=keep-id:uid=1000,gid=1000", "--network", "<repo>-${localWorkspaceFolderBasename}", "--network-alias", "<repo>-${localWorkspaceFolderBasename}-app", "--cpus=3", "--cpu-shares=256"],
  "forwardPorts": [3000],
  "remoteUser": "node",
  "updateRemoteUserUID": false,
  "mounts": [
    "source=<repo>-node-modules-${devcontainerId},target=${containerWorkspaceFolder}/node_modules,type=volume"
  ],
  "postCreateCommand": "sudo chown node:node node_modules && npm ci"
}
```

- `initializeCommand` runs on the host before the CLI looks for the image, and the CLI never pulls a tag the machine has: so the pull is what keeps `:main` current
- `--userns=keep-id:uid=1000,gid=1000`: maps the host user onto the image's `node` user, so files written from inside stay the host user's
- `--network` and `--network-alias`: the workspace's own network, which `workspace.sh up` made, and the name the router proxies to
- `forwardPorts`: the app port the router routes `<workspace>.localhost` to. A repo that serves nothing leaves it out
- `--cpus` and `--cpu-shares`: the container's CPU budget, below the machine's cores, and its low priority, enforced by the kernel (cgroups). They live here and nowhere else: `just` and VS Code both make the container from this file
- `workspaceMount` at the host path: caches such as `.next` store absolute paths, and a different path inside the container breaks them
- packages live in a volume, never in the repo folder: Obsidian loads every file in the vault, and `node_modules` is tens of thousands of files. One volume per checkout (`${devcontainerId}` differs per folder), and one more for each folder that fills with generated files (a second `node_modules`, `.next`)
	- `chown` before the install: a new volume starts owned by root
	- `npm ci` reads the image's cache (`npm_config_prefer_offline`), so the install copies, and fetches only what the cache lacks

## On GitHub

- main: always releasable. Main moves only through the gate ([[ci#Merge queue]])
- a change: one commit, or a short stack of them, pushed to its own branch. No pull request: what one carried goes in the commit message ([[changelist#Parts]]). The branch is deleted after it lands
- settings: pull requests off, and the ruleset on main ([[ci#The ruleset]])
- review: before the push, on the local diff ([[daworks/assembly/agents/cl-review|review]]). Not a GitHub approval, so approvals stay at zero
- a person's review: none by default. The plan is checked before any CL, and the build is trusted. A person reviews a CL only when the reviewer can't tell whether it meets the issue's intent ([[daworks/assembly/agents/cl-review|cl-review]])
- remotes: `origin` is GitHub, in every project
	- any other server has its own name, such as `forgejo`
	- a remote is removed once the project no longer needs that server

## Conventions

The target. Not every repo meets it yet.

- every repo
	- one check command, which runs only what a change touches. What it runs, and the template: [[ci]]
	- lockfile: holds every package, and every install reads it frozen
	- lint: runs in a pinned Node image, or the repo's dev image when it has one
	- own root and schema ([[basis-graph]])
	- depends on others only by published version
	- versioned: semver, bumped on each land to main from its commits, and released by its ship kind ([[ci#Release]])
	- one landing path ([[ci]])
- semantic repo
	- notes and their types
	- check: lint
	- lands straight to main, and that's the end
	- lot, [[kinetic]]
- config repo
	- the declared config of one app that runs on images others build: its unit files, its settings, its notes
	- check: lint, and the validation of its config
	- goes out by: dazoo applies it. dazoo runs it, and holds none of its config
	- homepage, media-stack: their notes so far. Their config is in dazoo until dazoo-sync reads a config repo
- code repo
	- `README.md`: what the project is, its parts (each with its test kind and its path), and how to run, check and ship it
	- tests ([[tests]])
	- environment: a dev image, its services and its check ([[#Environment]]), when code work here needs one. dazoo gets one when the factory runs there
	- check: lint, types, tests
	- goes out by
		- publish: [[basis]], beam-pi-extension
		- ship: [[que]] (also publishes), landl, [[deportesdecasa]], [[publicpersona]], [[stateball]], landl-db
		- apply: [[dazoo]], [[deeotee]], [[monkeyimage]]
