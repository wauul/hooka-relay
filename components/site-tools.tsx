"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Search,
  X,
  ArrowUp,
  MessageCircle,
  ArrowUpRight,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { outboundUrl, searchSite, type SearchResult } from "@/lib/site";

type Confirmation = { title: string; description: string; label?: string };
const Tools = createContext({
  search: () => {},
  confirm: async (_options: Confirmation) => false,
});
export const useConfirm = () => useContext(Tools).confirm;
export function SearchButton() {
  const { search } = useContext(Tools);
  return (
    <button className="search-trigger" type="button" onClick={search}>
      <Search size={16} />
      <span>Search everything</span>
      <kbd>⌘ / Ctrl K</kbd>
    </button>
  );
}
export function OutboundLink({
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a {...props} href={outboundUrl(href)} rel="noopener noreferrer">
      {children}
    </a>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
function SiteSearch({ close }: { close: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResults([]);
      setBusy(false);
      setNotice("");
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    setNotice("");
    setResults([]);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(text)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!controller.signal.aborted) {
          setResults(data.results);
          setNotice(data.warning || "");
        }
      } catch {
        if (!controller.signal.aborted) {
          setResults(searchSite(text));
          setNotice(
            "Connection interrupted. Showing available documentation results.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return (
    <Modal title="Search Hooka Relay" onClose={close}>
      <label htmlFor="site-query">
        Documentation, applications, endpoints and events
      </label>
      <input
        data-autofocus
        id="site-query"
        type="search"
        value={query}
        maxLength={100}
        placeholder="Try “retries”, an endpoint URL or event ID"
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="search-status muted" role="status">
        {busy ? (
          <>
            <Loader2 className="spin" size={16} /> Searching…
          </>
        ) : query.trim().length < 2 ? (
          "Type at least 2 characters. Your workspace results are private to your account."
        ) : (
          `${results.length} results`
        )}
      </p>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <ul className="search-results">
        {results.map((result) => (
          <li key={`${result.category}-${result.href}-${result.description}`}>
            <Link href={result.href} onClick={close}>
              <span className="eyebrow">{result.category}</span>
              <strong>{result.title}</strong>
              <span className="muted">{result.description}</span>
            </Link>
          </li>
        ))}
      </ul>
      {!busy && query.trim().length >= 2 && !results.length && (
        <div className="empty">
          <Search size={28} />
          <h3>No matches yet</h3>
          <p>Try a shorter phrase, an application name or an event ID.</p>
        </div>
      )}
    </Modal>
  );
}
export function SiteTools({ children }: { children: React.ReactNode }) {
  const [overlay, setOverlay] = useState<"search" | "contact" | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const pending = useRef<((value: boolean) => void) | null>(null);
  const [cookie, setCookie] = useState(false);
  const progress = useRef<HTMLDivElement>(null);
  const [up, setUp] = useState(false);
  const pathname = usePathname();
  const resolve = useCallback((value: boolean) => {
    pending.current?.(value);
    pending.current = null;
    setConfirmation(null);
  }, []);
  const confirm = useCallback(
    (options: Confirmation) =>
      new Promise<boolean>((resolvePromise) => {
        pending.current?.(false);
        pending.current = resolvePromise;
        setOverlay(null);
        setConfirmation(options);
      }),
    [],
  );
  useEffect(() => {
    try {
      setCookie(localStorage.getItem("hooka-cookie-notice-v1") !== "dismissed");
    } catch {
      setCookie(true);
    }
  }, []);
  useEffect(() => {
    setOverlay(null);
    resolve(false);
    const handle = () => {
      const el = document.getElementById(location.hash.slice(1));
      if (el instanceof HTMLDetailsElement) el.open = true;
    };
    handle();
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, [pathname, resolve]);
  useEffect(() => {
    let closed: HTMLDetailsElement[] = [];
    const beforePrint = () => {
      closed = Array.from(
        document.querySelectorAll<HTMLDetailsElement>("details:not([open])"),
      );
      closed.forEach((detail) => {
        detail.open = true;
      });
    };
    const afterPrint = () => {
      closed.forEach((detail) => {
        detail.open = false;
      });
      closed = [];
    };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, []);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - innerHeight;
      if (progress.current)
        progress.current.style.transform = `scaleX(${max > 0 ? Math.max(0, Math.min(1, scrollY / max)) : 0})`;
      setUp(scrollY > 400);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        !pending.current
      ) {
        event.preventDefault();
        setOverlay((value) => (value === "search" ? null : "search"));
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      pending.current?.(false);
    };
  }, []);
  return (
    <Tools.Provider value={{ search: () => setOverlay("search"), confirm }}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div
        ref={progress}
        className="scroll-progress"
        aria-hidden="true"
        style={{ transform: "scaleX(0)" }}
      />
      {children}
      <div className={`floating-tools ${cookie ? "with-cookie" : ""}`}>
        {up && (
          <button
            className="icon-button back-top"
            type="button"
            aria-label="Back to top"
            onClick={() => {
              window.scrollTo({
                top: 0,
                behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                  ? "instant"
                  : "smooth",
              });
              document
                .getElementById("main-content")
                ?.focus({ preventScroll: true });
            }}
          >
            <ArrowUp size={19} />
          </button>
        )}
        <button
          className="contact-button"
          aria-label="Get in touch"
          type="button"
          onClick={() => setOverlay("contact")}
        >
          <MessageCircle size={18} />
          <span>Get in touch</span>
        </button>
      </div>
      {cookie && (
        <section className="cookie-banner" aria-label="Cookie notice">
          <ShieldCheck size={22} />
          <div>
            <strong>Just the essentials.</strong>
            <p>
              We use cookies to keep you signed in and protect your session. No
              advertising or optional analytics cookies.
            </p>
            <Link href="/docs#faq-5">Cookie details</Link>
          </div>
          <button
            className="btn secondary"
            onClick={() => {
              setCookie(false);
              try {
                localStorage.setItem("hooka-cookie-notice-v1", "dismissed");
              } catch {}
            }}
          >
            Got it
          </button>
        </section>
      )}
      {overlay === "search" && <SiteSearch close={() => setOverlay(null)} />}
      {overlay === "contact" && (
        <Modal
          title="Let’s make delivery better."
          onClose={() => setOverlay(null)}
        >
          <p className="muted">
            Found a bug or have a feature in mind? Open an issue in the Hooka
            Relay project.
          </p>
          <OutboundLink
            className="btn"
            href="https://github.com/wauul/hooka-relay/issues/new"
            target="_blank"
          >
            Contact the project <ArrowUpRight size={16} />
          </OutboundLink>
          <p className="muted small">
            GitHub issues are public. Keep API keys, signing secrets and private
            payloads out of your report.
          </p>
          <Link
            className="back"
            href="/docs#faq"
            onClick={() => setOverlay(null)}
          >
            Browse frequently asked questions →
          </Link>
        </Modal>
      )}
      {confirmation && (
        <Modal title={confirmation.title} onClose={() => resolve(false)}>
          <p className="muted">{confirmation.description}</p>
          <div className="modal-actions">
            <button
              data-autofocus
              type="button"
              className="btn secondary"
              onClick={() => resolve(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => resolve(true)}
            >
              {confirmation.label || "Confirm"}
            </button>
          </div>
        </Modal>
      )}
    </Tools.Provider>
  );
}
