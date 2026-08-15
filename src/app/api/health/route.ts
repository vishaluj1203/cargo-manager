export function GET() { return Response.json({ ok: true, service: "cargo-manager", timestamp: new Date().toISOString() }); }
