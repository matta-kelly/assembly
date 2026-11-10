import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { context, trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Run } from "../process/step.ts";
import {
  checkSpan,
  endAttempt,
  newSpan,
  openTracing,
  schemaUrl,
  type SpanRef,
  traceFile,
  within,
} from "./trace.ts";

type Span = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string;
  attributes: { key: string; value: Record<string, unknown> }[];
  links?: { traceId: string; spanId: string }[];
};

const attr = (s: Span, key: string) => {
  const v = s.attributes.find((a) => a.key === key)?.value;
  return v && Object.values(v)[0];
};

let dir: string;
let run: Run;
let attempt: SpanRef;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "trace-"));
  run = {
    name: "is-value",
    kind: "cl",
    issue: "is",
    seq: 1,
    n: 2,
    path: "",
    repo: "",
    image: "node:22",
    test: "",
    setup: "",
    dir: join(dir, "runs", "is", "cl", "value", "2"),
    work: "",
  };
  attempt = newSpan();
  openTracing((t) => (t === attempt.traceId ? run.dir : undefined));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Every span written to the attempt's file, over all its lines. */
function written() {
  const lines = readFileSync(traceFile(run), "utf8").trim().split("\n");
  return lines.flatMap((line) => {
    const req = JSON.parse(line) as {
      resourceSpans: {
        scopeSpans: { schemaUrl: string; spans: Span[] }[];
      }[];
    };
    return req.resourceSpans.flatMap((r) =>
      r.scopeSpans.flatMap((s) =>
        s.spans.map((span) => ({ ...span, schemaUrl: s.schemaUrl })),
      ),
    );
  });
}

const outcome = {
  step: "ready" as const,
  agent: "da-nail",
  started: 1000,
  message: {
    word: "pass" as const,
    reason: "red at an assertion",
    findings: [],
  },
  judged: [],
};

describe("the attempt's trace", () => {
  it("writes the attempt span with the ids it began with, as the trace's root, holding what only assembly knows", () => {
    endAttempt(attempt, {
      ...outcome,
      run,
      usage: { cost: 0.002 },
      commit: "abc123",
      imageId: "sha256:1d2e",
      resumed: 1,
    });
    const [root] = written();
    expect(root).toMatchObject({
      traceId: attempt.traceId,
      spanId: attempt.spanId,
      name: "attempt ready is-value",
      schemaUrl,
    });
    expect(root?.parentSpanId).toBeFalsy();
    const r = root as Span;
    expect(attr(r, "assembly.issue.id")).toBe("is");
    expect(attr(r, "assembly.cl.id")).toBe("is-value");
    expect(attr(r, "assembly.attempt")).toBe(2);
    expect(attr(r, "assembly.word")).toBe("pass");
    expect(attr(r, "assembly.commit")).toBe("abc123");
    expect(attr(r, "assembly.resumed")).toBe(1);
    expect(attr(r, "container.image.name")).toBe("node:22");
    expect(attr(r, "container.image.id")).toBe("sha256:1d2e");
  });

  it("runs a run under the attempt span, so its spans are the attempt's children", () => {
    const seen = within(attempt, () => trace.getSpanContext(context.active()));
    expect(seen).toMatchObject(attempt);
  });

  it("writes the check's test run as a child of the attempt span", () => {
    checkSpan(attempt, "ready", {
      command: "node --test",
      image: "node:22",
      tree: "4b825dc",
      input: "abc",
      code: 1,
      at: 1500,
      ms: 300,
    });
    const [check] = written();
    expect(check).toMatchObject({
      traceId: attempt.traceId,
      parentSpanId: attempt.spanId,
      name: "check ready",
      startTimeUnixNano: String(1500 * 1e6),
    });
    expect(attr(check as Span, "assembly.check.exit_code")).toBe(1);
  });

  it("links a review's attempt to the attempts it judged, and marks one that failed", () => {
    const judged = newSpan();
    endAttempt(attempt, {
      ...outcome,
      run,
      step: "green",
      message: {
        word: "retry",
        reason: "the attempt failed: no submit",
        findings: [],
      },
      error: "no submit",
      judged: [judged],
    });
    const [root] = written();
    expect(root?.links?.map((l) => [l.traceId, l.spanId])).toEqual([
      [judged.traceId, judged.spanId],
    ]);
    expect(attr(root as Span, "error.type")).toBe("attempt_failed");
  });
});
