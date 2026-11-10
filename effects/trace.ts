/**
 * The trace: each attempt as one OpenTelemetry trace, written as OTLP JSON to the attempt's folder
 * (runs/.../<n>/trace.jsonl, one export request per line). Evals, grading and review read these files later, and any
 * OTLP backend can load them. The ledger holds the hierarchy (issue, plan, cl, attempt) and each attempt's trace and
 * span ids.
 *
 * The run is que-pasa's to trace, and the attempt is assembly's:
 * - que-pasa emits the run live, in the GenAI conventions: an invoke_agent span for each process that works on it,
 *   a chat span per model call and an execute_tool span per tool call, with the messages (content is on). It does so
 *   through the OpenTelemetry API, under the span that is active when the run starts.
 * - the attempt span is the root, and holds what only assembly knows: the issue, cl, attempt, step and word, cause
 *   and cost, the end commit and the sandbox's image, and links to the runs a review judged. Its ids are made when the
 *   attempt begins and kept in the ledger, so every process that works on the attempt runs under the same span, and
 *   the span itself is written once, when the attempt ends: a crash cannot lose it.
 * - the check span, a child of the attempt span: the test run the step's check made.
 *
 * One orchestrator per process: `openTracing` registers the process's tracer provider, whose exporter writes each
 * span to its attempt's file, found by its trace id.
 */

import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  type Attributes,
  type Link,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  context,
  trace,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { type ExportResult, ExportResultCode } from "@opentelemetry/core";
import { JsonTraceSerializer } from "@opentelemetry/otlp-transformer";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  type IdGenerator,
  RandomIdGenerator,
  type ReadableSpan,
  SimpleSpanProcessor,
  type SpanExporter,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import {
  ATTR_ERROR_TYPE,
  ATTR_SERVICE_NAME,
} from "@opentelemetry/semantic-conventions";
import {
  ATTR_CONTAINER_IMAGE_ID,
  ATTR_CONTAINER_IMAGE_NAME,
} from "@opentelemetry/semantic-conventions/incubating";
import type { CheckRun, Message, Run } from "../process/step.ts";
import type { Usage } from "../orchestrator/ledger.ts";
import type { State } from "../process/table.ts";

export const schemaUrl = "https://opentelemetry.io/schemas/1.43.0";

/** A span by its ids: the attempt span, made when the attempt begins, or one a link points at. */
export interface SpanRef {
  traceId: string;
  spanId: string;
}

/** Where an attempt's trace is written. */
export const traceFile = (r: Pick<Run, "dir">) => join(r.dir, "trace.jsonl");

/** New ids for an attempt span: a trace of its own. */
export const newSpan = (): SpanRef => ({
  traceId: randomBytes(16).toString("hex"),
  spanId: randomBytes(8).toString("hex"),
});

// The attempt span is written with the ids it was given when it began: while `given` is set, around the one
// startSpan that writes it, the provider's id generator hands out those, and random ones otherwise.
let given: SpanRef | undefined;
const random = new RandomIdGenerator();
const ids: IdGenerator = {
  generateTraceId: () => given?.traceId ?? random.generateTraceId(),
  generateSpanId: () => given?.spanId ?? random.generateSpanId(),
};

/** Writes each span to its attempt's file. `folderOf` finds the attempt's folder by its trace id. */
class AttemptFiles implements SpanExporter {
  private folderOf: (traceId: string) => string | undefined;

  constructor(folderOf: (traceId: string) => string | undefined) {
    this.folderOf = folderOf;
  }

  export(spans: ReadableSpan[], done: (r: ExportResult) => void) {
    try {
      const byTrace = new Map<string, ReadableSpan[]>();
      for (const s of spans) {
        const id = s.spanContext().traceId;
        byTrace.set(id, [...(byTrace.get(id) ?? []), s]);
      }
      for (const [traceId, group] of byTrace) {
        const dir = this.folderOf(traceId);
        if (!dir) {
          console.error(`a span of trace ${traceId} has no attempt`);
          continue;
        }
        const body = JsonTraceSerializer.serializeRequest(group);
        if (!body) continue;
        mkdirSync(dir, { recursive: true });
        appendFileSync(
          traceFile({ dir }),
          new TextDecoder().decode(body) + "\n",
        );
      }
      done({ code: ExportResultCode.SUCCESS });
    } catch (e) {
      done({ code: ExportResultCode.FAILED, error: e as Error });
    }
  }

