"use client";
import { use, useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, Braces, Clock3, Download, RotateCcw, ShieldCheck, Send } from "lucide-react";
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
  return <details className="panel inspector-attempt"><summary><div className="visual-list-main"><span className="visual-card-icon"><Send size={17} /></span><div><strong>{title}</strong><small>{new Date(attempt.createdAt).toLocaleString()}</small></div></div><span className="inspector-attempt-meta">HTTP {attempt.httpStatusCode ?? "—"} · {attempt.durationMs ?? "—"} ms <Badge value={attempt.status} /></span></summary><div className="panel-body">{attempt.error && <p role="status">{attempt.error}</p>}{attempt.requestHeaders != null && <><label>Request headers</label><CodeBlock>{JSON.stringify(attempt.requestHeaders, null, 2)}</CodeBlock></>}{attempt.requestBody && <><label>Request body</label><CodeBlock>{attempt.requestBody}</CodeBlock></>}{attempt.responseHeaders != null && <><label>Response headers</label><CodeBlock>{JSON.stringify(attempt.responseHeaders, null, 2)}</CodeBlock></>}{attempt.responseBody && <><label>Response body</label><CodeBlock>{attempt.responseBody}</CodeBlock></>}</div></details>;
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
    {data && <><div className="visual-card-grid">
      <section className="visual-card"><div className="visual-card-top"><span>Verification</span><span className="visual-card-icon"><ShieldCheck size={18} /></span></div><div className="visual-card-value"><Badge value={data.verified ? "SUCCESS" : "FAILED"} /></div><p className="visual-card-caption">{data.failureReason || `${data.provider} signature verified`}</p></section>
      <section className="visual-card"><div className="visual-card-top"><span>Received</span><span className="visual-card-icon"><Clock3 size={18} /></span></div><div className="visual-card-value" style={{ fontSize: 17 }}>{new Date(data.receivedAt).toLocaleString()}</div><p className="visual-card-caption">{data.provider} webhook</p></section>
      <section className="visual-card"><div className="visual-card-top"><span>Request</span><span className="visual-card-icon"><Braces size={18} /></span></div><div className="visual-card-value">{Object.keys(data.rawHeaders).length} headers</div><p className="visual-card-caption"><a href={`/api/sources/${id}/receipts/${receiptId}?raw=1`}><Download size={13} aria-hidden="true" /> Download original body</a></p></section>
      <section className="visual-card"><div className="visual-card-top"><span>Activity</span><span className="visual-card-icon"><Activity size={18} /></span></div><div className="visual-card-value">{data.attempts.length + data.liveAttempts.length}</div><p className="visual-card-caption">{data.replays.length} replay{data.replays.length === 1 ? "" : "s"} · {data.deliveries.length} delivery runs</p></section>
      </div>
      <section className="panel panel-body"><div className="visual-list-main"><span className="visual-card-icon"><Braces size={18} /></span><h2>Original request</h2></div><details className="inspector-detail"><summary>View captured headers</summary><div className="inbound-headers">{Object.entries(data.rawHeaders).map(([name, value]) => <div key={name}><code className={/signature|hmac/i.test(name) ? "inbound-signature" : ""}>{name}{/signature|hmac/i.test(name) ? " (signature)" : ""}</code><code>{value}</code></div>)}</div></details><details className="inspector-detail"><summary>View raw body</summary><CodeBlock className="inbound-body">{highlightedJson(body)}</CodeBlock></details></section>
      <section className="panel panel-body"><div className="visual-list-main"><span className="visual-card-icon"><RotateCcw size={18} /></span><h2>Replay history</h2></div>{data.replays.length ? <div className="visual-list">{data.replays.map(replay => <div className="visual-list-row" key={replay.id}><div className="visual-list-main"><strong>Replay {replay.generation !== null ? `· run ${replay.generation + 1}` : "· live only"}</strong><small>{new Date(replay.createdAt).toLocaleString()}</small></div><Badge value="REPLAYED" /></div>)}</div> : <div className="visual-empty"><RotateCcw size={18} />No manual replays.</div>}</section>
      <section className="panel panel-body"><div className="visual-list-main"><span className="visual-card-icon"><Send size={18} /></span><h2>Destination delivery runs</h2></div>{data.deliveries.length ? <div className="visual-list">{data.deliveries.map(delivery => <div className="visual-list-row" key={delivery.id}><div className="visual-list-main"><strong>Run {delivery.generation + 1}</strong><small className="source-url">{delivery.endpoint.url}</small></div><Badge value={delivery.status} /></div>)}</div> : <div className="visual-empty"><Send size={18} />No destination configured at receipt time.</div>}</section>
      <div className="inbound-attempts"><h2>Destination attempts</h2>{data.attempts.length ? data.attempts.map(attempt => <AttemptCard key={attempt.id} attempt={attempt} title={`Attempt ${attempt.attemptNumber}`} />) : <p className="muted">No destination attempts.</p>}<h2>Local CLI forwards</h2>{data.liveAttempts.length ? data.liveAttempts.map(attempt => <AttemptCard key={attempt.id} attempt={attempt} title={attempt.replayId ? "Replayed to local listener" : "Forwarded to local listener"} />) : <p className="muted">No live listener received this event.</p>}</div>
    </>}
  </Shell>;
}
