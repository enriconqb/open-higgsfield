import { readSession } from "@/auth/session";
import { subscribeTeamGallery } from "@/generation/gallery-signal";
import { requireTeamRole } from "@/teams/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One waiting connection per open team studio. A gallery change sends a single refresh. */
export async function GET(request: Request): Promise<Response> {
  const session = await readSession();
  if (!session) return new Response(null, { status: 401 });
  const teamId = Number(new URL(request.url).searchParams.get("team"));
  if (!Number.isInteger(teamId) || teamId <= 0) return new Response(null, { status: 400 });
  try {
    await requireTeamRole(session, teamId, false);
  } catch {
    return new Response(null, { status: 403 });
  }

  const encoder = new TextEncoder();
  let unsubscribe = () => undefined as void;
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* The browser already closed the connection. */
        }
      };
      unsubscribe = subscribeTeamGallery(teamId, () => send("data: refresh\n\n"));
      ping = setInterval(() => send(": ping\n\n"), 25_000);
      send(": open\n\n");
    },
    cancel() {
      if (ping) clearInterval(ping);
      unsubscribe();
    },
  });

  request.signal.addEventListener("abort", () => {
    if (ping) clearInterval(ping);
    unsubscribe();
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
