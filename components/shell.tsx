"use client";
import { T } from "@/components/preferences";
import { PreferencesMenu } from "./preferences";
import { Users, Settings } from "lucide-react";
import { SupportChat } from "./support-chat";
import { ProfileLink } from "./profile-link";
import { WorkspaceSwitcher } from "./workspace-switcher";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { SearchButton, useSignedIn } from "./site-tools";
import { Menu, X } from "lucide-react";
import {
  Layers3,
  BookOpen,
  ArrowUpRight,
  LogOut,
  Webhook,
  ChevronDown,
  ArrowRight,
} from "lucide-react";
export function Brand() {
  return (
    <Link href="/" className="brand">
      <span className="brand-mark">
        <Webhook size={23} />
      </span>
      hooka
      <span style={{ color: "#8b959f", fontWeight: 400, marginLeft: -5 }}>
        relay
      </span>
    </Link>
  );
}
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const signedIn = useSignedIn();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="mobile-brand-row">
          <Brand />
          <button
            className="icon-button mobile-toggle"
            type="button"
            aria-label={menu ? "Close menu" : "Open menu"}
            aria-expanded={menu}
            aria-controls="workspace-navigation"
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
        <div
          id="workspace-navigation"
          className={`navigation-content ${menu ? "is-open" : ""}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setMenu(false);
              document
                .querySelector<HTMLButtonElement>(".mobile-toggle")
                ?.focus();
            }
          }}
        >
          {signedIn && <WorkspaceSwitcher />}
          <div className="nav-label">{signedIn ? "WORKSPACE" : "HOOKA RELAY"}</div>
          <nav aria-label="Main navigation" onClick={() => setMenu(false)}>
            <Link
              className={`nav-link ${path === "/dashboard" || path.startsWith("/applications") || path.startsWith("/endpoints") ? "active" : ""}`}
              href="/dashboard"
            >
              <Layers3 size={17} /><T text={"Applications"} /></Link>
            <Link
              className={`nav-link ${path === "/docs" ? "active" : ""}`}
              href="/docs"
            >
              <BookOpen size={17} /><T text={"Documentation"} /></Link>
            {signedIn && <><Link className={`nav-link ${path === "/workspaces" ? "active" : ""}`} href="/workspaces"><Users size={17} /><T text={"Workspace & Team"} /></Link>
            <Link className={`nav-link ${path === "/profile" ? "active" : ""}`} href="/profile"><Settings size={17} /><T text={"Settings"} /></Link></>}
          </nav>
          <div className="sidebar-bottom">
            {signedIn && <ProfileLink />}
            <div className="plan">
              <strong>
                <span className="dot" /> Built for reliability
              </strong>
              At-least-once delivery.
              <br />
              Visibility at every step.
              <Link
                href="/docs"
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 13,
                  color: "#b9d9c0",
                }}
              >
                Explore the API <ArrowUpRight size={13} />
              </Link>
            </div>
            {signedIn ? <button
              className="nav-link"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut size={16} /><T text={"Sign out"} /></button> : <Link className="btn" href="/login"><ArrowRight size={16} /><T text="Sign in" /></Link>}
          </div>
        </div>
      </aside>
      <div>
        <header className="topbar">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <Link href={signedIn ? "/dashboard" : "/"}><T text={signedIn ? "Workspace" : "Home"} /></Link>
            <ArrowRight size={12} aria-hidden="true" />
            <Link
              href={
                path === "/docs"
                  ? "/docs"
                  : path === "/profile"
                    ? "/profile"
                    : path === "/workspaces"
                      ? "/workspaces"
                      : "/dashboard"
              }
              aria-current="page"
            >
              <T text={path === "/docs"
                ? "Documentation"
                : path === "/profile"
                  ? "Your profile"
                  : path === "/workspaces"
                    ? "Teams"
                    : "Applications"} />
            </Link>
          </nav>
          <div className="topbar-actions"><PreferencesMenu /><SearchButton /></div>
        </header>
        <main className="content" id="main-content" tabIndex={-1}>
          {children}
          {(path === "/docs" || path.startsWith("/dashboard")) && <SupportChat />}
        </main>
      </div>
    </div>
  );
}

