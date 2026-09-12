/**
 * LLM clients. `createXaiClient` talks to x.ai's OpenAI-compatible chat completions API with
 * JSON-schema structured output. `createFakeLlm` is for tests / offline demos.
 */
import type { AgentDecision, LlmClient, LlmRequest, LlmResponse, Observation } from "../core/types";
import { ASCII_MARKER, CHARTER_CLOSE, CHARTER_OPEN, OBSERVATION_MARKER, USER_PROMPT_TAIL } from "./prompt";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface XaiClientOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: FetchLike;
}

export const DEFAULT_XAI_MODEL = "grok-4-fast";
export const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_TOKENS = 600;

export class LlmError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

export function createXaiClient(opts: XaiClientOptions): LlmClient {
  const model = opts.model ?? DEFAULT_XAI_MODEL;
  const baseUrl = (opts.baseUrl ?? DEFAULT_XAI_BASE_URL).replace(/\/+$/, "");
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  if (!opts.apiKey) throw new LlmError("x.ai API key is missing");

  return {
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const controller = new AbortController();
      const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const started = Date.now();
      const body = {
        model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        temperature: 0.2,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        response_format: {
          type: "json_schema",
          json_schema: { name: "decision", schema: req.jsonSchema, strict: true },
        },
      };
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e) {
        const msg = controller.signal.aborted
          ? `LLM request timed out after ${timeoutMs}ms`
          : `LLM request failed: ${(e as Error).message}`;
        throw new LlmError(msg);
      } finally {
        clearTimeout(timer);
      }
      const latencyMs = Date.now() - started;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new LlmError(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
      }
      const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new LlmError("LLM response has no choices[0].message.content");
      return { text: content, latencyMs };
    },
  };
}

/** Deterministic fake: derives a decision from the observation and charter found in the user prompt. */
export function createFakeLlm(decider: (obs: Observation, charter: string) => AgentDecision): LlmClient {
  return {
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const { charter, obs } = parseUserPrompt(req.user);
      const decision = decider(obs, charter);
      return { text: JSON.stringify(decision), latencyMs: 0 };
    },
  };
}

/** Inverse of buildUserPrompt (best effort; used by the fake client only). */
export function parseUserPrompt(user: string): { charter: string; obs: Observation } {
  const a = user.indexOf(CHARTER_OPEN);
  const b = user.indexOf(CHARTER_CLOSE);
  const charter = a >= 0 && b > a ? user.slice(a + CHARTER_OPEN.length, b).trim() : "";

  let obs = {} as Observation;
  const m = user.indexOf(OBSERVATION_MARKER + "\n");
  if (m >= 0) {
    const line = user.slice(m + OBSERVATION_MARKER.length + 1).split("\n")[0];
    try {
      obs = JSON.parse(line) as Observation;
    } catch {
      obs = {} as Observation;
    }
  }
  const v = user.indexOf(ASCII_MARKER + "\n");
  if (v >= 0) {
    const rest = user.slice(v + ASCII_MARKER.length + 1);
    const end = rest.lastIndexOf("\n\n" + USER_PROMPT_TAIL);
    obs.asciiView = end >= 0 ? rest.slice(0, end) : rest;
  }
  return { charter, obs };
}
