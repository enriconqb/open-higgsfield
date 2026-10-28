import { AuthRequiredError, ForbiddenError } from "./errors";
import { readSession } from "./session";
import type { SessionUser } from "./types";

export { AuthRequiredError, ForbiddenError };

export async function requireActiveUser(): Promise<SessionUser> {
  const session = await readSession();
  if (!session || session.status !== "active") {
    throw new AuthRequiredError();
  }
  return session;
}

export async function requireSuperadmin(): Promise<SessionUser> {
  const user = await requireActiveUser();
  if (user.role !== "superadmin") throw new ForbiddenError();
  return user;
}
