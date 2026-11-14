import { describe, expect, it, vi } from "vitest";
import { npmRegistry } from "./registry.ts";

const answer = (status: number) =>
  vi.fn<(url: string | URL | Request) => Promise<Response>>(
    async () => new Response("{}", { status }),
  );

describe("npmRegistry", () => {
  it("says a version is published when npm answers 200, asking for that name and version", async () => {
    const http = answer(200);
    expect(await npmRegistry(http).published("left-pad", "1.3.0")).toBe(true);
    expect(String(http.mock.calls[0]?.[0])).toBe(
      "https://registry.npmjs.org/left-pad/1.3.0",
    );
    const other = answer(200);
    expect(await npmRegistry(other).published("zod", "4.6.7")).toBe(true);
    expect(String(other.mock.calls[0]?.[0])).toBe(
      "https://registry.npmjs.org/zod/4.6.7",
    );
  });

  it("says a version is not published when npm answers 404", async () => {
    expect(await npmRegistry(answer(404)).published("left-pad", "9.9.9")).toBe(
      false,
    );
    expect(await npmRegistry(answer(404)).published("zod", "0.0.1")).toBe(
      false,
    );
  });

  it("throws an error naming the package and version when npm answers neither 200 nor 404", async () => {
    await expect(
      npmRegistry(answer(500)).published("left-pad", "1.3.0"),
    ).rejects.toThrow(/left-pad.*1\.3\.0/);
    await expect(
      npmRegistry(answer(429)).published("@s/alpha", "2.0.1"),
    ).rejects.toThrow(/@s\/alpha.*2\.0\.1/);
  });

  it("gives the call a time limit: a signal that has not fired yet", async () => {
    const http = vi.fn<
      (url: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async () => new Response("{}", { status: 200 }));
    await npmRegistry(http).published("left-pad", "1.3.0");
    const signal = http.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });
});
