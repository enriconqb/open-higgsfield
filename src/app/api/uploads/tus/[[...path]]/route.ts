import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "fs/promises";
import path from "path";

import { FileStore } from "@tus/file-store";
import { Server } from "@tus/server";

import { AuthRequiredError, requireActiveUser } from "@/auth/guard";
import { configuredBasePath } from "@/base-path";
import {
  sniffImageMime,
  uploadFilePath,
  uploadMaxBytes,
  uploadRoot,
  uploadTypePath,
} from "@/generation/local-upload";

const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "audio/wav",
  "audio/x-wav",
]);

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const STALE_MS = 6 * 60 * 60 * 1000;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function tusDir(): string {
  return path.join(uploadRoot(), "tus");
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status_code: status, body: `${message}\n` });
}

let server: Server | null = null;

function tusServer(): Server {
  if (server) return server;
  const directory = tusDir();
  server = new Server({
    path: "/api/uploads/tus",
    relativeLocation: true,
    datastore: new FileStore({ directory, expirationPeriodInMilliseconds: STALE_MS }),
    maxSize: () => uploadMaxBytes(),
    namingFunction: () => crypto.randomUUID(),
    generateUrl: (_req: Request, info: { id: string }) => `${configuredBasePath()}/api/uploads/tus/${info.id}`,
    async onIncomingRequest() {
      try {
        await requireActiveUser();
      } catch (caught) {
        if (caught instanceof AuthRequiredError) throw httpError(401, "Login required");
        throw caught;
      }
    },
    async onUploadCreate(_req: Request, upload: { size?: number; metadata?: Record<string, string | null> }) {
      const type = upload.metadata?.filetype ?? "";
      if (!ALLOWED.has(type)) throw httpError(415, "Unsupported file type");
      if (upload.size !== undefined && upload.size > uploadMaxBytes()) {
        throw httpError(413, `File is larger than ${Math.floor(uploadMaxBytes() / (1024 * 1024))} MB`);
      }
      void sweepStale();
      return {};
    },
    async onUploadFinish(_req: Request, upload: { id: string; metadata?: Record<string, string | null> }) {
      const type = upload.metadata?.filetype || "application/octet-stream";
      const source = path.join(directory, upload.id);
      const bytes = await readFile(source);
      if (IMAGE_TYPES.has(type) && !sniffImageMime(bytes)) {
        await unlink(source).catch(() => undefined);
        throw httpError(415, "File is not a png, jpeg, webp, or gif");
      }
      const id = upload.id;
      await mkdir(uploadRoot(), { recursive: true });
      await rename(source, uploadFilePath(id)).catch(async () => {
        const { copyFile } = await import("fs/promises");
        await copyFile(source, uploadFilePath(id));
        await unlink(source).catch(() => undefined);
      });
      await writeFile(uploadTypePath(id), type);
      await unlink(path.join(directory, `${id}.json`)).catch(() => undefined);
      return {
        headers: { "X-Upload-Url": `/api/uploads/${id}` },
      };
    },
  });
  return server;
}

async function sweepStale(): Promise<void> {
  const directory = tusDir();
  const names = await readdir(directory).catch(() => []);
  const cutoff = Date.now() - STALE_MS;
  await Promise.all(
    names.map(async (name) => {
      const file = path.join(directory, name);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile() || info.mtimeMs > cutoff) return;
      await unlink(file).catch(() => undefined);
    }),
  );
}

async function handle(request: Request): Promise<Response> {
  await mkdir(tusDir(), { recursive: true });
  return tusServer().handleWeb(request);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const HEAD = handle;
export const OPTIONS = handle;
export const DELETE = handle;