  shutdown() {
    return Promise.resolve();
  }
}

let folders: (traceId: string) => string | undefined = () => undefined;
let provider: TracerProvider | undefined;

/**
 * Registers the process's tracing: the provider, its exporter to the attempts' files, and the context manager
 * que-pasa reads the active span through. Once per process; a second call only changes where spans go.
 */
export function openTracing(folderOf: (traceId: string) => string | undefined) {
  folders = folderOf;
  if (provider) return;
  provider = new TracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "assembly" }),
    idGenerator: ids,
    spanProcessors: [
      new SimpleSpanProcessor({
        exporter: new AttemptFiles((t) => folders(t)),
      }),
    ],
  });
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  trace.setGlobalTracerProvider(provider);
}

const tracer = () =>
  trace.getTracerProvider().getTracer("assembly", undefined, { schemaUrl });

/** The context with the attempt span as its active span, though the span is written only at the end. */
const inAttempt = (s: SpanRef) =>
  trace.setSpan(
    ROOT_CONTEXT,
    trace.wrapSpanContext({ ...s, traceFlags: 1, isRemote: false }),
  );

/** Runs `f` under the attempt span: que-pasa's run, started in it, keeps its ids for every segment. */
export const within = <T>(s: SpanRef, f: () => T): T =>
  context.with(inAttempt(s), f);

/** The check's test run, as a child of the attempt span. */
export function checkSpan(s: SpanRef, step: State, ran: CheckRun) {
  const check = tracer().startSpan(
    `check ${step}`,
    {
      kind: SpanKind.INTERNAL,
      startTime: ran.at,
      attributes: {
        "assembly.check.command": ran.command,
        "assembly.check.image": ran.image,
        "assembly.check.tree": ran.tree,
        "assembly.check.input_hash": ran.input,
        "assembly.check.exit_code": ran.code,
      },
    },
    inAttempt(s),
  );
  if (ran.code !== 0) check.setStatus({ code: SpanStatusCode.ERROR });
  check.end(ran.at + ran.ms);
}

/** How the attempt ended, and what only assembly knows of it: its attempt span's attributes and links. */
export interface Outcome {
  run: Run;
  step: State;
  agent: string;
  started: number; // ms since the epoch, when the attempt began
  message: Message;
  usage?: Usage;
  error?: string;
  commit?: string; // the worktree's HEAD when the attempt ended
  imageId?: string; // the sandbox image's id: with the commit, the run's whole environment
  judged: SpanRef[];
  resumed?: number; // how many times the attempt was taken up by a new orchestrator
}

/** Writes the attempt span, with the ids it began with: the root of the attempt's trace. */
export function endAttempt(s: SpanRef, o: Outcome) {
  const r = o.run;
  const attributes: Attributes = {
    "assembly.issue.id": r.issue,
    "assembly.item": r.name,
    "assembly.item.kind": r.kind,
    "assembly.attempt": r.n,
    "assembly.step": o.step,
    "assembly.agent": o.agent,
    "assembly.word": o.message.word,
    "assembly.reason": o.message.reason,
    // a span attribute, not the resource's: one process runs attempts of many repos, each on its own image
    [ATTR_CONTAINER_IMAGE_NAME]: r.image,
  };
  if (r.kind === "cl") attributes["assembly.cl.id"] = r.name;
  if (o.message.cause) attributes["assembly.cause"] = o.message.cause;
  if (o.usage?.cost !== undefined) attributes["assembly.cost"] = o.usage.cost;
  if (o.commit) attributes["assembly.commit"] = o.commit;
  if (o.imageId) attributes[ATTR_CONTAINER_IMAGE_ID] = o.imageId;
  if (o.resumed) attributes["assembly.resumed"] = o.resumed;
  const links: Link[] = o.judged.map((j) => ({
    context: { ...j, traceFlags: 1 },
  }));
  given = s;
  const span = tracer().startSpan(
    `attempt ${o.step} ${r.name}`,
    { kind: SpanKind.INTERNAL, startTime: o.started, attributes, links },
    ROOT_CONTEXT,
  );
  given = undefined;
  if (o.error) {
    span.setAttribute(ATTR_ERROR_TYPE, "attempt_failed");
    span.setStatus({ code: SpanStatusCode.ERROR, message: o.error });
  }
  span.end();
}
