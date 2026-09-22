"use client";
import { T } from "@/components/preferences";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, RefreshCw } from "lucide-react";
export async function api<T = any>(url: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(url, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(typeof window === "undefined" ? {} : { "X-Workspace-Id": localStorage.getItem("workspaceId") || "" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
export function useData<T>(url: string, poll = false) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const router = useRouter();
  const load = useCallback(async () => {
    try {
      setData(await api<T>(url));
      setError("");
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "UNAUTHORIZED") router.replace("/login");
      else setError(msg);
    }
  }, [url, router]);
  useEffect(() => {
    load();
    window.addEventListener("hooka-workspace-changed", load);
    const timer = poll ? setInterval(load, 5000) : undefined;
    return () => { window.removeEventListener("hooka-workspace-changed", load); if (timer) clearInterval(timer); };
  }, [load, poll]);
  return { data, error, reload: load };
}
export function Badge({ value }: { value: string }) {
  return (
    <span
      className={`badge ${["OPEN", "FAILED", "TIMEOUT", "DEAD_LETTERED"].includes(value) ? "red" : ["HALF_OPEN", "SKIPPED_CIRCUIT_OPEN", "PENDING"].includes(value) ? "amber" : ""}`}
    >
      <span className="dot" style={{ background: "currentColor" }} />
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className="btn quiet"
      type="button"
      aria-label={copied ? "Copied" : "Copy to clipboard"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setFailed(false);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 2000);
        } catch {
          setFailed(true);
        }
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span role="status">
        <T text={failed ? "Select text to copy" : copied ? "Copied" : "Copy"} />
      </span>
    </button>
  );
}
export function Refresh({ onClick }: { onClick: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn quiet"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
    >
      <RefreshCw size={13} className={busy ? "spin" : ""} />
      <T text={busy ? "Refreshing…" : "Refresh"} />
    </button>
  );
}
export function CodeBlock({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const [value, setValue] = useState("");
  useEffect(() => setValue(ref.current?.textContent || ""), [children]);
  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span><T text={"Code / data"} /></span>
        <CopyButton value={value} />
      </div>
      <pre ref={ref} className={className}>
        {children}
      </pre>
    </div>
  );
}
export function LoadingState({
  label = "Loading your workspace…",
}: {
  label?: string;
}) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <div className="loading-label">
        <RefreshCw size={18} className="spin" />
        {label}
      </div>
      <div aria-hidden="true" className="skeleton-grid">
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    </div>
  );
}
export function ErrorBox({ error }: { error: string }) {
  return error ? (
    <div className="error" role="alert">
      {error}
    </div>
  ) : null;
}
