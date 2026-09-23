import { providers } from "@/lib/webhook-providers";
export async function GET() {
  return Response.json(Object.values(providers).map(({ name, displayName, icon, docsUrl, setupInstructions, testEventSupport }) => ({ name, displayName, icon, docsUrl, setupInstructions, testEventSupport })));
}
