"use client";
import { T } from "@/components/preferences";
import { use } from "react";
import { useConfirm } from "@/components/site-tools";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
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
          <div className="panel panel-body">
            <label><T text={"Idempotency key"} /></label>
            <code>{data.event.idempotencyKey}</code>
            <p className="muted" style={{ fontSize: 12 }}>
              Receivers should deduplicate this key atomically with their
              business operation, including on replay.
            </p>
            <div className="section-title">
              <h2><T text={"Delivery runs"} /></h2>
            </div>
            {data.deliveries.map((d: any) => (
              <p key={d.id}>
                <Badge value={d.status} />{" "}
                <span className="muted mono">
                  Run {d.generation + 1} · attempt {d.attemptNumber}
                </span>
              </p>
            ))}
          </div>
          {data.attempts.length ? (
            data.attempts.map((a: any) => (
              <section className="panel" key={a.id}>
                <div className="panel-head">
                  <h2>
                    Attempt {a.attemptNumber}{" "}
                    <span
                      className="muted"
                      style={{ fontWeight: 400, marginLeft: 10 }}
                    >
                      {new Date(a.createdAt).toLocaleString()}
                    </span>
                  </h2>
                  <Badge value={a.status} />
                </div>
                <div className="panel-body">
                  <div className="muted" style={{ marginBottom: 18 }}>
                    HTTP {a.httpStatusCode || "—"} · {a.durationMs ?? 0} ms{" "}
                    {a.error && `· ${a.error}`}
                  </div>
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
              </section>
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
