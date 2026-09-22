import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach } from "vitest";
const controls = vi.hoisted(() => ({ workspace: vi.fn(() => null) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/docs", useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/components/workspace-switcher", () => ({ WorkspaceSwitcher: controls.workspace }));
import { Shell } from "@/components/shell";
import { SiteTools } from "@/components/site-tools";
describe("public documentation shell", () => {
  beforeEach(() => vi.clearAllMocks());
  it("never mounts authenticated data loaders or search for a signed-out visitor", () => {
    const html = renderToStaticMarkup(<SiteTools signedIn={false}><Shell>Public documentation</Shell></SiteTools>);
    expect(controls.workspace).not.toHaveBeenCalled();
    expect(html).not.toContain("Search everything");
    expect(html).not.toContain("Sign out");
    expect(html).not.toContain("topbar-signout");
    expect(html).toContain("Public documentation");
  });
  it("retains workspace controls and search for an authenticated session", () => {
    const html = renderToStaticMarkup(<SiteTools signedIn><Shell>Private workspace</Shell></SiteTools>);
    expect(controls.workspace).toHaveBeenCalled();
    expect(html).toContain("Search everything");
    expect(html.match(/Sign out/g)).toHaveLength(1);
    expect(html.match(/href="\/profile"/g)).toHaveLength(1);
    expect(html).toContain("topbar-signout");
  });
});
