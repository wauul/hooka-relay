import spec from "@/docs/openapi.json";
export function GET() {
  return Response.json(spec, { headers: { "Cache-Control": "public, max-age=300" } });
}
