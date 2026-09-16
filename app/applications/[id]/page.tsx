"use client";
import { use } from "react";
import { useConfirm } from "@/components/site-tools";
import { useState } from "react";
import Link from "next/link";
import {
  Plus,
  ArrowLeft,
  Send,
  KeyRound,
  Radio,
  Eye,
  EyeOff,
  Trash2,
} from "lucide-react";
import { LoadingState } from "@/components/ui";
import { Shell } from "@/components/shell";
import { api, useData, Badge, CopyButton, ErrorBox } from "@/components/ui";
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const { data, error, reload } = useData<any>(
    `/api/applications/${resolvedParams.id}`,
    true,
  );
  const confirmAction = useConfirm();
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
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
        </div>
        <Link
          className="btn"
          href={`/applications/${resolvedParams.id}/endpoints/new`}
        >
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
                disabled={
                  rotating ||
                  data.role === "MEMBER" ||
                  (data.previousApiKeyExpiresAt &&
                    new Date(data.previousApiKeyExpiresAt) > new Date())
                }
                onClick={async () => {
                  if (
                    !(await confirmAction({
                      title: "Replace this API key?",
                      description: `The current key will remain valid for ${data.keyGraceHours} hours. Update your integrations before it expires.`,
                      label: "Regenerate key",
                    }))
                  )
                    return;
                  setRotating(true);
                  try {
                    await api(`/api/applications/${resolvedParams.id}`, {});
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
                {data.currentApiKey ? (
                  <>
                    <code
                      aria-label={
                        revealedKey === data.currentApiKey
                          ? "Application API key"
                          : "API key hidden"
                      }
                    >
                      {revealedKey === data.currentApiKey
                        ? data.currentApiKey
                        : "•".repeat(24)}
                    </code>
                    <div className="api-key-actions">
                      <button
                        type="button"
                        className="btn quiet"
                        aria-label={
                          revealedKey === data.currentApiKey
                            ? "Hide API key"
                            : "Show API key"
                        }
                        aria-pressed={revealedKey === data.currentApiKey}
                        onClick={() =>
                          setRevealedKey(
                            revealedKey === data.currentApiKey
                              ? null
                              : data.currentApiKey,
                          )
                        }
                      >
                        {revealedKey === data.currentApiKey ? (
                          <EyeOff size={15} />
                        ) : (
                          <Eye size={15} />
                        )}
                        {revealedKey === data.currentApiKey ? "Hide" : "Show"}
                      </button>
                      <CopyButton value={data.currentApiKey} />
                    </div>
                  </>
                ) : (
                  <p className="muted">
                    API keys are available to workspace admins.
                  </p>
                )}
              </div>
              <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
                Keep this key on your server. Use it as a Bearer token when
                sending events.
              </p>
            </div>
          </section>
          {data.previousApiKeyExpiresAt && (
            <p className="notice">
              Old key remains valid until{" "}
              {new Date(data.previousApiKeyExpiresAt).toLocaleString()} — update
              your integration before then.
            </p>
          )}
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
                            <Badge value={ep.circuitState} />{" "}
                            <Badge value={ep.status} />
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
                    href={`/applications/${resolvedParams.id}/endpoints/new`}
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
                      `/api/applications/${resolvedParams.id}/events`,
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
          {data.role !== "MEMBER" && (
            <section className="panel application-delete">
              <div>
                <h2>Delete application</h2>
                <p className="muted">
                  Permanently remove this application, its endpoints, and
                  delivery history.
                </p>
              </div>
              <button
                className="btn delete-application-button"
                disabled={deleting}
                onClick={async () => {
                  if (
                    !(await confirmAction({
                      title: "Delete application?",
                      description:
                        "Permanently delete this application, its endpoints, events and delivery history?",
                      label: "Delete application",
                    }))
                  )
                    return;
                  setDeleting(true);
                  try {
                    await api(
                      `/api/applications/${resolvedParams.id}`,
                      {},
                      "DELETE",
                    );
                    window.location.assign("/dashboard");
                  } catch (e) {
                    setFailure((e as Error).message);
                    setDeleting(false);
                  }
                }}
              >
                <Trash2 size={14} />
                {deleting ? "Deleting..." : "Delete application"}
              </button>
            </section>
          )}
        </>
      )}
    </Shell>
  );
}
