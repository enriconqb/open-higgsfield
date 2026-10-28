"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { MediaItem, MediaRole, ModelEntry } from "@/generation/catalog";
import { useImageMedia, useVideoMedia } from "@/generation/stores/media";
import { uploadMedia } from "@/generation/upload";

import { ROLE_ACCEPT, ROLE_LABELS, ROLE_TAGS, rolesOf } from "./data";
import { AudioIcon, CloseIcon, VideoIcon } from "./icons";
import { kindOfFile, loadUploads, mergeUploads, rememberUpload, saveUploads, type UploadRecord } from "./uploads";

function localId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function useMedia(model: ModelEntry) {
  const imageMedia = useImageMedia();
  const videoMedia = useVideoMedia();
  return model.surface === "image" ? imageMedia : videoMedia;
}

export interface MediaTray {
  roles: MediaRole[];
  /** The current surface's attachments, so the picker can derive its own caps
      from the same list the strip below renders. */
  items: MediaItem[];
  /** Every file this browser has uploaded locally, newest first. */
  uploads: UploadRecord[];
  /** The URL of the last file uploaded from the picker. It goes onto the shelf
      and into the panel's selection, not onto the plane — the panel stages the
      whole set and one press applies it. */
  staged: string | null;
  uploading: boolean;
  allFull: boolean;
  /** Hidden file input; render it once inside the composer. */
  input: ReactNode;
  /** Upload these files and attach each one to the role its type fits. */
  receive: (files: File[]) => Promise<void>;
  /** Set the role the next file takes, then open the OS picker. */
  begin: (role: MediaRole) => void;
  /** Make the role's inputs exactly these URLs — the picker hands back the set
      it edited, so one press both attaches and detaches. */
  apply: (role: MediaRole, urls: string[]) => void;
  /** Drop one file from the local upload shelf. The blob URL stays. */
  forgetUpload: (id: string) => void;
  /** Put a forgotten upload back on the shelf. */
  restoreUpload: (record: UploadRecord) => void;
}

