import { unstable_rethrow } from "next/navigation";

/* Server actions must not throw at their boundary.
   In Next 16 a thrown action error is answered with HTTP 500 and a Flight
   payload the browser cannot turn back into a message, so the studio showed
   "Minified React error #441" instead of the sentence the action had already
   written for the person reading it — "Invalid username or password" became
   noise. Validation failures are data, not exceptions: every action returns
   `ActionResult` and the client unwraps it. Nothing here is "use server" — it
   is imported by both sides. */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Carries an action's own message across `unwrap` so callers keep their
    existing `caught instanceof Error ? caught.message : …` handling. */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}

/** Framework control-flow (redirect, notFound) is rethrown. Everything else
    becomes `{ ok: false }` with the same public sentence `run` uses. */
export function actionFailure(caught: unknown): ActionResult<never> {
  unstable_rethrow(caught);
  const digest = (caught as { digest?: unknown } | null)?.digest;
  console.error("[action] failed", {
    message: caught instanceof Error ? caught.message : String(caught),
    ...(typeof digest === "string" || typeof digest === "number" ? { digest } : {}),
    caught,
  });
  return { ok: false, error: publicMessage(caught) };
}

export async function run<T>(body: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await body() };
  } catch (caught) {
    return actionFailure(caught);
  }
}

/** Unwrap on the client. Failure throws, so existing catch blocks keep working. */
export function unwrap<T>(result: ActionResult<T>): T {
  if (result.ok) return result.data;
  throw new ActionError(result.error);
}

export const GENERIC_ACTION_ERROR = "Something went wrong. Try again.";

/* Messages written for the person reading them are returned as-is — they are
   the whole point of the action's phrasing. Anything that looks like
   infrastructure keeps a generic sentence and its detail stays in the log. */
const INFRASTRUCTURE = [
  /SESSION_SECRET/i,
  /DATABASE_URL/i,
  /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EPIPE|PROTOCOL_CONNECTION_LOST/i,
  /ER_[A-Z_]+/, // MySQL error codes (ER_ACCESS_DENIED_ERROR, ER_NO_SUCH_TABLE, …)
  /Unknown column|Unknown table|doesn't exist/i,
  /ENOENT|EACCES|EPERM/,
  /Cannot find module|is not a function|undefined is not/i,
];

function publicMessage(caught: unknown): string {
  if (!(caught instanceof Error)) return GENERIC_ACTION_ERROR;
  const message = caught.message.replace(/\s+/g, " ").trim();
  if (!message) return GENERIC_ACTION_ERROR;
  if (INFRASTRUCTURE.some((pattern) => pattern.test(message))) return GENERIC_ACTION_ERROR;
  /* Framework errors carry a digest and are not ours to phrase. */
  const digest = (caught as { digest?: unknown }).digest;
  if (digest !== undefined && caught.name === "Error" && /\bdigest\b/i.test(String(digest))) {
    return GENERIC_ACTION_ERROR;
  }
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}
