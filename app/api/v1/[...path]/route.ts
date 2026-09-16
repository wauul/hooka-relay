import { cliApi } from "@/lib/cli-api";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return cliApi(req, (await params).path);
}
export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return cliApi(req, (await params).path);
}
