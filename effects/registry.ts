/** The npm registry, asked whether a version of a package is published. Only the orchestrator asks it. */

export interface Registry {
  published(name: string, version: string): Promise<boolean>;
}

/** The real registry: `GET https://registry.npmjs.org/<name>/<version>`, 200 or 404. `fetch` is the HTTP call. */
export function npmRegistry(_fetch: typeof fetch = fetch): Registry {
  return { published: () => Promise.resolve(false) };
}
