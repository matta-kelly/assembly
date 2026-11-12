/**
 * A stand-in npm registry for the e2e: the outside thing a cl waits on, played by the test. An HTTP server in a container
 * on the host's network serves a folder, and npm's `--registry` points at its URL. A version is published the way a
 * repo's publish workflow would: the package is packed, and its packument and tarball are written. The orchestrator's
 * registry asks the same folder.
 *
 * The URL is the host's own address, which a container reaches whether it runs on the default network or the host's.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The image the server runs in: the e2e's own Node image, which the host already has. */
const image = "docker.io/library/node:22.23.4-slim";

/** The port it listens on, on the host's network. */
const port = 4873;

/** Its container's name: removed at the end of the test, and before it starts. */
const name = "assembly-e2e-registry";

type Packument = {
  name: string;
  "dist-tags": Record<string, string>;
  versions: Record<string, Record<string, unknown>>;
};

/** The server, as the folder holds it: a packument per package name, and the tarballs beside it. */
const serve = `import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.env.ROOT ?? ".";
const send = (res, code, body, type) => {
  res.writeHead(code, { "content-type": type });
  res.end(body);
};

createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  try {
    if (path.startsWith("/tgz/")) {
      send(res, 200, await readFile(join(root, path)), "application/octet-stream");
      return;
    }
    const index = JSON.parse(await readFile(join(root, "index.json"), "utf8"));
    const packument = index[path.slice(1)];
    if (!packument) {
      send(res, 404, "{}", "application/json");
      return;
    }
    send(res, 200, JSON.stringify(packument), "application/json");
  } catch {
    send(res, 404, "{}", "application/json");
  }
}).listen(${port}, "0.0.0.0");
`;

export interface StandIn {
  /** The registry's base URL: npm's `--registry`, and the orchestrator's registry. */
  url: string;
  /** Publishes `folder`'s package as `name@version`, as a publish workflow would, and gives its lockfile entry. */
  add(
    name: string,
    version: string,
    folder: string,
  ): { resolved: string; integrity: string };
  /** Whether the version is in the registry: what the orchestrator's registry asks. */
  published(name: string, version: string): boolean;
  /** Removes the server. */
  close(): void;
}

/** The host's own address, as a container on the host's network sees it. */
function hostAddress(): string {
  const probe =
    'const s = require("node:dgram").createSocket("udp4");s.connect(53, "1.1.1.1", () => {console.log(s.address().address); s.close();});';
  const ran = execFileSync(
    "podman",
    ["run", "--rm", "--network=host", image, "node", "-e", probe],
    { encoding: "utf8", timeout: 120_000 },
  ).trim();
  // A host with no address off its loopback is the one case a container reaches by name.
  return /^\d+\.\d+\.\d+\.\d+$/.test(ran) && !ran.startsWith("127.")
    ? ran
    : "host.containers.internal";
}

/** Starts the registry over `dir`, which must be an empty folder on a host path. */
export function standInRegistry(dir: string): StandIn {
  mkdirSync(join(dir, "tgz"), { recursive: true });
  writeFileSync(join(dir, "index.json"), "{}");
  writeFileSync(join(dir, "serve.mjs"), serve);
  const url = `http://${hostAddress()}:${port}`;
  const index = (): Record<string, Packument> =>
    JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as Record<
      string,
      Packument
    >;
  const write = (i: Record<string, Packument>) =>
    writeFileSync(join(dir, "index.json"), JSON.stringify(i));

  execFileSync("podman", ["rm", "--force", "--ignore", name], {
    stdio: "ignore",
    timeout: 60_000,
  });
  execFileSync(
    "podman",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "--network=host",
      "-v",
      `${dir}:${dir}:ro`,
      "-w",
      dir,
      "-e",
      `ROOT=${dir}`,
      image,
      "node",
      join(dir, "serve.mjs"),
    ],
    { stdio: "ignore", timeout: 120_000 },
  );
  // It answers as soon as it listens: a name it has not heard of is a 404, which is an answer.
  for (let i = 0; i < 40; i++) {
    try {
      execFileSync(
        "podman",
        [
          "exec",
          name,
          "node",
          "-e",
          `fetch("http://127.0.0.1:${port}/").then(() => process.exit(0), () => process.exit(1));`,
        ],
        { stdio: "ignore", timeout: 5_000 },
      );
      return {
        url,
        add: (pkg, version, folder) => {
          const dest = mkdtempSync(join(dir, "pack-"));
          const file = execFileSync(
            "npm",
            ["pack", "--pack-destination", dest, "--silent"],
            { cwd: folder, encoding: "utf8", timeout: 120_000 },
          )
            .trim()
            .split("\n")
            .at(-1);
          const tgz = readFileSync(join(dest, file ?? ""));
          const at = `${pkg.replace(/[^a-z0-9]+/gi, "-")}-${version}.tgz`;
          writeFileSync(join(dir, "tgz", at), tgz);
          const integrity = `sha512-${createHash("sha512").update(tgz).digest("base64")}`;
          const resolved = `${url}/tgz/${at}`;
          const manifest = JSON.parse(
            readFileSync(join(folder, "package.json"), "utf8"),
          ) as Record<string, unknown>;
          const all = index();
          const packument = (all[pkg] ??= {
            name: pkg,
            "dist-tags": {},
            versions: {},
          });
          packument.versions[version] = {
            ...manifest,
            name: pkg,
            version,
            _id: `${pkg}@${version}`,
            dist: {
              tarball: resolved,
              integrity,
              shasum: createHash("sha1").update(tgz).digest("hex"),
            },
          };
          packument["dist-tags"] = { latest: version };
          write(all);
          return { resolved, integrity };
        },
        published: (pkg, version) =>
          index()[pkg]?.versions[version] !== undefined,
        close: () =>
          execFileSync("podman", ["rm", "--force", "--ignore", name], {
            stdio: "ignore",
            timeout: 60_000,
          }),
      };
    } catch {
      execFileSync("sleep", ["0.25"]);
    }
  }
  throw new Error(`the stand-in registry did not start at ${url}`);
}
