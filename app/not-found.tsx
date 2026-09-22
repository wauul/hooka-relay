import { T } from "@/components/preferences";
import Link from "next/link";
import { Shell } from "@/components/shell";
import { SearchButton } from "@/components/site-tools";
import { ArrowRight, Unplug } from "lucide-react";
export default function NotFound() {
  return (
    <Shell>
      <section className="not-found">
        <span className="eyebrow">404 · DESTINATION NOT FOUND</span>
        <div className="lost-illustration" aria-hidden="true">
          <span>404</span>
          <Unplug size={60} />
        </div>
        <h1>This route hit a dead end.</h1>
        <p className="muted">
          The page may have moved, or the address might be incomplete. Your
          webhooks haven’t gone anywhere.
        </p>
        <div className="recovery-actions">
          <Link className="btn" href="/dashboard"><T text={"Back to workspace"} /><ArrowRight size={16} />
          </Link>
          <Link className="btn secondary" href="/docs"><T text={"Read the docs"} /></Link>
        </div>
        <SearchButton />
      </section>
    </Shell>
  );
}
