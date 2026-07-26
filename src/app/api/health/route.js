export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    service: "desaynclaw",
    timestamp: new Date().toISOString(),
  });
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}
