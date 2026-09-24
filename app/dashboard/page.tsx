"use client";
import { T } from "@/components/preferences";
import { useState } from "react";
import Link from "next/link";
import {
  Plus,
  ArrowUpRight,
  Layers3,
  Radio,
  Send,
  ArrowRight,
  Terminal,
} from "lucide-react";
import { CodeBlock } from "@/components/ui";
import { Shell } from "@/components/shell";
import { api, useData, ErrorBox, LoadingState, CopyButton } from "@/components/ui";
type App = {
  id: string;
  name: string;
  createdAt: string;
  _count: { endpoints: number; events: number };
};
export default function Page() {
  const { data, error, reload } = useData<App[]>("/api/applications", true);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  return (
    <Shell>
      <div className="page-head">
        <div>
          <div className="eyebrow">YOUR DELIVERY CONTROL CENTER</div>
          <h1><T text={"Applications"} /></h1>
          <div className="muted">
            Your events, endpoints, and everything in between.
          </div>
        </div>
        <button className="btn" onClick={() => setCreating(!creating)}>
          <Plus size={15} /><T text={"New application"} /></button>
      </div>
      <ErrorBox error={error || failure} />
      {newKey && <section className="panel panel-body" role="status"><h2>Save your API key</h2><p>This key is shown only now. Copy it before leaving this page.</p><div className="secret-row"><code>{newKey}</code><CopyButton value={newKey} /><button className="btn quiet" onClick={() => setNewKey(null)}>I saved it</button></div></section>}
      <div className="stats">
        <div className="stat">
          <div className="stat-label"><T text={"Applications"} /><Layers3 size={16} />
          </div>
          <div className="stat-value">{data?.length ?? "—"}</div>
          <div className="stat-note">Independent webhook workspaces</div>
        </div>
        <div className="stat">
          <div className="stat-label"><T text={"Registered endpoints"} /><Radio size={16} />
          </div>
          <div className="stat-value">
            {data?.reduce((n, a) => n + a._count.endpoints, 0) ?? "—"}
          </div>
          <div className="stat-note"><T text={"Connected delivery destinations"} /></div>
        </div>
        <div className="stat">
          <div className="stat-label"><T text={"Events accepted"} /><Send size={16} />
          </div>
          <div className="stat-value">
            {data?.reduce((n, a) => n + a._count.events, 0) ?? "—"}
          </div>
          <div className="stat-note">Durably stored, ready for delivery</div>
        </div>
      </div>
      {creating && (
        <form
          className="panel panel-body"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const created = await api("/api/applications", {
                name: new FormData(e.currentTarget).get("name"),
                customerMode: new FormData(e.currentTarget).get("customerMode"),
              });
              setNewKey(created.currentApiKey);
              setCreating(false);
              await reload();
            } catch (e) {
              setFailure((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-row">
            <div className="field">
              <label htmlFor="name"><T text={"Application name"} /></label>
              <input
                autoFocus
                id="name"
                name="name"
                placeholder="e.g. Commerce API"
                maxLength={80}
                required
              />
            </div>
            <div className="field"><label htmlFor="customerMode">Customer routing</label><select id="customerMode" name="customerMode" defaultValue="LEGACY"><option value="LEGACY">Legacy application</option><option value="ISOLATED">Isolated customers</option></select></div>
            <button className="btn" disabled={busy}><T text={"Create application"} /><ArrowRight size={14} />
            </button>
          </div>
        </form>
      )}
      <div className="section-title">
        <h2><T text={"All applications"} /><span className="count">{data?.length ?? 0}</span>
        </h2>
        <span className="muted" style={{ fontSize: 11 }}>
          Updates every 5 seconds
        </span>
      </div>
      {!data && !error ? (
        <LoadingState />
      ) : data?.length ? (
        <div className="app-grid">
          {data.map((a) => (
            <Link
              className="app-card"
              href={`/applications/${a.id}`}
              key={a.id}
            >
              <div className="app-title">
                <div className="app-icon">
                  <Layers3 size={20} />
                </div>
                <ArrowUpRight size={17} color="#718092" />
              </div>
              <h3>{a.name}</h3>

              <div className="app-meta">
                <span>◉ {a._count.endpoints} endpoints</span>
                <span>↗ {a._count.events} events</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="panel empty">
          <Layers3 size={30} />
          <h3>A home for your webhooks</h3>
          <p>
            Create your first application to get an API key, connect an
            endpoint, and send your first event.
          </p>
          <button className="btn" onClick={() => setCreating(true)}>
            <Plus size={14} />
            Create your first application
          </button>
        </div>
      )}
      <div className="quickstart">
        <div>
          <div className="eyebrow">
            <Terminal size={12} style={{ display: "inline", marginRight: 7 }} />{" "}
            A FEW LINES. RELIABLE DELIVERY.
          </div>
          <h3>Send it. We’ll take it from here.</h3>
          <p className="muted" style={{ fontSize: 12 }}>
            One API call. Automatic retries, signed payloads, and a complete
            delivery trail, built in.
          </p>
          <Link href="/docs" className="auth-link" style={{ fontSize: 12 }}>
            Read the quickstart{" "}
            <ArrowRight size={12} style={{ display: "inline" }} />
          </Link>
        </div>
        <CodeBlock className="code">
          <span className="green">curl</span>
          {
            ' -X POST "$RELAY_URL/api/v1/events" \\\n  -H "Authorization: Bearer $API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"type":"order.shipped",\n       "payload":{"orderId":"ord_1042"}}\''
          }
        </CodeBlock>
      </div>
      <div className="footer-note">
        A little less infrastructure. A lot more peace of mind.
      </div>
    </Shell>
  );
}
