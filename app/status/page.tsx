import { Brand } from "@/components/shell";
import { PreferencesMenu } from "@/components/preferences";
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, Clock3, RefreshCw } from "lucide-react";
import Link from "next/link";
import { publicStatus } from "@/lib/public-status";

export const metadata = { title: "Service status | Hooka Relay", description: "View recent aggregate webhook delivery outcomes for Hooka Relay.", alternates: { canonical: "/status" } };

export default async function StatusPage() {
  let data;
  try { data = await publicStatus(); } catch {
    return <main id="main-content" className="portal-layout public-status-page"><header className="public-header"><Brand /><PreferencesMenu /></header><section className="status-hero"><span className="status-symbol status-symbol-neutral"><Activity size={24} aria-hidden="true" /></span><p className="eyebrow">PUBLIC SERVICE STATUS</p><h1>Status temporarily unavailable</h1><p>We could not load delivery metrics. Please check again shortly.</p><Link className="btn secondary" href="/status"><RefreshCw size={16} aria-hidden="true" />Try again</Link></section></main>;
  }

  const sparse = data.total < 5;
  const heading = data.degraded ? "Elevated delivery failures" : data.total === 0 ? "No recent delivery activity" : sparse ? "Limited delivery activity" : "No sustained incident detected";
  const summary = data.degraded
    ? "Delivery failures are elevated in the latest completed windows. Aggregate delivery outcomes appear below."
    : data.total === 0 ? "No HTTP delivery attempts were recorded in the last 24 hours."
    : sparse ? "Only a few delivery attempts were recorded in the last 24 hours. The sample is too small to indicate overall service health."
    : "No sustained delivery incident was detected in the last 24 hours.";

  return <main id="main-content" className="portal-layout public-status-page">
    <header className="public-header"><Brand /><PreferencesMenu /></header>
    <section className={`status-hero ${data.degraded ? "is-degraded" : sparse ? "is-neutral" : "is-healthy"}`} aria-labelledby="status-heading">
      <div className="status-hero-top"><span className={`status-symbol ${data.degraded ? "status-symbol-alert" : sparse ? "status-symbol-neutral" : "status-symbol-good"}`}>
        {data.degraded ? <AlertTriangle size={25} aria-hidden="true" /> : sparse ? <Activity size={25} aria-hidden="true" /> : <CheckCircle2 size={25} aria-hidden="true" />}
      </span><span className="status-window"><Clock3 size={14} aria-hidden="true" /> Last 24 hours</span></div>
      <p className="eyebrow">PUBLIC SERVICE STATUS</p><h1 id="status-heading">{heading}</h1><p className="status-summary">{summary}</p>
      <div className="status-hero-foot"><span>Updated {new Date(data.checkedAt).toLocaleString("en", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC</span><Link className="btn secondary" href="/status"><RefreshCw size={16} aria-hidden="true" />Refresh</Link></div>
    </section>

    <div className="status-metrics" aria-label="Delivery metrics">
      <section className="status-metric"><div className="status-metric-icon"><CheckCircle2 size={19} aria-hidden="true" /></div><div><p>Delivery success</p><strong>{data.successRate === null ? "—" : sparse ? `${data.success} / ${data.total}` : `${data.successRate}%`}</strong><small>{data.total === 0 ? "No attempts to measure" : sparse ? "Too few attempts for a meaningful success rate" : `${data.success.toLocaleString()} of ${data.total.toLocaleString()} HTTP attempts succeeded`}</small></div></section>
      <section className="status-metric"><div className="status-metric-icon"><Activity size={19} aria-hidden="true" /></div><div><p>HTTP attempts</p><strong>{data.total.toLocaleString()}</strong><small>Recorded in the last 24 hours</small></div></section>
    </div>

    <section className="status-incidents" aria-labelledby="incidents-heading"><div className="status-section-head"><div><p className="eyebrow">INCIDENT HISTORY</p><h2 id="incidents-heading">Detected incidents</h2></div><span className={`status-count ${data.incidents.length ? "has-incidents" : ""}`}>{data.incidents.length} in 24h</span></div>
      {data.incidents.length ? <ol className="status-incident-list">{data.incidents.map(incident => <li key={incident.start}><span className="status-incident-marker" /><div><strong>Delivery success below 90%</strong><p>{new Date(incident.start).toLocaleString("en", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC — {incident.end ? `${new Date(incident.end).toLocaleString("en", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC` : "Ongoing"}</p></div></li>)}</ol>
        : <div className="status-empty"><CheckCircle2 size={22} aria-hidden="true" /><div><strong>No sustained incidents detected</strong><p>None met the incident rule during the observed windows.</p></div></div>}
    </section>
    <details className="status-method"><summary>How this status is calculated <ChevronDown size={16} aria-hidden="true" /></summary><p>An incident requires two consecutive completed five-minute windows, each with at least five HTTP attempts and delivery success below 90%. Missing or low-volume windows break the sequence. Receiver failures and test endpoints count, so these figures describe observed delivery outcomes rather than platform uptime. Circuit-open skips are excluded. Metrics can be cached for up to 60 seconds.</p></details>
  </main>;
}
