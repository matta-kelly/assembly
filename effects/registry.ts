/** The npm registry, asked whether a version of a package is published. Only the orchestrator asks it. */

export interface Registry {
  published(name: string, version: string): Promise<boolean>;
}

/** The real registry: `GET https://registry.npmjs.org/<name>/<version>`, 200 or 404. `fetch` is the HTTP call. */
export function npmRegistry(http: typeof fetch = fetch): Registry {
  return {
    async published(name, version) {
      const url = `https://registry.npmjs.org/${name}/${version}`;
      const res = await http(url, { signal: AbortSignal.timeout(10_000) });
      if (res.status === 200) return true;
      if (res.status === 404) return false;
      throw new Error(`npm answered ${res.status} for ${name}@${version}`);
    },
  };
}
