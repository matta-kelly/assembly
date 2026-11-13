---
type: doc
description: "A repo: one per project, and the convention all its scaffolding hangs off: the platform it calls, the environment it defines (dev image, services, check), the workspace, CI and CD that run it, its GitHub settings and its conventions, by kind. Use when setting up a repo, changing its environment, or finding where a part of CI, CD or a workspace is said."
status: active
---
A repo: one per project, and the convention all its scaffolding hangs off. Every place its code runs (a workspace, CI, an attempt, a node) runs what the repo defines, on what the platform shares.
- [[#Platform]] crate: the shared, versioned source every repo runs
- [[#Environment]] the repo's own layer on the platform: its dev image, services and check
- [[workspace]] one running instance of the environment, for one change
- [[ci]] the stations from a change to a released version
- [[cd]] a released version, to running on a node
- [[#On GitHub]] its settings and remotes
- [[#Conventions]] what every repo has, and what each kind adds

- [[operate]]: what runs, watched against its SLOs, after cd
- [[assembly#The checks]]: the map, where a cl lands
- [[github]]: the account the repos belong to

---
## Platform

*crate: one source every repo runs at a version, so a fix reaches every repo with no change in it ([github.com/matta-kelly/crate](https://github.com/matta-kelly/crate))*

- the parts, by where they run
	- on the server: crate's git hooks on each repo's bare repo, which hold main, check every push to it, copy it to GitHub ([[ci#Merge queue]]), run the slow sets after it moves ([[ci#Postsubmit]]), and version it ([[ci#Release]]). `crate init` makes a bare repo, and `crate apply` makes a server match its declaration in [[dazoo]]
	- on the machine: crate, one Go binary, the maker of a repo's workspace and dev image (`crate up`, `run`, `down`, `dev-image`). It runs before any container exists, so no container carries it. Installed from its release at `v2`, by deeotee on the laptop and by dazoo for each crate user on the server. The platform's host scripts live in crate, with no copy in a repo
	- in the container: the base dev image, upstream `devcontainers/javascript-node:22` with the shared tools. Every repo's dev image is `FROM` it. Not built: each Containerfile starts from upstream
- a repo on crate: its `crate.toml` names its check's image (`dev`, or a pinned ref), and its checkouts land on the remote `server`
- the versions: semver. Every machine runs crate at its major tag (`v2`), moved by a release (`just release` in crate). crate's own change stays outside the gate it ships, so a broken hook never blocks its own fix
- the rule: a part the same in every repo is crate's; a part that differs per repo is the repo's ([[#Environment]])

## Environment

*A repo declares its environment once, in `crate.toml`. A workspace, the check and an attempt are each a system crate makes from it ([[workspace]])*

- `crate.toml`, the declaration
	- `name`: the repo's name, which names its workspace and its dev image. Required
	- `[dev]`: the dev image, `inputs` (the files its hash covers, required), and `containerfile` and `smoke` where a repo keeps them elsewhere ([[#Dev image]])
	- `[tools]`: the tools member, `volumes` (folders of generated files, kept in volumes), `setup` (the install, run once) and `env`
	- `services`: the services file, Pods named `WORKSPACE-<service>`, each reached by its service's name. stateball's Postgres, the first
	- `[app]`: the app, `command` (the dev server), `build` (the image that ships, which the check runs as production does), `health`, `env` (the built app's), `ports`, and `needs`
	- `needs`: the shape of the app's binding, the env every place that runs it gives (a workspace by `[tools] env`, the check by `[app] env`, a node by its unit file). The check proves the built image refuses to start without it. publicpersona's Immich URL and key, the first
	- the gate's keys: `image`, `timeout`, `ship`, `packages`, `postsubmit`, `postsubmit_timeout` ([[ci]])
- a repo declares itself: a `crate.toml` with no `name` or no `[dev] inputs` is refused by `crate dev-image` and by the gate, with the key it lacks. crate guesses neither
- the check: `scripts/check.sh`, one command, the same everywhere ([[ci#The check set]]). A browser test opens the app at `CRATE_APP_URL`
- the ship kind: what a land to main releases, a package, an image, a source, or nothing ([[ci#Release]])
- the template: `templates/repo/` in kinetic: `crate.toml` (with the keys a repo adds shown as comments), `scripts/check.sh`, `scripts/dev-image-smoke.sh`, `scripts/workflows.test.sh` and the workflows. A new repo copies them, and its `.devcontainer/Containerfile` from basis, with `<repo>` filled in
- lot, kinetic and dazoo have no dev image: their lint runs in a pinned Node image

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
- its tag is the hash of its declared inputs (`[dev] inputs`), git's tree entries of each (`crate dev-image hash`), so one commit gives one tag on every machine
- `dev-image.yml`, on a push to main that changes `crate.toml` or an input, and by hand: it gets crate from its release, then `crate dev-image ensure` builds, smokes (`scripts/dev-image-smoke.sh`: an offline install from the cache, with no network) and pushes `:<hash>` only when ghcr lacks it, and `crate dev-image promote` points `:main` at it. The same inputs are never built twice
	- the build is tagged `<hash>-candidate` until its smoke passes, so a failed smoke leaves no image
	- a path filter is allowed: it is not a required check
- `crate dev-image local` puts a commit's image on a machine: its copy, else a pull, else a build and a smoke with no push. `crate up` and the gate call it; the factory calls it for an attempt
- used by: each workspace's tools member, the gate's check ([[ci#Merge queue]]), a check job of a repo not on crate (`crate dev-image ref`, [[ci#One command]]), and an attempt ([[assembly]])

## On GitHub

- main: always releasable. Main moves only through the gate ([[ci#Merge queue]])
- a change: one commit, or a short stack of them, pushed to its own branch. No pull request: what one carried goes in the commit message ([[changelist#Parts]]). The branch is deleted after it lands
- settings: pull requests off, and the ruleset on main ([[ci#The ruleset]])
- review: before the push, on the local diff ([[daworks/assembly/workspace/agents/cl-review|review]]). Not a GitHub approval, so approvals stay at zero
- a person's review: none by default. The plan is checked before any CL, and the build is trusted. A person reviews a CL only when the reviewer can't tell whether it meets the issue's intent ([[daworks/assembly/workspace/agents/cl-review|cl-review]])
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
	- environment: its `crate.toml`, a dev image, its services, its app and its check ([[#Environment]]), when code work here needs one. dazoo gets one when the factory runs there
	- check: lint, types, tests
	- goes out by
		- publish: [[basis]], beam-pi-extension
		- ship: [[que]] (also publishes), landl, [[deportesdecasa]], [[publicpersona]], [[stateball]], landl-db
		- apply: [[dazoo]], [[deeotee]], [[monkeyimage]]
