"use client";
import { Trash2, UserMinus, LogOut, ArrowRightLeft, Mail, Plus, Pencil, Ban } from "lucide-react";
import { T } from "@/components/preferences";
import { Section, SectionNav, useSection } from "@/components/section-nav";
import { userDisplayName } from "@/lib/display-name";
import { Select } from "@/components/select";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { api, useData, ErrorBox } from "@/components/ui";
import { useConfirm } from "@/components/site-tools";
import type { WorkspaceMembership } from "@/components/workspace-switcher";
type Details = {
  id: string;
  name: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  currentUserId: string;
  members: {
    userId: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    user: { email: string; displayName: string | null };
  }[];
};
type Invite = { id: string; email: string; role: string; expiresAt: string };
function Team({ id, refresh, section }: { id: string; refresh: () => Promise<void>; section: string }) {
  const { data, error, reload } = useData<Details>(
    `/api/workspaces/${id}`,
    true,
  );
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const admin = data && data.role !== "MEMBER";
  async function action(path: string, body: unknown = {}, method = "POST") {
    setBusy(true);
    setFailure("");
    try {
      await api(`/api/workspaces/${id}${path}`, body, method);
      await reload();
      await refresh();
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel panel-body team-panel">
      <ErrorBox error={error || failure} />
      {data && (
        <>
          <h2>
            {data.name} · {data.role}
          </h2>
          <Section active={section} name="settings">
          {admin && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(
                  "",
                  { name: new FormData(e.currentTarget).get("name") },
                  "PATCH",
                );
              }}
            >
              <label><T text={"Workspace name"} /><input
                  name="name"
                  defaultValue={data.name}
                  maxLength={100}
                  required
                />
              </label>
              <button className="btn" disabled={busy}><Pencil size={16} aria-hidden="true" /><T text={"Rename"} /></button>
            </form>
          )}
          </Section>
          <Section active={section} name="members">
          <h3><T text={"Members"} /></h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th><T text={"Member"} /></th>
                  <th><T text={"Role"} /></th>
                  <th><T text={"Actions"} /></th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.userId}>
                    <td title={m.user.email}>
                      <span className="member-name">
                        <span className="member-avatar" aria-hidden="true">
                          {userDisplayName(m.user).slice(0, 1).toUpperCase()}
                        </span>
                        {userDisplayName(m.user)}
                        {m.userId === data.currentUserId && (
                          <small className="muted">(you)</small>
                        )}
                      </span>
                    </td>
                    <td>{m.role}</td>
                    <td>
                      <div className="member-actions">
                        {admin &&
                          m.role !== "OWNER" &&
                          m.userId !== data.currentUserId && (
                            <>
                              <button
                                className="btn quiet"
                                disabled={busy}
                                onClick={() =>
                                  action(
                                    `/members/${m.userId}`,
                                    {
                                      role:
                                        m.role === "ADMIN" ? "MEMBER" : "ADMIN",
                                    },
                                    "PATCH",
                                  )
                                }
                              >
                                Make {m.role === "ADMIN" ? "member" : "admin"}
                              </button>
                              {(data.role === "OWNER" ||
                                m.role === "MEMBER") && (
                                <button
                                  className="btn quiet"
                                  disabled={busy}
                                  onClick={async () => {
                                    if (
                                      await confirm({
                                        title: "Remove member?",
                                        description: `${userDisplayName(m.user)} (${m.user.email}) will lose access to this workspace.`,
                                        label: "Remove member",
                                      })
                                    )
                                      await action(
                                        `/members/${m.userId}`,
                                        {},
                                        "DELETE",
                                      );
                                  }}
                                ><UserMinus size={16} aria-hidden="true" /><T text={"Remove"} /></button>
                              )}
                              {data.role === "OWNER" && (
                                <button
                                  className="btn quiet"
                                  disabled={busy}
                                  onClick={async () => {
                                    if (
                                      await confirm({
                                        title: "Transfer ownership?",
                                        description: `${userDisplayName(m.user)} (${m.user.email}) will become the sole owner. You will become an admin.`,
                                        label: "Transfer",
                                      })
                                    )
                                      await action("/transfer-ownership", {
                                        userId: m.userId,
                                      });
                                  }}
                                ><ArrowRightLeft size={16} aria-hidden="true" /><T text={"Transfer ownership"} /></button>
                              )}
                            </>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </Section>
          <Section active={section} name="invitations">
          {admin && (
            <>
              <h3>Invite a teammate</h3>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  await action("/invites", {
                    email: f.get("email"),
                    role: f.get("role"),
                  });
                }}
              >
                <label>
                  Email
                  <input name="email" type="email" required />
                </label>
                <label><T text={"Role"} /><Select
                    name="role"
                    label="Invitation role"
                    defaultValue="MEMBER"
                    options={[
                      {
                        value: "MEMBER",
                        label: "Member",
                        description: "View deliveries and send test events",
                      },
                      {
                        value: "ADMIN",
                        label: "Admin",
                        description:
                          "Manage applications, endpoints, and members",
                      },
                    ]}
                  />
                </label>
                <button className="btn" disabled={busy}>
                  <Mail size={16} aria-hidden="true" />Send invitation
                </button>
              </form>
              <Invites
                id={id}
                revoke={(invite) => action(`/invites/${invite}`, {}, "DELETE")}
              />
            </>
          )}
          {!admin && <p className="muted">Only workspace owners and admins can invite teammates.</p>}
          </Section>
          <Section active={section} name="settings">
          <p className="muted">
            Members can view activity and send test events. Admins manage
            applications, endpoints, keys, and invitations. Only the owner can
            delete this workspace or transfer ownership.
          </p>
          {data.role === "OWNER" ? (
            <>
              <p>Transfer ownership before leaving this workspace.</p>
              <button
                className="btn secondary"
                disabled={busy}
                onClick={async () => {
                  if (
                    !(await confirm({
                      title: "Permanently delete workspace?",
                      description: `Delete ${data.name}, all applications, API keys, endpoints, events and delivery history? This cannot be undone.`,
                      label: "Delete everything",
                    }))
                  )
                    return;
                  setBusy(true);
                  try {
                    await api(`/api/workspaces/${id}`, {}, "DELETE");
                    localStorage.removeItem("workspaceId");
                    window.location.assign("/dashboard");
                  } catch (e) {
                    setFailure((e as Error).message);
                    setBusy(false);
                  }
                }}
              ><Trash2 size={16} aria-hidden="true" /><T text={"Delete workspace"} /></button>
            </>
          ) : (
            <button
              className="btn secondary"
              disabled={busy}
              onClick={async () => {
                if (
                  !(await confirm({
                    title: "Leave workspace?",
                    description:
                      "You will lose access and need a new invitation to return.",
                    label: "Leave",
                  }))
                )
                  return;
                try {
                  await api(`/api/workspaces/${id}/leave`, {});
                  localStorage.removeItem("workspaceId");
                  window.location.assign("/dashboard");
                } catch (e) {
                  setFailure((e as Error).message);
                }
              }}
            ><LogOut size={16} aria-hidden="true" /><T text={"Leave workspace"} /></button>
          )}
          </Section>
        </>
      )}
    </section>
  );
}
function Invites({
  id,
  revoke,
}: {
  id: string;
  revoke: (id: string) => Promise<void>;
}) {
  const { data, error, reload } = useData<Invite[]>(
    `/api/workspaces/${id}/invites`,
    true,
  );
  return (
    <>
      <h3>Pending invitations</h3>
      <ErrorBox error={error} />
      {data?.length ? (
        data.map((i) => (
          <p key={i.id} className="pending-invite">
            {i.email} · {i.role} · expires{" "}
            {new Date(i.expiresAt).toLocaleString()}{" "}
            <button
              className="btn quiet"
              onClick={async () => {
                await revoke(i.id);
                await reload();
              }}
            ><Ban size={16} aria-hidden="true" /><T text={"Revoke"} /></button>
          </p>
        ))
      ) : (
        <p>No pending invitations.</p>
      )}
    </>
  );
}
export default function Page() {
  const section = useSection(["overview", "members", "invitations", "settings"]);
  const { data, error, reload } =
    useData<WorkspaceMembership[]>("/api/workspaces");
  const [failure, setFailure] = useState("");
  const [selected, setSelected] = useState("");
  return (
    <Shell>
      <div className="workspaces-page">
        <h1>Workspaces &amp; teams</h1>
        <ErrorBox error={error || failure} />
        <label><T text={"Manage workspace"} /><Select
            label="Manage workspace"
            workspace
            value={selected || data?.[0]?.workspaceId || ""}
            onChange={setSelected}
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
          />
        </label>
        <SectionNav active={section} items={[{ id: "overview", label: "Overview" }, { id: "members", label: "Members" }, { id: "invitations", label: "Invitations" }, { id: "settings", label: "Settings" }]} />
        <Section active={section} name="overview">
        {data?.length ? <section className="panel panel-body">
          <h2>{(data.find((m) => m.workspaceId === selected) || data[0]).workspace.name}</h2>
          <p className="muted">Your role: {(data.find((m) => m.workspaceId === selected) || data[0]).role}</p>
          <a className="btn secondary" href="#members"><T text="Manage members" /></a>
        </section> : <p className="muted">Create a workspace to invite teammates and manage applications.</p>}
        <form
          className="panel panel-body workspace-create"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const w = await api<{ id: string }>("/api/workspaces", {
                name: new FormData(e.currentTarget).get("name"),
              });
              setSelected(w.id);
              await reload();
            } catch (e) {
              setFailure((e as Error).message);
            }
          }}
        >
          <label><T text={"New workspace name"} /><input name="name" maxLength={100} required />
          </label>
          <button className="btn"><Plus size={16} aria-hidden="true" /><T text={"Create workspace"} /></button>
        </form>
        </Section>
        {(selected || data?.[0]) && (
          <div hidden={section === "overview"}>
          <Team
            key={selected || data?.[0]?.workspaceId}
            id={selected || data![0].workspaceId}
            refresh={reload}
            section={section}
          />
          </div>
        )}
      </div>
    </Shell>
  );
}
