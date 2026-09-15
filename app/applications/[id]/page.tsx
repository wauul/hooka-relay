"use client";
import { useConfirm } from "@/components/site-tools";
import { useState } from "react";
import Link from "next/link";
import { Plus, ArrowLeft, Send, KeyRound, Radio } from "lucide-react";
import { LoadingState } from "@/components/ui";
import { Shell } from "@/components/shell";
import { api, useData, Badge, CopyButton, ErrorBox } from "@/components/ui";
export default function Page({ params }: { params: { id: string } }) {
  const { data, error, reload } = useData<any>(
    `/api/applications/${params.id}`,
    true,
  );
  const confirmAction = useConfirm();
  const [rotating, setRotating] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Shell>
      <Link className="back" href="/dashboard">
        <ArrowLeft size={13} />
        All applications
      </Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">APPLICATION</div>
          <h1>{data?.name || "Loading application…"}</h1>
          <div className="muted mono">{params.id}</div>
        </div>
        <Link className="btn" href={`/applications/${params.id}/endpoints/new`}>
          <Plus size={14} />
          Add endpoint
        </Link>
      </div>
      <ErrorBox error={error || failure} />
      {!data && !error && <LoadingState />}
      {data && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>
                <KeyRound
                  size={14}
                  style={{ display: "inline", marginRight: 9 }}
                />
                Application API key
              </h2>
              <button
                className="btn quiet"
                disabled={rotating}
                onClick={async () => {
                  if (
                    !(await confirmAction({
                      title: "Replace this API key?",
                      description:
                        "The current key will stop working immediately. Update every producer and CLI using this application after regenerating it.",
                      label: "Regenerate key",
                    }))
                  )
                    return;
                  setRotating(true);
                  try {
                    await api(`/api/applications/${params.id}`, {});
                    await reload();
                  } catch (e) {
                    setFailure((e as Error).message);
                  } finally {
                    setRotating(false);
                  }
                }}
              >
                Regenerate key
              </button>
            </div>
            <div className="panel-body">
              <div className="secret-row">
                <code>{data.apiKey}</code>
                <CopyButton value={data.apiKey} />
              </div>
              <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
                Keep this key on your server. Use it as a Bearer token when
                sending events.
              </p>
            </div>
          </section>
          <div className="split">
            <section className="panel">
              <div className="panel-head">
                <h2>
                  Endpoints{" "}
                  <span className="count">{data.endpoints.length}</span>
                </h2>
                <Radio size={15} color="#92a398" />
              </div>
              {data.endpoints.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Destination</th>
                        <th>Circuit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.endpoints.map((ep: any) => (
                        <tr key={ep.id}>
                          <td>
                            <Link href={`/endpoints/${ep.id}`}>
                              <span
                                style={{
                                  display: "block",
                                  maxWidth: 310,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {ep.url}
                              </span>
                              <span className="muted mono">
                                {ep.eventTypes.join(", ")}
                              </span>
                            </Link>
                          </td>
                          <td>
                            <Badge value={ep.circuitState} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">
                  <Radio size={25} />
                  <h3>Connect your first endpoint</h3>
                  <p>Use your own URL or try a built-in test receiver.</p>
                  <Link
                    className="btn secondary"
                    href={`/applications/${params.id}/endpoints/new`}
                  >
                    Add an endpoint
                    <Plus size={14} />
                  </Link>
                </div>
              )}
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Send a test event</h2>
                <Send size={14} />
              </div>
              <form
                className="panel-body"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setFailure("");
                  setMessage("");
                  const f = new FormData(e.currentTarget);
                  try {
                    const event = await api(
                      `/api/applications/${params.id}/events`,
                      {
                        type: f.get("type"),
                        payload: JSON.parse(String(f.get("payload"))),
                      },
                    );
                    setMessage(
                      `Event accepted: ${event.id}. Open an endpoint to follow delivery.`,
                    );
                  } catch (e) {
                    setFailure((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <div className="field">
                  <label htmlFor="type">Event type</label>
                  <input
                    id="type"
                    name="type"
                    defaultValue="order.shipped"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="payload">JSON payload</label>
                  <textarea
                    id="payload"
                    name="payload"
                    defaultValue={
                      '{\n  "orderId": "ord_1042",\n  "status": "shipped"\n}'
                    }
                    required
                  />
                </div>
                <button className="btn" disabled={busy}>
                  <Send size={13} />
                  {busy ? "Sending…" : "Send event"}
                </button>
                {message && (
                  <div role="status" className="notice">
                    {message}
                  </div>
                )}
              </form>
            </section>
          </div>
        </>
      )}
    </Shell>
  );
}
