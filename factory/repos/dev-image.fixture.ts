/**
 * What an e2e repo needs for its dev image ([[repo#Dev image]]): the Containerfile whose bake stage fills the cache with
 * the lockfile's packages, and the crate.toml whose [tools] setup is the smoke crate runs in it, with no network. The e2e
 * writes them into a repo so crate makes a real image of a real lockfile, and an offline install from its cache is a
 * real one.
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

/**
 * The dev image of an e2e repo with no packages: node, and nothing of the checkout. Its crate.toml has no setup.
 */
export const plainContainerfile = (repo: string): string =>
  `FROM docker.io/library/node:22.23.4-slim\nLABEL org.opencontainers.image.source=https://github.com/assembly-e2e/${repo}\n`;

/** The crate.toml of an e2e repo with no packages, checked and worked in its plain dev image. */
export const plainToml = (repo: string): string =>
  `crate = "3"\nname = "${repo}"\nimage = "dev"\n\n[dev]\ninputs = [".crate/Containerfile"]\n`;

/**
 * The crate.toml of an e2e repo checked in its dev image: crate takes the image's name and its inputs from it, and
 * runs its [tools] setup in a new image with no network, its smoke.
 */
export const devToml = (repo: string): string =>
  `crate = "1"\nname = "${repo}"\nimage = "dev"\n\n[dev]\ninputs = [".crate/Containerfile", "package-lock.json"]\n\n[tools]\nsetup = "npm ci"\n`;
