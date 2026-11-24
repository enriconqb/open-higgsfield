import { handleMcp } from "@/mcp/dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HEADERS = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, accept, x-api-key, x-auth-token, mcp-session-id",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
};

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: HEADERS });
}

export function GET(): Response {
  return Response.json(
    { detail: "Vicend MCP accepts POST JSON-RPC at this URL." },
    { status: 405, headers: { ...HEADERS, Allow: "POST, DELETE, OPTIONS" } },
  );
}

export function DELETE(): Response {
  return new Response(null, { status: 200, headers: HEADERS });
}

export async function POST(request: Request): Promise<Response> {
  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400, headers: HEADERS },
    );
  }
  if (message === null || typeof message !== "object" || Array.isArray(message)) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Expected one JSON-RPC object" } },
      { status: 400, headers: HEADERS },
    );
  }
  const result = await handleMcp(request, message as { method?: unknown; id?: unknown; params?: unknown });
  if (result.body == null) return new Response(null, { status: result.http, headers: HEADERS });
  return Response.json(result.body, { status: result.http, headers: HEADERS });
}
