"use client";
import { useEffect, useState } from "react";
import { ArrowDown, GitBranch, Plus, Save, Trash2 } from "lucide-react";
import { api, Badge, ErrorBox, useData } from "./ui";

type Destination = { id?: string; url: string; retryPolicy: "STANDARD" | "AGGRESSIVE" | "RELAXED"; status: "ACTIVE" | "PAUSED"; circuitState?: string };
type Group = { id?: string; triggerCondition: "ALWAYS" | "ON_PREVIOUS_SUCCESS" | "ON_PREVIOUS_FAILURE"; successPolicy: "ALL_MUST_SUCCEED" | "ANY_MUST_SUCCEED"; destinations: Destination[] };
type Data = { canManage: boolean; groups: Group[] };
const destination = (): Destination => ({ url: "", retryPolicy: "STANDARD", status: "ACTIVE" });
const group = (triggerCondition: Group["triggerCondition"] = "ALWAYS"): Group => ({ triggerCondition, successPolicy: "ALL_MUST_SUCCEED", destinations: [destination()] });
const conditions = { ALWAYS: "Always", ON_PREVIOUS_SUCCESS: "If previous succeeded", ON_PREVIOUS_FAILURE: "If previous failed" };
const policies = { ALL_MUST_SUCCEED: "All must succeed", ANY_MUST_SUCCEED: "Any may succeed" };

export function RoutingBuilder({ sourceId }: { sourceId: string }) {
  const { data, error, reload } = useData<Data>(`/api/sources/${sourceId}/routing`);
  const [draft, setDraft] = useState<Group[]>([]), [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [failure, setFailure] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => { if (data) setDraft(data.groups); }, [data]);
  function replaceGroup(index: number, update: (current: Group) => Group) { setDraft(current => current.map((item, at) => at === index ? update(item) : item)); }
  function template(kind: "fanout" | "fallback" | "pipeline" | "monitor") {
    const first = group();
    if (kind === "fanout") { first.destinations.push(destination()); setDraft([first]); }
    if (kind === "fallback") setDraft([first, group("ON_PREVIOUS_FAILURE")]);
    if (kind === "pipeline") setDraft([first, group("ON_PREVIOUS_SUCCESS")]);
    if (kind === "monitor") setDraft([first, group("ALWAYS")]);
    setEditing(true);
  }
  async function save() {
    setBusy(true); setFailure(""); setNotice("");
    try {
      if (!draft.length || draft.some(item => !item.destinations.length || item.destinations.some(target => !target.url.trim()))) throw new Error("Every group needs a destination URL.");
      await api(`/api/sources/${sourceId}/routing`, { groups: draft.map((item, index) => ({ triggerCondition: index === 0 ? "ALWAYS" : item.triggerCondition, successPolicy: item.successPolicy, destinations: item.destinations.map(target => ({ id: target.id, url: target.url.trim(), retryPolicy: target.retryPolicy, status: target.status })) })) }, "PUT");
      await reload(); setEditing(false); setNotice("Routing saved. New inbound events use this route.");
    } catch (cause) { setFailure((cause as Error).message); }
    finally { setBusy(false); }
  }
  const shown = editing ? draft : data?.groups || [];
  return <section className="panel panel-body routing-builder"><div className="visual-list-main"><span className="visual-card-icon"><GitBranch size={19} /></span><div><h2>Destination routing</h2><p className="muted">Groups run in order. Destinations inside a group run in parallel.</p></div></div><ErrorBox error={error || failure} />{notice && <p className="notice" role="status">{notice}</p>}
    {data?.canManage && <div className="routing-toolbar"><button type="button" className="btn secondary" onClick={() => { setDraft(data.groups.length ? data.groups : [group()]); setEditing(value => !value); }}>{editing ? "Cancel changes" : "Edit routing"}</button>{editing && <><button type="button" className="btn quiet" onClick={() => template("fanout")}>Simple fan-out</button><button type="button" className="btn quiet" onClick={() => template("fallback")}>Primary + fallback</button><button type="button" className="btn quiet" onClick={() => template("pipeline")}>Sequential pipeline</button><button type="button" className="btn quiet" onClick={() => template("monitor")}>Primary + monitoring</button></>}</div>}
    {!shown.length && <div className="visual-empty">No public destination. A local CLI listener can still receive events.</div>}
    <div className="routing-flow">{shown.map((item, index) => <div key={item.id || index}>
      {index > 0 && <div className="routing-arrow"><ArrowDown size={17} /><span>{conditions[item.triggerCondition]}</span></div>}
      <div className="routing-group"><div className="routing-group-head"><strong>Group {index + 1}</strong>{editing ? <><label>Run when<select value={index === 0 ? "ALWAYS" : item.triggerCondition} disabled={index === 0} onChange={event => replaceGroup(index, current => ({ ...current, triggerCondition: event.target.value as Group["triggerCondition"] }))}>{Object.entries(conditions).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Success means<select value={item.successPolicy} onChange={event => replaceGroup(index, current => ({ ...current, successPolicy: event.target.value as Group["successPolicy"] }))}>{Object.entries(policies).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>{draft.length > 1 && <button type="button" className="replay-icon source-cancel" aria-label={`Remove group ${index + 1}`} onClick={() => setDraft(current => current.filter((_, at) => at !== index))}><Trash2 size={15} /></button>}</> : <small>{policies[item.successPolicy]}</small>}</div>
        <div className="routing-destinations">{item.destinations.map((target, at) => <div className="routing-destination" key={target.id || at}>{editing ? <><label>Destination URL<input type="url" required value={target.url} placeholder="https://api.example.com/webhooks" onChange={event => replaceGroup(index, current => ({ ...current, destinations: current.destinations.map((entry, position) => position === at ? { ...entry, url: event.target.value } : entry) }))} /></label><label>Retry policy<select value={target.retryPolicy} onChange={event => replaceGroup(index, current => ({ ...current, destinations: current.destinations.map((entry, position) => position === at ? { ...entry, retryPolicy: event.target.value as Destination["retryPolicy"] } : entry) }))}><option value="STANDARD">Standard</option><option value="AGGRESSIVE">Aggressive</option><option value="RELAXED">Relaxed</option></select></label><label>Status<select value={target.status} onChange={event => replaceGroup(index, current => ({ ...current, destinations: current.destinations.map((entry, position) => position === at ? { ...entry, status: event.target.value as Destination["status"] } : entry) }))}><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option></select></label>{item.destinations.length > 1 && <button type="button" className="replay-icon source-cancel" aria-label="Remove destination" onClick={() => replaceGroup(index, current => ({ ...current, destinations: current.destinations.filter((_, position) => position !== at) }))}><Trash2 size={15} /></button>}</> : <><span className="source-url">{target.url}</span><Badge value={target.status} /><small>{target.retryPolicy.toLowerCase()} retry · {target.circuitState?.toLowerCase()} circuit</small></>}</div>)}
          {editing && item.destinations.length < 8 && <button type="button" className="btn quiet" onClick={() => replaceGroup(index, current => ({ ...current, destinations: [...current.destinations, destination()] }))}><Plus size={15} />Add parallel destination</button>}
        </div></div>
    </div>)}</div>
    {editing && <div className="routing-toolbar">{draft.length < 8 && <button type="button" className="btn secondary" onClick={() => setDraft(current => [...current, group()])}><Plus size={15} />Add next group</button>}<button type="button" className="btn" disabled={busy} onClick={() => void save()}><Save size={15} />Save routing</button></div>}
    <p className="muted routing-note">A fallback waits until every required delivery in the previous group succeeds or exhausts its retries. Long backoff schedules delay later groups.</p>
  </section>;
}
