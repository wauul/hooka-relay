"use client";
import { T } from "@/components/preferences";
import { use } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, FlaskConical } from "lucide-react";
import { Shell } from "@/components/shell";
import { api, ErrorBox } from "@/components/ui";
import { useData } from "@/components/ui";
import { CustomerSelect } from "@/components/application-customers";
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: app } = useData<{ customerMode: string }>(`/api/applications/${resolvedParams.id}`);
  async function create(body: unknown) {
    setBusy(true);
    setError("");
    try {
      const ep = await api(`/api/applications/${resolvedParams.id}/endpoints`, body);
      router.push(`/endpoints/${ep.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Shell>
      <Link className="back" href={`/applications/${resolvedParams.id}`}>
        <ArrowLeft size={13} /><T text={"Back to application"} /></Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">CONNECT A DESTINATION</div>
          <h1><T text={"New endpoint"} /></h1>
          <div className="muted">Where should we deliver your events?</div>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="split">
        <form
          className="panel panel-body"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            create({
              url: f.get("url"),
              ...(app?.customerMode === "ISOLATED" ? { customerId: f.get("customerId") } : {}),
              eventTypes: String(f.get("types"))
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            });
          }}
        >
          {app?.customerMode === "ISOLATED" && <CustomerSelect applicationId={resolvedParams.id} />}
          <div className="field">
            <label htmlFor="url"><T text={"Endpoint URL"} /></label>
            <input
              type="url"
              id="url"
              name="url"
              placeholder="https://api.example.com/webhooks"
              required
            />
            <p className="muted" style={{ fontSize: 11 }}>
              Public HTTPS URLs only. We sign every delivery using your
              endpoint’s unique secret.
            </p>
          </div>
          <div className="field">
            <label htmlFor="types"><T text={"Event types"} /></label>
            <input id="types" name="types" defaultValue="*" required />
            <p className="muted" style={{ fontSize: 11 }}>
              Comma-separated types, such as order.shipped, payment.failed. Use
              * for all events.
            </p>
          </div>
          <button disabled={busy} className="btn"><T text={"Create endpoint"} /><ArrowRight size={14} />
          </button>
        </form>
        <section className="panel">
          <div className="panel-head">
            <h2>
              <FlaskConical
                size={15}
                style={{ display: "inline", marginRight: 8 }}
              /><T text={"Try a built-in receiver"} /></h2>
            <span className="badge">DEMO</span>
          </div>
          <div className="panel-body">
            <p className="muted" style={{ marginTop: 0 }}>
              Real delivery. Predictable behavior. No external server needed.
            </p>
            {[
              ["succeed", "Always succeeds", "Returns 200 immediately."],
              [
                "flaky",
                "Fails, then recovers",
                "First two calls fail; the third succeeds.",
              ],
              ["fail", "Always fails", "Returns 500. Watch the circuit open."],
              ["hang", "Times out", "Exceeds the 10-second delivery deadline."],
            ].map(([mode, title, description]) => (
              <button
                key={mode}
                disabled={busy}
                className="btn secondary"
                style={{
                  width: "100%",
                  justifyContent: "space-between",
                  textAlign: "left",
                  marginTop: 12,
                  padding: 15,
                }}
                onClick={() => create({ mode, eventTypes: ["*"], ...(app?.customerMode === "ISOLATED" ? { customerId: (document.getElementById("customerId") as HTMLSelectElement | null)?.value } : {}) })}
              >
                <span>
                  <strong style={{ display: "block" }}>{title}</strong>
                  <span
                    className="muted"
                    style={{ fontWeight: 400, fontSize: 11 }}
                  >
                    {description}
                  </span>
                </span>
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
        </section>
      </div>
    </Shell>
  );
}
