"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useData } from "./ui";
export type WorkspaceMembership = {
  workspaceId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  workspace: { id: string; name: string };
};
export function WorkspaceSwitcher() {
  const { data } = useData<WorkspaceMembership[]>("/api/workspaces");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    if (!data?.length) return;
    const saved = localStorage.getItem("workspaceId");
    const id =
      data.find((m) => m.workspaceId === saved)?.workspaceId ||
      data[0].workspaceId;
    localStorage.setItem("workspaceId", id);
    setSelected(id);
    if (saved && saved !== id) window.location.assign("/dashboard");
  }, [data]);
  return (
    <div className="workspace" style={{ display: "grid", gap: 8 }}>
      <label htmlFor="workspace-switch">Workspace</label>
      <select
        id="workspace-switch"
        value={selected}
        onChange={(e) => {
          localStorage.setItem("workspaceId", e.target.value);
          window.location.assign("/dashboard");
        }}
      >
        {data?.map((m) => (
          <option key={m.workspaceId} value={m.workspaceId}>
            {m.workspace.name}
          </option>
        ))}
      </select>
      <Link href="/workspaces">Manage workspaces &amp; team</Link>
    </div>
  );
}