export function useMediaTray(
  model: ModelEntry,
  onError: (message: string | null) => void,
): MediaTray {
  const media = useMedia(model);
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [staged, setStaged] = useState<string | null>(null);
  const [uploadsLoaded, setUploadsLoaded] = useState(false);
  const roleRef = useRef<MediaRole>("reference");
  const inputRef = useRef<HTMLInputElement>(null);

  /* Read once, then write back on every change — the same order history takes,
     and for the same reason: writing before the read has landed would persist
     the empty initial value over the stored shelf. */
  useEffect(() => {
    let live = true;
    void loadUploads()
      .then((rows) => {
        if (!live) return;
        setUploads((current) => mergeUploads(rows, current));
        setUploadsLoaded(true);
      })
      .catch(() => {
        if (live) setUploadsLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (uploadsLoaded) void saveUploads(uploads);
  }, [uploadsLoaded, uploads]);

  const roles = rolesOf(model);
  const counts: Record<string, number> = {};
  for (const role of roles) {
    counts[role] = media.items.filter((item) => item.role === role).length;
  }
  const allFull = roles.length > 0 && roles.every((role) => (counts[role] ?? 0) >= (model.roles[role] ?? 0));

  async function receive(files: File[]) {
    if (files.length === 0) return;
    onError(null);
    setUploading(true);
    const used = { ...counts };
    let skipped = 0;
    let failed: string | null = null;
    try {
      for (const file of files) {
        const role = roleForFile(model, file, used);
        if (!role) {
          skipped += 1;
          continue;
        }
        const uploaded = await uploadMedia(file);
        used[role] = (used[role] ?? 0) + 1;
        media.add({ id: localId(), url: uploaded.url, role });
        setStaged(uploaded.url);
        setUploads((prev) =>
          rememberUpload(prev, {
            id: localId(),
            url: uploaded.url,
            kind: kindOfFile(file),
            name: file.name,
            createdAt: Date.now(),
          }),
        );
      }
    } catch (caught) {
      failed =
        caught instanceof Error
          ? `Upload failed — ${caught.message}. Retry the file.`
          : "Upload failed. Retry, or drop the file and generate from the prompt alone.";
    } finally {
      setUploading(false);
    }
    if (failed) onError(failed);
    else if (skipped > 0) {
      onError(
        skipped === 1
          ? "1 file did not fit this model's inputs."
          : `${skipped} files did not fit this model's inputs.`,
      );
    }
  }

  /* accept is set on the element rather than through state: the picker opens in
     the same tick as the choice, before React could re-render it. */
  function begin(role: MediaRole) {
    const element = inputRef.current;
    if (!element) return;
    roleRef.current = role;
    element.accept = ROLE_ACCEPT[role];
    element.click();
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      multiple
      hidden
      onChange={(event) => {
        const files = [...(event.target.files ?? [])];
        event.target.value = "";
        void receive(files);
      }}
    />
  );

  /* A replace, not an append: the panel edits one role's whole set, so what it
     hands back decides both what arrives and what leaves. Rows whose URL
     survives keep their id, and with it their place in the strip. */
  function apply(role: MediaRole, urls: string[]) {
    const keep = new Set(urls);
    const held = new Set<string>();
    for (const item of media.items) {
      if (item.role !== role) continue;
      if (keep.has(item.url)) held.add(item.url);
      else media.remove(item.id);
    }
    for (const url of urls) {
      if (!held.has(url)) media.add({ id: localId(), url, role });
    }
  }

  function forgetUpload(id: string) {
    setUploads((prev) => prev.filter((row) => row.id !== id));
  }

  function restoreUpload(record: UploadRecord) {
    setUploads((prev) => rememberUpload(prev, record));
  }

  return { roles, items: media.items, uploads, staged, uploading, allFull, input, receive, begin, apply, forgetUpload, restoreUpload };
}

const ROLE_ORDER: Record<"image" | "video" | "audio", MediaRole[]> = {
  image: ["reference", "start", "end"],
  video: ["video"],
  audio: ["audio"],
};

function fileKind(file: File): "image" | "video" | "audio" | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

function roleForFile(
  model: ModelEntry,
  file: File,
  used: Record<string, number>,
): MediaRole | null {
  const kind = fileKind(file);
  if (!kind) return null;
  for (const role of ROLE_ORDER[kind]) {
    const cap = model.roles[role] ?? 0;
    if (cap > 0 && (used[role] ?? 0) < cap) return role;
  }
  return null;
}

/** Attached inputs, above the prompt — the frames read before the words do. */
export function MediaStrip({ model }: { model: ModelEntry }) {
  const media = useMedia(model);
  const items = media.items.filter((item) => model.roles[item.role]);
  if (items.length === 0) return null;

  return (
    <ul className="ohf-strip">
      {items.map((item) => (
        <li key={item.id} className="ohf-strip-item">
          <span className="ohf-strip-tile">
            {item.role === "audio" || item.role === "video" ? (
              <span className="ohf-strip-glyph">
                {item.role === "audio" ? <AudioIcon size={20} /> : <VideoIcon size={20} />}
              </span>
            ) : (
              /* Blob-hosted user upload; next/image would proxy an arbitrary
                 remote host for a 56px thumb. */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                className="ohf-strip-thumb"
                src={item.url}
                alt=""
                onError={(event) => {
                  event.currentTarget.style.visibility = "hidden";
                }}
              />
            )}
            <span className="ohf-strip-tag">{ROLE_TAGS[item.role]}</span>
          </span>
          <button
            type="button"
            className="ohf-strip-remove"
            aria-label={`Remove ${ROLE_LABELS[item.role].toLowerCase()}`}
            onClick={() => media.remove(item.id)}
          >
            <CloseIcon size={10} />
          </button>
        </li>
      ))}
    </ul>
  );
}
