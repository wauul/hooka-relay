import { Webhook } from "standardwebhooks";
import type { EventInput, EventResponse } from "./generated.js";
export type { EventInput, EventResponse, ErrorResponse, JsonValue } from "./generated.js";
export { WebhookVerificationError } from "standardwebhooks";

export class HookaError extends Error {
  constructor(public readonly status: number, public readonly body: unknown, public readonly retryAfter: string | null) {
    super(`Hooka Relay returned HTTP ${status}`);
    this.name = "HookaError";
  }
}

export interface ClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

/** Server-side client. Keep API keys out of browser bundles. No implicit retries. */
export class HookaRelay {
  private readonly url: string;
  private readonly transport: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  constructor(private readonly apiKey: string, options: ClientOptions = {}) {
    if (!apiKey || /[\r\n]/.test(apiKey)) throw new TypeError("An API key is required");
    const base = new URL(options.baseUrl ?? "https://hooka-relay.vercel.app");
    if (base.username || base.password || !["https:", "http:"].includes(base.protocol)) throw new TypeError("Invalid base URL");
    if (base.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) throw new TypeError("Use HTTPS outside localhost");
    this.url = new URL("/api/v1/events", base).href;
    this.transport = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) throw new TypeError("Invalid timeout");
  }
  async sendEvent(input: EventInput & { customerId: string }): Promise<EventResponse> {
    const response = await this.transport(this.url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(this.timeoutMs),
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = text; }
    if (response.status !== 202) throw new HookaError(response.status, body, response.headers.get("retry-after"));
    if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string") throw new Error("Invalid Hooka Relay event response");
    return body as EventResponse;
  }
}

/** Verify exact raw bytes, including the signed event ID and five-minute clock window. */
export function verifyWebhook(rawBody: string | Buffer, headers: Record<string, string>, secret: string): unknown {
  return new Webhook(secret).verify(rawBody, headers);
}
