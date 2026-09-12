import { describe, expect, it, vi } from "vitest";
import type { RunnerMessage } from "@core/types";
import { SinkError, createArraySink, createConvexHttpSink } from "./sink";

const msg: RunnerMessage = { kind: "error", message: "hello" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("createConvexHttpSink", () => {
  it("POSTs to /api/mutation with the runs:ingest envelope", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "success", value: null }));
    const sink = createConvexHttpSink({ convexUrl: "https://abc.convex.cloud/", runId: "run-9", fetchImpl });
    await sink.push(msg);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://abc.convex.cloud/api/mutation");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      path: "runs:ingest",
      args: { runId: "run-9", message: msg },
      format: "json",
    });
  });

  it("retries 3 times with backoff on network errors, then succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      if (n <= 3) throw new Error("ECONNRESET");
      return jsonResponse({ status: "success" });
    });
    const sleeps: number[] = [];
    const sink = createConvexHttpSink({
      convexUrl: "https://x.convex.cloud",
      runId: "r",
      fetchImpl,
      backoffMs: 100,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await sink.push(msg);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([100, 200, 400]);
  });

  it("gives up after the retries are exhausted", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("down");
    });
    const sink = createConvexHttpSink({ convexUrl: "https://x.convex.cloud", runId: "r", fetchImpl, sleep: async () => {} });
    await expect(sink.push(msg)).rejects.toThrow(/sink network error: down/);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("retries 5xx but not 4xx", async () => {
    let n = 0;
    const flaky = vi.fn(async () => (n++ === 0 ? jsonResponse({}, 503) : jsonResponse({ status: "success" })));
    const s1 = createConvexHttpSink({ convexUrl: "https://x.convex.cloud", runId: "r", fetchImpl: flaky, sleep: async () => {} });
    await s1.push(msg);
    expect(flaky).toHaveBeenCalledTimes(2);

    const bad = vi.fn(async () => new Response("no such function", { status: 400 }));
    const s2 = createConvexHttpSink({ convexUrl: "https://x.convex.cloud", runId: "r", fetchImpl: bad, sleep: async () => {} });
    await expect(s2.push(msg)).rejects.toThrow(SinkError);
    await expect(s2.push(msg)).rejects.toThrow(/sink HTTP 400: no such function/);
    expect(bad).toHaveBeenCalledTimes(2);
  });

  it("surfaces Convex-level mutation errors", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "error", errorMessage: "run not found" }));
    const sink = createConvexHttpSink({ convexUrl: "https://x.convex.cloud", runId: "r", fetchImpl });
    await expect(sink.push(msg)).rejects.toThrow("sink mutation error: run not found");
  });

  it("keeps pushes in order even when not awaited", async () => {
    const order: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { args: { message: { kind: string; message: string } } };
      // make the first request slower than the second
      await new Promise((r) => setTimeout(r, body.args.message.message === "a" ? 20 : 1));
      order.push(body.args.message.message);
      return jsonResponse({ status: "success" });
    });
    const sink = createConvexHttpSink({ convexUrl: "https://x.convex.cloud", runId: "r", fetchImpl });
    const p1 = sink.push({ kind: "error", message: "a" });
    const p2 = sink.push({ kind: "error", message: "b" });
    await Promise.all([p1, p2]);
    expect(order).toEqual(["a", "b"]);
  });
});

describe("createArraySink", () => {
  it("collects messages", async () => {
    const s = createArraySink();
    await s.push(msg);
    expect(s.messages).toEqual([msg]);
  });
});
