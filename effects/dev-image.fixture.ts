/**
 * What an e2e repo needs for its dev image ([[repo#Dev image]]): the Containerfile whose bake stage fills the cache with
 * the lockfile's packages, and the devcontainer.json a workspace makes its container from. The e2e writes them into a
 * repo so crate makes a real image of a real lockfile, and an offline install from its cache is a real one.
 */

/** The Containerfile, built from the repo's root: the base the toolchain, the bake the cache, the last stage neither. */
export function containerfile(repo: string): string {
  return `FROM docker.io/library/node:22.23.4-slim AS base
ENV npm_config_cache=/opt/npm-cache \\
    npm_config_prefer_offline=true
RUN install -d -o node -g node /opt/npm-cache

FROM base AS bake
USER node
COPY --chown=node:node . /tmp/bake
RUN cd /tmp/bake && npm ci --ignore-scripts

FROM base
COPY --from=bake --chown=node:node /opt/npm-cache /opt/npm-cache
LABEL org.opencontainers.image.source=https://github.com/assembly-e2e/${repo}
`;
}

/** crate's smoke, after it builds the image: an offline install from the cache, with no network. */
export function smoke(): string {
  return `#!/bin/sh
# The dev image's smoke: an offline install from its cache, with no network.
set -e
cd "$(dirname "$0")/.."
npm ci --offline --no-audit --no-fund
`;
}

/** How a workspace makes its container from the dev image. */
export function devcontainer(repo: string): string {
  return `${JSON.stringify(
    {
      name: repo,
      image: `ghcr.io/assembly-e2e/${repo}-dev:main`,
      workspaceFolder: "${localWorkspaceFolder}",
      runArgs: [
        "--userns=keep-id:uid=1000,gid=1000",
        "--cpus=3",
        "--cpu-shares=256",
      ],
      remoteUser: "node",
      updateRemoteUserUID: false,
    },
    null,
    2,
  )}\n`;
}

/** The crate.toml of an e2e repo checked in its dev image: crate takes the image's name and its inputs from it. */
export const devToml = (repo: string): string =>
  `crate = "1"\nname = "${repo}"\nimage = "dev"\n\n[dev]\ninputs = [".devcontainer/Containerfile", "package-lock.json"]\n`;
