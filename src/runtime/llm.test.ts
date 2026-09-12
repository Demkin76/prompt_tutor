import { describe, expect, it, vi } from "vitest";
import { DECISION_JSON_SCHEMA } from "./prompt";
import { LlmError, createFakeLlm, createXaiClient } from "./llm";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("createXaiClient", () => {
  it("sends an OpenAI-style chat completion with json_schema response_format", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '{"intent":"x"}' } }] }));
    const client = createXaiClient({ apiKey: "k", fetchImpl });
    const res = await client.complete({ system: "SYS", user: "USR", jsonSchema: DECISION_JSON_SCHEMA });
    expect(res.text).toBe('{"intent":"x"}');
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("grok-4-fast");
    expect(body.temperature).toBe(0.2);
    expect(typeof body.max_tokens).toBe("number");
    expect(body.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "USR" },
    ]);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "decision", schema: DECISION_JSON_SCHEMA, strict: true },
    });
  });

  it("honours model and baseUrl overrides", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "{}" } }] }));
    const client = createXaiClient({ apiKey: "k", model: "grok-3-mini", baseUrl: "https://proxy.local/v1/", fetchImpl });
    await client.complete({ system: "s", user: "u", jsonSchema: {} });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://proxy.local/v1/chat/completions");
    expect(JSON.parse(init.body as string).model).toBe("grok-3-mini");
  });

  it("throws with status and body snippet on non-2xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limited, slow down", { status: 429 }));
    const client = createXaiClient({ apiKey: "k", fetchImpl });
    const p = client.complete({ system: "s", user: "u", jsonSchema: {} });
    await expect(p).rejects.toThrow(LlmError);
    await expect(p).rejects.toThrow("LLM HTTP 429: rate limited, slow down");
  });

  it("throws when the response has no content", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [] }));
    const client = createXaiClient({ apiKey: "k", fetchImpl });
    await expect(client.complete({ system: "s", user: "u", jsonSchema: {} })).rejects.toThrow(/no choices/);
  });

  it("aborts on timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const client = createXaiClient({ apiKey: "k", fetchImpl });
    await expect(client.complete({ system: "s", user: "u", jsonSchema: {}, timeoutMs: 10 })).rejects.toThrow(/timed out after 10ms/);
  });

  it("requires an api key", () => {
    expect(() => createXaiClient({ apiKey: "" })).toThrow(/API key/);
  });
});

describe("createFakeLlm", () => {
  it("serializes the decider output as JSON text", async () => {
    const llm = createFakeLlm(() => ({ intent: "i", plan: [{ type: "wait" }], stopOn: [] }));
    const res = await llm.complete({ system: "", user: "<<<CHARTER>>>\nc\n<<<END CHARTER>>>", jsonSchema: {} });
    expect(JSON.parse(res.text)).toEqual({ intent: "i", plan: [{ type: "wait" }], stopOn: [] });
  });
});
