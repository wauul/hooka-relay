"use client";
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
function Team({ id, refresh }: { id: string; refresh: () => Promise<void> }) {
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
              <label>
                Workspace name
                <input
                  name="name"
                  defaultValue={data.name}
                  maxLength={100}
                  required
                />
              </label>
              <button className="btn" disabled={busy}>
                Rename
              </button>
            </form>
          )}
          <h3>Members</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Actions</th>
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
                                >
                                  Remove
                                </button>
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
                                >
                                  Transfer ownership
                                </button>
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
                <label>
                  Role
                  <Select
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
                  Send invitation
                </button>
              </form>
              <Invites
                id={id}
                revoke={(invite) => action(`/invites/${invite}`, {}, "DELETE")}
              />
            </>
          )}
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
              >
                Delete workspace
              </button>
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
            >
              Leave workspace
            </button>
          )}
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
            >
              Revoke
            </button>
          </p>
        ))
      ) : (
        <p>No pending invitations.</p>
      )}
    </>
  );
}
export default function Page() {
  const { data, error, reload } =
    useData<WorkspaceMembership[]>("/api/workspaces");
  const [failure, setFailure] = useState("");
  const [selected, setSelected] = useState("");
  return (
    <Shell>
      <div className="workspaces-page">
        <h1>Workspaces &amp; teams</h1>
        <ErrorBox error={error || failure} />
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
          <label>
            New workspace name
            <input name="name" maxLength={100} required />
          </label>
          <button className="btn">Create workspace</button>
        </form>
        <label>
          Manage workspace
          <Select
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
        {(selected || data?.[0]) && (
          <Team
            key={selected || data?.[0]?.workspaceId}
            id={selected || data![0].workspaceId}
            refresh={reload}
          />
        )}
      </div>
    </Shell>
  );
}
