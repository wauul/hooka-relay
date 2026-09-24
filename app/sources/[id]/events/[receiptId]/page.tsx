"use client";
import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { Shell } from "@/components/shell";
import { Badge, CodeBlock, ErrorBox, useData, api } from "@/components/ui";
import { useConfirm } from "@/components/site-tools";

type Attempt = { id: string; status: string; attemptNumber?: number; httpStatusCode: number | null; durationMs: number | null; error: string | null; responseBody: string | null; requestBody?: string | null; requestHeaders?: unknown; responseHeaders?: unknown; createdAt: string; replayId?: string | null };
type Detail = { id: string; sourceId: string; sourceName: string; eventId: string | null; provider: string; eventType: string | null; verified: boolean; failureReason: string | null; receivedAt: string; rawHeaders: Record<string, string>; rawBody: string | null; deliveries: { id: string; generation: number; status: string; endpoint: { url: string } }[]; attempts: Attempt[]; liveAttempts: Attempt[]; replays: { id: string; userId: string; generation: number | null; createdAt: string }[] };
function pretty(value: string | null) { if (!value) return ""; try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } }
function highlightedJson(value: string) {
  const pattern = /("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?\b)/g;
  const parts: React.ReactNode[] = []; let from = 0; let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    parts.push(value.slice(from, match.index));
    const token = match[0];
    parts.push(<span key={match.index} className={token.startsWith('"') ? (/^\s*:/.test(value.slice(pattern.lastIndex)) ? "json-key" : "json-string") : /^[tfn]/.test(token) ? "json-keyword" : "json-number"}>{token}</span>);
    from = pattern.lastIndex;
  }
  parts.push(value.slice(from)); return parts;
}
function AttemptCard({ attempt, title }: { attempt: Attempt; title: string }) {
  return <section className="panel"><div className="panel-head"><div><h3>{title}</h3><small className="muted">{new Date(attempt.createdAt).toLocaleString()} · HTTP {attempt.httpStatusCode ?? "—"} · {attempt.durationMs ?? "—"} ms</small></div><Badge value={attempt.status} /></div><div className="panel-body">{attempt.error && <p className="muted">{attempt.error}</p>}{attempt.requestHeaders != null && <><label>Request headers</label><CodeBlock>{JSON.stringify(attempt.requestHeaders, null, 2)}</CodeBlock></>}{attempt.requestBody && <><label>Request body</label><CodeBlock>{attempt.requestBody}</CodeBlock></>}{attempt.responseHeaders != null && <><label>Response headers</label><CodeBlock>{JSON.stringify(attempt.responseHeaders, null, 2)}</CodeBlock></>}{attempt.responseBody && <><label>Response body</label><CodeBlock>{attempt.responseBody}</CodeBlock></>}</div></section>;
}
export default function Page({ params }: { params: Promise<{ id: string; receiptId: string }> }) {
  const { id, receiptId } = use(params);
  const { data, error, reload } = useData<Detail>(`/api/sources/${id}/receipts/${receiptId}`, true);
  const confirmAction = useConfirm();
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(""), [notice, setNotice] = useState("");
  const body = pretty(data?.rawBody || null);
  return <Shell><Link className="back" href={`/sources/${id}`}><ArrowLeft size={14} /> {data?.sourceName || "Webhook source"}</Link>
    <div className="page-head"><div><div className="eyebrow">INBOUND EVENT INSPECTOR</div><h1>{data?.eventType || "Rejected request"}</h1><p className="muted mono">{data?.eventId || receiptId}</p></div>{data?.verified && <button className="btn" disabled={busy} onClick={async () => {
      if (!(await confirmAction({ title: "Replay this inbound event?", description: "The exact original provider body will be sent again to the current destination and any connected local listener. Your receiver may perform its action again.", label: "Queue replay" }))) return;
      setBusy(true); setFailure(""); try { const result = await api<{queuedDestinations:number;liveListeners:number}>(`/api/sources/${id}/receipts/${receiptId}/replay`, {}); setNotice(`Replay queued for ${result.queuedDestinations} destination(s) and ${result.liveListeners} live listener(s).`); await reload(); } catch (cause) { setFailure((cause as Error).message); } finally { setBusy(false); }
    }}><RotateCcw size={15} /> Replay this event</button>}</div><ErrorBox error={error || failure} />{notice && <p className="notice" role="status">{notice}</p>}
    {data && <><div className="source-summary"><section className="panel panel-body"><h2>Verification</h2><p><Badge value={data.verified ? "SUCCESS" : "FAILED"} /> · {data.provider} adapter</p><p>{data.failureReason || "Provider signature verified"}</p><p className="muted">Received {new Date(data.receivedAt).toLocaleString()}</p><p className="muted">Verification errors appear only in this authenticated view. The public webhook endpoint returns a generic error.</p></section><section className="panel panel-body"><h2>Original request</h2><p>{Object.keys(data.rawHeaders).length} captured headers · original bytes available for download</p><a className="btn secondary" href={`/api/sources/${id}/receipts/${receiptId}?raw=1`}>Download exact body</a></section></div>
      <section className="panel panel-body"><h2>Raw headers</h2><div className="inbound-headers">{Object.entries(data.rawHeaders).map(([name, value]) => <div key={name}><code className={/signature|hmac/i.test(name) ? "inbound-signature" : ""}>{name}{/signature|hmac/i.test(name) ? " (signature)" : ""}</code><code>{value}</code></div>)}</div><h2>Raw body</h2><CodeBlock className="inbound-body">{highlightedJson(body)}</CodeBlock></section>
      <section className="panel panel-body"><h2>Replay history</h2>{data.replays.length ? data.replays.map(replay => <p key={replay.id}>Replayed at {new Date(replay.createdAt).toLocaleString()} by user <code>{replay.userId}</code>{replay.generation !== null ? ` · delivery run ${replay.generation + 1}` : " · live only"}</p>) : <p className="muted">No manual replays.</p>}</section>
      <section className="panel panel-body"><h2>Destination delivery runs</h2>{data.deliveries.length ? data.deliveries.map(delivery => <p key={delivery.id}><Badge value={delivery.status} /> · run {delivery.generation + 1} · <code>{delivery.endpoint.url}</code></p>) : <p className="muted">No configured destination at receipt time.</p>}</section>
      <div className="inbound-attempts"><h2>Destination attempts</h2>{data.attempts.length ? data.attempts.map(attempt => <AttemptCard key={attempt.id} attempt={attempt} title={`Attempt ${attempt.attemptNumber}`} />) : <p className="muted">No destination attempts.</p>}<h2>Local CLI forwards</h2>{data.liveAttempts.length ? data.liveAttempts.map(attempt => <AttemptCard key={attempt.id} attempt={attempt} title={attempt.replayId ? "Replayed to local listener" : "Forwarded to local listener"} />) : <p className="muted">No live listener received this event.</p>}</div>
    </>}
  </Shell>;
}
