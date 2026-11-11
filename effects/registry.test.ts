import { describe, expect, it, vi } from "vitest";
import { npmRegistry } from "./registry.ts";

const answer = (status: number) =>
  vi.fn(async (_url: string | URL | Request) => new Response("{}", { status }));

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
});
