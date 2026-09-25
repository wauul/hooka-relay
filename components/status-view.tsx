"use client";

import { Brand } from "@/components/shell";
import { PreferencesMenu, usePreferences, useTranslation } from "@/components/preferences";
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, Clock3, RefreshCw } from "lucide-react";
import Link from "next/link";
import type { publicStatus } from "@/lib/public-status";

type StatusData = Awaited<ReturnType<typeof publicStatus>>;

export function StatusView({ data }: { data: StatusData | null }) {
  const t = useTranslation();
  const { language } = usePreferences();
  const utc = (value: string | Date) => new Date(value).toLocaleString(language, { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" });
  if (!data) return <main id="main-content" className="portal-layout public-status-page"><header className="public-header"><Brand /><PreferencesMenu /></header><section className="status-hero"><span className="status-symbol status-symbol-neutral"><Activity size={24} aria-hidden="true" /></span><p className="eyebrow">{t("PUBLIC SERVICE STATUS")}</p><h1>{t("Status temporarily unavailable")}</h1><p>{t("We could not load delivery metrics. Please check again shortly.")}</p><Link className="btn secondary" href="/status"><RefreshCw size={16} aria-hidden="true" />{t("Try again")}</Link></section></main>;

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
      </span><span className="status-window"><Clock3 size={14} aria-hidden="true" /> {t("Last 24 hours")}</span></div>
      <p className="eyebrow">{t("PUBLIC SERVICE STATUS")}</p><h1 id="status-heading">{t(heading)}</h1><p className="status-summary">{t(summary)}</p>
      <div className="status-hero-foot"><span>{t("Updated")} {utc(data.checkedAt)} UTC</span><Link className="btn secondary" href="/status"><RefreshCw size={16} aria-hidden="true" />{t("Refresh")}</Link></div>
    </section>

    <div className="status-metrics" aria-label={t("Delivery metrics")}>
      <section className="status-metric"><div className="status-metric-icon"><CheckCircle2 size={19} aria-hidden="true" /></div><div><p>{t("Delivery success")}</p><strong>{data.successRate === null ? "—" : sparse ? `${data.success} / ${data.total}` : `${data.successRate}%`}</strong><small>{data.total === 0 ? t("No attempts to measure") : sparse ? t("Too few attempts for a meaningful success rate") : `${data.success.toLocaleString(language)} ${t("of")} ${data.total.toLocaleString(language)} ${t("HTTP attempts succeeded")}`}</small></div></section>
      <section className="status-metric"><div className="status-metric-icon"><Activity size={19} aria-hidden="true" /></div><div><p>{t("HTTP attempts")}</p><strong>{data.total.toLocaleString(language)}</strong><small>{t("Recorded in the last 24 hours")}</small></div></section>
    </div>

    <section className="status-incidents" aria-labelledby="incidents-heading"><div className="status-section-head"><div><p className="eyebrow">{t("INCIDENT HISTORY")}</p><h2 id="incidents-heading">{t("Detected incidents")}</h2></div><span className={`status-count ${data.incidents.length ? "has-incidents" : ""}`}>{data.incidents.length} {t("in 24h")}</span></div>
      {data.incidents.length ? <ol className="status-incident-list">{data.incidents.map(incident => <li key={incident.start}><span className="status-incident-marker" /><div><strong>{t("Delivery success below 90%")}</strong><p>{utc(incident.start)} UTC — {incident.end ? `${utc(incident.end)} UTC` : t("Ongoing")}</p></div></li>)}</ol>
        : <div className="status-empty"><CheckCircle2 size={22} aria-hidden="true" /><div><strong>{t("No sustained incidents detected")}</strong><p>{t("None met the incident rule during the observed windows.")}</p></div></div>}
    </section>
    <details className="status-method"><summary>{t("How this status is calculated")} <ChevronDown size={16} aria-hidden="true" /></summary><p>{t("An incident requires two consecutive completed five-minute windows, each with at least five HTTP attempts and delivery success below 90%. Missing or low-volume windows break the sequence. Receiver failures and test endpoints count, so these figures describe observed delivery outcomes rather than platform uptime. Circuit-open skips are excluded. Metrics can be cached for up to 60 seconds.")}</p></details>
  </main>;
}
