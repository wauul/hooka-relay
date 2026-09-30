import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ providers: {} as Record<string, unknown> }));
vi.mock("@/components/ui", () => ({ useData: () => ({ data: state.providers }) }));
vi.mock("@/components/preferences", () => ({ T: ({ text }: { text: string }) => text }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
import { OAuthButtons } from "../../components/oauth-buttons";

beforeEach(() => { state.providers = { github: {}, google: {}, "azure-ad": {} }; });

it("offers Microsoft in the shared sign-in/sign-up controls", () => {
  const html = renderToStaticMarkup(<OAuthButtons callbackUrl="/invites/accept?token=test" />);
  expect(html).toContain("Microsoft");
  expect(html.match(/<button/g)).toHaveLength(3);
  expect(html).not.toContain("disabled");
});

it("disables Microsoft when it is unconfigured or already linked", () => {
  state.providers = {};
  expect(renderToStaticMarkup(<OAuthButtons />)).toContain("Microsoft · not configured");
  state.providers = { "azure-ad": {} };
  const html = renderToStaticMarkup(<OAuthButtons linking connected={["azure-ad"]} />);
  expect(html).toMatch(/disabled=""[^>]*>.*Connected to.*Microsoft/);
});
