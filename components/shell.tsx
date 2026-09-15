"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { SearchButton } from "./site-tools";
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
    <Link href="/dashboard" className="brand">
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
          <div className="workspace">
            <span className="avatar">W</span>
            <span>Personal workspace</span>
            <ChevronDown size={12} />
          </div>
          <div className="nav-label">WORKSPACE</div>
          <nav aria-label="Main navigation" onClick={() => setMenu(false)}>
            <Link
              className={`nav-link ${path != "/docs" ? "active" : ""}`}
              href="/dashboard"
            >
              <Layers3 size={17} />
              Applications
            </Link>
            <Link
              className={`nav-link ${path === "/docs" ? "active" : ""}`}
              href="/docs"
            >
              <BookOpen size={17} />
              Documentation
            </Link>
          </nav>
          <div className="sidebar-bottom">
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
            <button
              className="nav-link"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div>
        <header className="topbar">
          <span>
            Workspace <ArrowRight size={12} />{" "}
            {path === "/docs" ? "Documentation" : "Applications"}
          </span>
          <SearchButton />
        </header>
        <main className="content" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
