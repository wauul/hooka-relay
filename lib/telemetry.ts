// Root layouts persist during client navigation. Filter at send time too, so
// an already-loaded analytics script cannot report a later capability URL.
export function filterTelemetry<T extends { url: string }>(event: T): T | null {
  try {
    const path = new URL(event.url, "https://hooka-relay.invalid").pathname;
    return /^\/(portal|invites)(\/|$)/.test(path) ? null : event;
  } catch { return null; }
}
