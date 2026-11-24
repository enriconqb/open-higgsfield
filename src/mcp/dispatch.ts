import { ApiError, requireApiContext, requireApiCredentials, requireApiIdentity } from "@/auth/api-auth";
import { jobNeedsPoll, jobResponse, refreshJob, requireJob } from "@/app/api/v1/_lib/jobs";
import { submitGeneration } from "@/app/api/v1/_lib/submit-generation";
import { getApiKeyRow } from "@/auth/users";
import { modelsFor } from "@/generation/catalog";
import { readModelMarks } from "@/models/actions";
import { sortModelsByMark, type ModelMark } from "@/models/marks";

export const PROTOCOL = "2025-03-26";

const TOOLS = [
  {
    name: "vicend_whoami",
    description: "Who this Vicend API token belongs to, and which workspace its jobs are recorded in.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    scope: "read" as const,
  },
  {
    name: "vicend_list_models",
    description: "Image, video, and audio models this token can run. Pass one of those ids to vicend_generate.",
    inputSchema: {
      type: "object",
      properties: {
        surface: { type: "string", enum: ["image", "video", "audio"], description: "Optional filter." },
      },
      additionalProperties: false,
    },
    scope: "read" as const,
  },
  {
    name: "vicend_generate",
    description:
      "Start an image, video, or audio generation on Vicend. The job is stored on the token owner's account and workspace. Poll vicend_job until status is completed or failed.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string" },
        prompt: { type: "string" },
        settings: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } },
        media: { type: "object" },
        idempotencyKey: { type: "string" },
      },
      required: ["model", "prompt"],
      additionalProperties: false,
    },
    scope: "generate" as const,
  },
  {
    name: "vicend_job",
    description: "Read one Vicend job by requestId, refreshing it from the platform when it is still running.",
    inputSchema: {
      type: "object",
      properties: { requestId: { type: "string" } },
      required: ["requestId"],
      additionalProperties: false,
    },
    scope: "read" as const,
  },
];

type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

export async function handleMcp(request: Request, message: Rpc): Promise<{ http: number; body: unknown | null }> {
  const method = typeof message.method === "string" ? message.method : "";
  const id = message.id ?? null;
  const note = method.startsWith("notifications/");
  if (note) return { http: 202, body: null };
  if (method === "initialize") {
    return { http: 200, body: ok(id, {
      protocolVersion: PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "vicend", version: "1.0.0" },
      instructions:
        "Use vicend_list_models, then vicend_generate, then vicend_job. The bearer token is a Vicend API token. Jobs are recorded on that token's account.",
    }) };
  }
  if (method === "ping") return { http: 200, body: ok(id, {}) };
  if (method === "tools/list") return { http: 200, body: ok(id, { tools: TOOLS.map(({ scope: _scope, ...tool }) => tool) }) };
  if (method === "tools/call") {
    try {
      const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
      const name = typeof params.name === "string" ? params.name : "";
      const tool = TOOLS.find((item) => item.name === name);
      if (!tool) return { http: 200, body: ok(id, toolError(`Unknown tool: ${name}`)) };
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const text = await callTool(request, tool.name, tool.scope, args);
      return { http: 200, body: ok(id, { content: [{ type: "text", text }], isError: false }) };
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : "Request failed";
      return { http: 200, body: ok(id, toolError(detail)) };
    }
  }
  return { http: 200, body: err(id, -32601, `Method not found: ${method}`) };
}

async function callTool(
  request: Request,
  name: string,
  scope: "read" | "generate",
  args: Record<string, unknown>,
): Promise<string> {
  if (name === "vicend_generate") {
    const context = await requireApiContext(request, "generate");
    const result = await submitGeneration(request, context, args);
    return JSON.stringify(result.payload);
  }
  const identity = await requireApiIdentity(request, scope);
  if (name === "vicend_whoami") {
    return JSON.stringify({
      username: identity.username,
      tokenLabel: identity.tokenLabel,
      scopes: identity.scopes,
      workspace: identity.teamId == null ? "personal" : "team",
      teamId: identity.teamId,
    });
  }
  if (name === "vicend_list_models") {
    const keyRow = await getApiKeyRow(identity.userId);
    const platform = keyRow?.provider ?? "openrouter";
    const marks: Partial<Record<string, ModelMark>> = await readModelMarks().catch(() => ({}));
    const surface = typeof args.surface === "string" ? args.surface : "";
    const models = sortModelsByMark(modelsFor(platform), marks).filter((model) => !surface || model.surface === surface);
    return JSON.stringify({
      platform,
      models: models.map((model) => ({ id: model.id, surface: model.surface, label: model.label })),
    });
  }
  const requestId = typeof args.requestId === "string" ? args.requestId.trim() : "";
  if (!requestId) throw new ApiError(400, "requestId is required");
  let job = await requireJob(identity.userId, requestId);
  if (jobNeedsPoll(job)) {
    const credentials = await requireApiCredentials(identity);
    const { originOf } = await import("@/generation/engine");
    job = await refreshJob({ userId: identity.userId, credentials, origin: originOf(request), tokenId: identity.tokenId, teamId: identity.teamId }, job);
  }
  return JSON.stringify(jobResponse(request, job));
}

function ok(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function err(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolError(text: string) {
  return { content: [{ type: "text", text }], isError: true };
}
