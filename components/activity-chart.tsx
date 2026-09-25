import { Activity } from "lucide-react";

export type ActivityData = {
  canManage: boolean;
  customer: { id: string; name: string; externalId: string; createdAt: string; portalEnabled: boolean } | null;
  endpoints: number;
  activeEndpoints: number;
  sources: number;
  events: number;
  deliveries: Record<string, number>;
  dailyEvents: { day: string; count: number }[];
  recentEvents: { id: string; type: string; createdAt: string }[];
  endpointRows: { id: string; url: string; status: string }[];
  sourceRows: { id: string; name: string; provider: string; status: string }[];
};

export function ActivityChart({ data }: { data: ActivityData }) {
  const maximum = Math.max(1, ...data.dailyEvents.map(day => day.count));
  return <section className="panel panel-body activity-panel" aria-label="Events over the last 14 days">
    <div className="activity-heading"><div><span className="eyebrow">LAST 14 DAYS</span><h2>Event activity</h2></div><div className="activity-total"><Activity size={17} aria-hidden="true" /><strong>{data.events}</strong><span>events</span></div></div>
    <div className="activity-chart" role="img" aria-label={`Daily event counts: ${data.dailyEvents.map(item => `${item.day}: ${item.count}`).join(", ")}`}>
      {data.dailyEvents.map(({ day, count }) => <div className="activity-day" key={day} title={`${day}: ${count} ${count === 1 ? "event" : "events"}`}><span className="activity-bar-track"><span className="activity-bar" style={{ height: `${count ? Math.max(8, count / maximum * 100) : 0}%` }} /></span><span className="activity-day-label">{new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", timeZone: "UTC" })}</span></div>)}
    </div><div className="activity-axis"><span>{new Date(`${data.dailyEvents[0].day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}</span><span>{new Date(`${data.dailyEvents.at(-1)!.day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}</span></div>
  </section>;
}

export function DeliveryMix({ deliveries }: { deliveries: Record<string, number> }) {
  const delivered = deliveries.DELIVERED || 0;
  const pending = deliveries.PENDING || 0;
  const other = Object.entries(deliveries).reduce((sum, [status, count]) => sum + (status === "DELIVERED" || status === "PENDING" ? 0 : count), 0);
  const total = delivered + pending + other;
  return <section className="panel panel-body delivery-mix"><span className="eyebrow">LAST 14 DAYS</span><h2>Delivery outcomes</h2>{total ? <><div className="delivery-mix-track" role="img" aria-label={`${delivered} delivered, ${pending} pending, ${other} other outcomes`}><span className="delivered" style={{ width: `${delivered / total * 100}%` }} /><span className="pending" style={{ width: `${pending / total * 100}%` }} /><span className="other" style={{ width: `${other / total * 100}%` }} /></div><div className="delivery-mix-legend"><span><i className="delivered" />Delivered <strong>{delivered}</strong></span><span><i className="pending" />Pending <strong>{pending}</strong></span><span><i className="other" />Other <strong>{other}</strong></span></div></> : <p className="muted">No delivery attempts in this period.</p>}</section>;
}
