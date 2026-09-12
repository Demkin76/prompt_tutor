/**
 * Sinks: where the runtime streams RunnerMessages.
 *  - createArraySink: in-memory (tests; the in-process Convex fallback can wrap ctx.runMutation itself).
 *  - createConvexHttpSink: POST ${CONVEX_URL}/api/mutation {path:"runs:ingest", args:{runId, message}, format:"json"}.
 */
import type { RunnerMessage, Sink } from "../core/types";
import type { FetchLike } from "./llm";

export function createArraySink(): Sink & { messages: RunnerMessage[] } {
  const messages: RunnerMessage[] = [];
  return {
    messages,
    async push(msg) {
      messages.push(msg);
    },
  };
}

export interface ConvexHttpSinkOptions {
  convexUrl: string;
  runId: string;
  /** Convex function path, default "runs:ingest". */
  path?: string;
  /** Extra attempts after the first one (default 3). */
  retries?: number;
  /** First backoff delay; doubles each retry (default 500ms). */
  backoffMs?: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export class SinkError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "SinkError";
    this.status = status;
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function createConvexHttpSink(opts: ConvexHttpSinkOptions): Sink {
  const url = `${opts.convexUrl.replace(/\/+$/, "")}/api/mutation`;
  const path = opts.path ?? "runs:ingest";
  const retries = opts.retries ?? 3;
  const backoffMs = opts.backoffMs ?? 500;
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? (() => {});

  // Pushes are serialized even if a caller forgets to await: message order matters for the UI.
  let chain: Promise<void> = Promise.resolve();

  async function send(msg: RunnerMessage): Promise<void> {
    const body = JSON.stringify({ path, args: { runId: opts.runId, message: msg }, format: "json" });
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        const wait = backoffMs * 2 ** (attempt - 1);
        log(JSON.stringify({ level: "warn", msg: "sink retry", attempt, wait, error: lastErr?.message }));
        await sleep(wait);
      }
      let res: Response;
      try {
        res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body });
      } catch (e) {
        lastErr = new SinkError(`sink network error: ${(e as Error).message}`);
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new SinkError(`sink HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
        if (RETRYABLE_STATUS.has(res.status)) {
          lastErr = err;
          continue;
        }
        throw err;
      }
      const json = (await res.json().catch(() => ({}))) as { status?: string; errorMessage?: string };
      if (json.status === "error") throw new SinkError(`sink mutation error: ${json.errorMessage ?? "unknown"}`);
      return;
    }
    throw lastErr ?? new SinkError("sink failed");
  }

  return {
    push(msg: RunnerMessage): Promise<void> {
      const p = chain.then(() => send(msg));
      chain = p.catch(() => {});
      return p;
    },
  };
}
