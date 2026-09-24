"use client";
import { T } from "@/components/preferences";
import { use } from "react";
import { useConfirm } from "@/components/site-tools";
import { useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, Clock3, KeyRound, RotateCcw, Send } from "lucide-react";
import { CodeBlock } from "@/components/ui";
import { LoadingState } from "@/components/ui";
import { Shell } from "@/components/shell";
import { api, useData, Badge, ErrorBox } from "@/components/ui";
export default function Page({
  params,
}: {
  params: Promise<{ id: string; eventId: string }>;
}) {
  const resolvedParams = use(params);
  const { data, error } = useData<any>(
    `/api/endpoints/${resolvedParams.id}/events/${resolvedParams.eventId}`,
    true,
  );
  const confirmAction = useConfirm();
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Shell>
      <Link className="back" href={`/endpoints/${resolvedParams.id}`}>
        <ArrowLeft size={13} /><T text={"Delivery overview"} /></Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">EVENT INSPECTOR</div>
          <h1>{data?.event.type || "Event details"}</h1>
          <div className="muted mono">{resolvedParams.eventId}</div>
        </div>
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            if (
              !(await confirmAction({
                title: "Replay this event?",
                description:
                  "This sends a new delivery run to every original endpoint. Receivers may perform the same action again unless they deduplicate the original idempotency key.",
                label: "Queue replay",
              }))
            )
              return;
            setBusy(true);
            try {
              const result = await api(
                `/api/events/${resolvedParams.eventId}/replay`,
                {},
              );
              setMessage(
                `Replay queued for ${result.queued} endpoint(s). The original idempotency key is preserved.`,
              );
            } catch (e) {
              setFailure((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <RotateCcw size={14} /><T text={"Replay event"} /></button>
      </div>
      <ErrorBox error={error || failure} />
      {message && (
        <div role="status" className="notice">
          {message}
        </div>
      )}
      {!data && !error && <LoadingState />}
      {data && (
        <>
          <div className="visual-card-grid">
            <section className="visual-card"><div className="visual-card-top"><span>Delivery runs</span><span className="visual-card-icon"><Send size={18} /></span></div><div className="visual-card-value">{data.deliveries.length}</div><p className="visual-card-caption">Original and replay runs</p></section>
            <section className="visual-card"><div className="visual-card-top"><span>HTTP attempts</span><span className="visual-card-icon"><Activity size={18} /></span></div><div className="visual-card-value">{data.attempts.length}</div><p className="visual-card-caption">{data.attempts.length ? `${data.attempts.filter((attempt: any) => attempt.status === "SUCCESS").length} successful` : "Waiting for delivery"}</p></section>
            <section className="visual-card"><div className="visual-card-top"><span>Idempotency</span><span className="visual-card-icon"><KeyRound size={18} /></span></div><div className="visual-card-value" style={{ fontSize: 14 }}><code>{data.event.idempotencyKey}</code></div><p className="visual-card-caption">Preserved on replay</p></section>
          </div>
          <section className="panel panel-body"><div className="visual-list-main"><span className="visual-card-icon"><Clock3 size={18} /></span><h2><T text={"Delivery runs"} /></h2></div><div className="visual-list">{data.deliveries.map((delivery: any) => <div className="visual-list-row" key={delivery.id}><div className="visual-list-main"><strong>Run {delivery.generation + 1}</strong><small>Attempt {delivery.attemptNumber}</small></div><Badge value={delivery.status} /></div>)}</div></section>
          {data.attempts.length ? (
            data.attempts.map((a: any) => (
              <details className="panel inspector-attempt" key={a.id}>
                <summary><div className="visual-list-main"><span className="visual-card-icon"><Send size={17} /></span><div><strong>Attempt {a.attemptNumber}</strong><small>{new Date(a.createdAt).toLocaleString()}</small></div></div><span className="inspector-attempt-meta"><span>HTTP {a.httpStatusCode || "—"} · {a.durationMs ?? "—"} ms</span><Badge value={a.status} /></span></summary>
                <div className="panel-body">
                  {a.error && <p role="status">{a.error}</p>}
                  <div className="split">
                    <div>
                      <label><T text={"Request headers"} /></label>
                      <CodeBlock>
                        {JSON.stringify(a.requestHeaders, null, 2)}
                      </CodeBlock>
                      <label><T text={"Raw request body"} /></label>
                      <CodeBlock>
                        {a.requestBody || "No HTTP request made"}
                      </CodeBlock>
                    </div>
                    <div>
                      <label><T text={"Response headers"} /></label>
                      <CodeBlock>
                        {JSON.stringify(a.responseHeaders, null, 2)}
                      </CodeBlock>
                      <label><T text={"Response body (up to 16 KB)"} /></label>
                      <CodeBlock>
                        {a.responseBody || "No response body"}
                      </CodeBlock>
                    </div>
                  </div>
                </div>
              </details>
            ))
          ) : (
            <div className="panel empty">
              Queued. Delivery attempts will appear here automatically.
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
