"use client";
import { T } from "@/components/preferences";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Select } from "./select";
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
    // Reconcile stale workspace preferences without losing an OAuth callback or profile route.
    if (saved !== id) window.dispatchEvent(new Event("hooka-workspace-changed"));
  }, [data]);
  return (
    <div className="workspace" style={{ display: "grid", gap: 8 }}>
      <label htmlFor="workspace-switch"><T text={"Workspace"} /></label>
      <Select
        id="workspace-switch"
        label="Workspace"
        workspace
        value={selected}
        options={(data || []).map((m) => ({
          value: m.workspaceId,
          label: m.workspace.name,
          description:
            m.role === "OWNER"
              ? "Owner"
              : m.role === "ADMIN"
                ? "Admin"
                : "Member",
        }))}
        onChange={(id) => {
          localStorage.setItem("workspaceId", id);
          window.location.assign("/dashboard");
        }}
      />
      <Link href="/workspaces">Manage workspaces &amp; team</Link>
    </div>
  );
}
