/** The npm registry, asked whether a version of a package is published. Only the orchestrator asks it. */

export interface Registry {
  /** The registry's base URL, as npm is given it: `--registry`, when a cl's package moves. */
  url: string;
  published(name: string, version: string): Promise<boolean>;
}

/** npm's own registry: where a moved package is installed from, unless a test stands one in. */
export const npmRegistryUrl = "https://registry.npmjs.org";

/** The real registry: `GET <url>/<name>/<version>`, 200 or 404. `fetch` is the HTTP call. */
export function npmRegistry(http: typeof fetch = fetch): Registry {
  return {
    url: npmRegistryUrl,
    async published(name, version) {
      const url = `${npmRegistryUrl}/${name}/${version}`;
      const res = await http(url, { signal: AbortSignal.timeout(10_000) });
      if (res.status === 200) return true;
      if (res.status === 404) return false;
      throw new Error(`npm answered ${res.status} for ${name}@${version}`);
    },
  };
}
