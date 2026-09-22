import { expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
vi.mock("../../lib/security", () => ({ newSecret: () => "secret", resolveEndpoint: vi.fn(async () => undefined) }));
import { resolveEndpoint } from "../../lib/security";
import { newEndpointData } from "../../lib/endpoint-config";
import { decryptEndpointSecret } from "../../lib/endpoint-secrets";
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.name !== "node_modules" && e.name !== "dist")
    .flatMap(e => e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name).replaceAll("\\", "/")] : []);
}
it("requires every production endpoint creator to use the shared validation/encryption factory", () => {
  const creators = ["app/api/applications/[id]/endpoints/route.ts", "lib/cli-api.ts", "lib/portal.ts"];
  const actual = [...sources("app"), ...sources("lib"), ...sources("worker")].filter(file => /\.endpoint\.(create|createMany|upsert)\(/.test(readFileSync(file, "utf8")));
  expect(actual.sort()).toEqual(creators.sort());
  for (const file of actual) expect(readFileSync(file, "utf8")).toMatch(/await newEndpointData\(/);
});
it("validates DNS before encrypting and binds newly created endpoints to their own identity", async () => {
  const data = await newEndpointData("app", "https://example.com", ["*"]);
  expect(resolveEndpoint).toHaveBeenCalledWith("https://example.com");
  expect(data.signatureFormat).toBe("STANDARD");
  expect(decryptEndpointSecret(data.secret, data)).toBe("secret");
  expect(() => decryptEndpointSecret(data.secret, { ...data, id: "other" })).toThrow();
  await expect(newEndpointData("app", "file:///etc/passwd", [])).rejects.toThrow();
});

it("requires review of every new endpoint write path", () => {
  const writers = [...sources("app"), ...sources("lib"), ...sources("worker")].filter(file => /\.endpoint\.(create|createMany|upsert|update|updateMany)\(/.test(readFileSync(file, "utf8")));
  expect(writers.sort()).toEqual([
    "app/api/applications/[id]/endpoints/route.ts", "app/api/endpoints/[id]/pause/route.ts",
    "app/api/endpoints/[id]/resume/route.ts", "app/api/endpoints/[id]/retry-policy/route.ts",
    "app/api/endpoints/[id]/signature-format/route.ts", "app/api/endpoints/[id]/configuration/route.ts", "lib/cli-api.ts", "lib/diagnosis.ts",
    "lib/migrate-endpoint-secrets.ts", "lib/migrate-secrets.ts", "lib/portal.ts", "lib/signing-secrets.ts", "worker/index.ts",
  ].sort());
});
