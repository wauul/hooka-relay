import { portalRequest } from "@/lib/portal";
type Context = { params: Promise<{ token: string }> };
async function handler(req: Request, { params }: Context) { return portalRequest(req, (await params).token); }
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
