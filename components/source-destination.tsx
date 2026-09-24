"use client";
import { useState } from "react";
import { api } from "@/components/ui";

export function SourceDestination({ sourceId, destinationUrl, onSaved }: { sourceId: string; destinationUrl: string | null; onSaved: () => Promise<unknown> }) {
  const [url, setUrl] = useState(destinationUrl || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className="source-destination" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError("");
    try { await api(`/api/sources/${sourceId}`, { destinationUrl: url }, "PATCH"); await onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save destination"); }
    finally { setBusy(false); }
  }}><label>Public destination URL<input type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://api.example.com/webhooks" /></label><button className="btn secondary" disabled={busy || !url || url === destinationUrl}>{busy ? "Saving…" : destinationUrl ? "Update destination" : "Add destination"}</button>{error && <p role="alert" className="error">{error}</p>}</form>;
}
