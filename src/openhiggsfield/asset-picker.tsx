"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";

import { withBasePath } from "@/base-path";
import type { MediaItem, MediaRole, ModelEntry } from "@/generation/catalog";
import { preferCdnForVideo } from "@/generation/media-https";

import { rememberClipSeconds } from "./clip-length";
import { ROLE_KINDS, ROLE_LABELS, defaultRole, roleNoun, rolesOf, type AssetKind } from "./data";
import { matchesAuthor, type RunRecord } from "./history";
import {
  AssetsIcon,
  AudioIcon,
  CheckIcon,
  CloseIcon,
  EyeIcon,
  HeartIcon,
  PlayBadgeIcon,
  TrashIcon,
  UploadIcon,
} from "./icons";
import type { UploadRecord } from "./uploads";

type Source = "uploads" | "generations" | "favorites";

const SOURCES: readonly Source[] = ["uploads", "generations", "favorites"];

const SOURCE_LABELS: Record<Source, string> = {
  uploads: "Uploads",
  generations: "Generations",
  favorites: "Favorites",
};

interface Asset {
  /** URL attached to the plane. A video reference on plain HTTP uses the CDN. */
  url: string;
  /** What the tile plays. Local archive when one exists, otherwise the same as url. */
  previewUrl?: string;
  kind: AssetKind;
  /** The tile's name — a file name, or the prompt the run was made from. It is
      the alt text and the pointer title: a grey plate has no other handle. */
  title: string;
  /** Present only for a file on the Uploads shelf, so it can be previewed and removed. */
  uploadId?: string;
  /** The run's layered-gradient art, so a tile whose media is slow to arrive or
      has aged off the platform's CDN is still a picture rather than a hole. */
  art?: string;
  resolution?: string;
  createdBy?: string;
}

/** Everything a role can be filled from: files this browser sent to Blob, and
    the finished runs already in the history. Both are public URLs the plane can
    carry, so the picker treats them as one library cut along two tabs. */
export function AssetPicker({
  model,
  items,
  uploads,
  history,
  favoriteUserId = null,
  team = false,
  author = "all",
  viewerName = null,
  onLoadOlder,
  staged,
  uploading,
  onUpload,
  onApply,
  onForget,
  onRestore,
  onClose,
}: {
  model: ModelEntry;
  /** The current surface's attachments. They are what the panel opens holding:
      a role's inputs are edited here, not only added to. */
  items: MediaItem[];
  uploads: UploadRecord[];
  history: RunRecord[];
  favoriteUserId?: number | null;
  team?: boolean;
  author?: string;
  viewerName?: string | null;
  onLoadOlder: () => void;
  staged: string | null;
  uploading: boolean;
  onUpload: (role: MediaRole) => void;
  onApply: (role: MediaRole, urls: string[]) => void;
  onForget: (id: string) => void;
  onRestore: (record: UploadRecord) => void;
  onClose: () => void;
}) {
  const roles = rolesOf(model);
  const [role, setRole] = useState<MediaRole>(() => defaultRole(model));
  /* null until the visitor picks a shelf: the panel opens on whichever one
     actually holds something, so someone who has generated all day and
     uploaded nothing does not land on an empty tab. */
  const [source, setSource] = useState<Source | null>(null);
  /* The role's inputs as this panel would leave them — seeded with what is
     already on the plane, so an attached tile opens marked and can be pressed
     off again. An array, not a Set: the order picked is the order attached,
     and a start/end pair is not order-blind. */
  const [selected, setSelected] = useState<string[]>(() => urlsOf(items, defaultRole(model)));
  const [preview, setPreview] = useState<Asset | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Asset | null>(null);
  const [undo, setUndo] = useState<UploadRecord | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const kind = ROLE_KINDS[role];
  const max = model.roles[role] ?? 0;
  const current = useMemo(() => urlsOf(items, role), [items, role]);
  const room = Math.max(0, max - selected.length);

  const uploadAssets = useMemo(
    () =>
      uploads
        .filter((record) => record.kind === kind)
        .map((record) => ({
          url: record.url,
          kind: record.kind,
          title: record.name,
          uploadId: record.id,
        })),
    [uploads, kind],
  );

  /* One record can carry several media, and each is its own attachable frame.
     Favorites is the same shelf cut to runs the visitor kept. */
  const { runAssets, favoriteAssets } = useMemo(() => {
    const runs: Asset[] = [];
    const favorites: Asset[] = [];
    for (const record of history) {
      if (record.status !== "completed" || record.kind !== kind || record.archived === true) continue;
      record.urls.forEach((url, index) => {
        /* With the https flag on, the server signs this site's own address for
           the clip and the archived copy never expires, so that one wins. With
           the flag off, the provider's CDN link is the only form it accepts. */
        const remote = record.remoteUrls?.[index];
        const cdn = kind === "video" ? preferCdnForVideo({ remoteUrl: remote }) : null;
        const asset: Asset = {
          url: cdn ?? url,
          ...(cdn ? { previewUrl: url } : {}),
          kind,
          title: record.prompt,
          art: record.art,
          ...(resolutionOf(record) ? { resolution: resolutionOf(record) } : {}),
          ...(record.createdBy ? { createdBy: record.createdBy } : {}),
        };
        if (!matchesAuthor(record, author, viewerName)) continue;
        runs.push(asset);
        const kept = team
          ? favoriteUserId != null && (record.favoriteUserIds?.includes(favoriteUserId) ?? false)
          : record.favorite === true;
        if (kept) favorites.push(asset);
      });
    }
    return { runAssets: runs, favoriteAssets: favorites };
  }, [author, favoriteUserId, history, kind, team, viewerName]);

  const shelf: Source =
    source ?? (uploadAssets.length === 0 && runAssets.length > 0 ? "generations" : "uploads");
  const assets =
    shelf === "uploads" ? uploadAssets : shelf === "favorites" ? favoriteAssets : runAssets;

  // The dialog takes focus on the control that scopes it, not on the grid.
  useEffect(() => {
    tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }, []);

  /* A file uploaded from inside the panel joins the selection rather than the
     plane: one press still applies the whole set. The ref holds whatever was
     staged before this panel opened, so reopening does not re-select it. */
  const seen = useRef(staged);

  /* A new role is a new set of attachments. The shelf stays: Uploads or
     Generations should not jump back when the slot below changes. */
  function pickRole(next: MediaRole) {
    setRole(next);
    setSelected(urlsOf(items, next));
  }

  /* Start and end are a pair: attaching the start should land on the empty end
     slot instead of closing, so the second frame is one more click, not a
     reopen plus a confirm. */
  function advanceOrClose(filled: MediaRole) {
    if (filled === "start" && (model.roles.end ?? 0) > 0) {
      const endUsed = items.filter((item) => item.role === "end").length;
      if (endUsed < (model.roles.end ?? 0)) {
        pickRole("end");
        return;
      }
    }
    onClose();
  }

  function commit(urls: string[]) {
    onApply(role, urls);
    if (max > 0 && urls.length >= max) {
      advanceOrClose(role);
      return;
    }
    onClose();
  }

  useEffect(() => {
    if (staged === null || staged === seen.current) return;
    seen.current = staged;
    if (max === 1) {
      setSelected([staged]);
      commit([staged]);
      return;
    }
    setSelected((prev) => (prev.includes(staged) ? prev : [...prev, staged]));
  }, [staged]);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  function confirmDelete() {
    if (!pendingDelete?.uploadId) return;
    const record = uploads.find((row) => row.id === pendingDelete.uploadId);
    if (!record) {
      setPendingDelete(null);
      return;
    }
    onForget(record.id);
    setSelected((prev) => prev.filter((url) => url !== record.url));
    setPendingDelete(null);
    setUndo(record);
  }

  function toggle(url: string) {
    if (max === 1) {
      const next = selected.includes(url) ? [] : [url];
      setSelected(next);
      onApply(role, next);
      if (next.length === 1) advanceOrClose(role);
      return;
    }
    setSelected((prev) =>
      prev.includes(url) ? prev.filter((entry) => entry !== url) : [...prev, url],
    );
  }

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const from = SOURCES.indexOf(shelf);
    const to =
      event.key === "ArrowRight"
        ? (from + 1) % SOURCES.length
        : event.key === "ArrowLeft"
          ? (from - 1 + SOURCES.length) % SOURCES.length
          : -1;
    if (to < 0) return;
    event.preventDefault();
    setSource(SOURCES[to]!);
    tabsRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
  };

  const empty = emptyCopy(shelf, kind);
  const canUpload = room > 0 && !uploading;
  const uploadTip = uploading
    ? "Uploading…"
    : room > 0
      ? `Upload a ${roleNoun(role, 1)} from this device`
      : `Every ${roleNoun(role, 1)} slot is taken — press one off to free it`;

  /* The button states the difference it will make, so a set edited down reads
     as a removal rather than as an "Add" that removes. */
  const picked = new Set(selected);
  const added = selected.filter((url) => !current.includes(url)).length;
  const dropped = current.filter((url) => !picked.has(url)).length;
  const applyLabel =
    added && dropped
      ? `Replace ${roleNoun(role, Math.max(added, dropped))}`
      : added
        ? `Add ${added > 1 ? `${added} ` : ""}${roleNoun(role, added)}`
        : dropped
          ? `Remove ${dropped > 1 ? `${dropped} ` : ""}${roleNoun(role, dropped)}`
          : "Done";

  return (
    <div className="ohf-popover ohf-popover--assets" role="dialog" aria-label="Add input">
      <div className="ohf-assets-head">
        <div
          className="ohf-assets-tabs"
          role="tablist"
          aria-label="Asset source"
          ref={tabsRef}
          onKeyDown={onTabKeyDown}
        >
          {SOURCES.map((id) => {
            const active = id === shelf;
            const count =
              id === "uploads"
                ? uploadAssets.length
                : id === "favorites"
                  ? favoriteAssets.length
                  : runAssets.length;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                className="ohf-assets-tab"
                onClick={() => setSource(id)}
              >
                {SOURCE_LABELS[id]}
                <span className="ohf-assets-tab-count">{count}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="ohf-icon-btn ohf-icon-btn--ghost ohf-picker-close"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <CloseIcon size={13} />
        </button>
      </div>

      {/* Which slot this panel is editing. Models declaring one role need no
          switch — the footer already names what is being changed. */}
      {roles.length > 1 && (
        <div className="ohf-assets-roles" role="group" aria-label="Input slot">
          {roles.map((entry) => {
            const used =
              entry === role ? selected.length : items.filter((item) => item.role === entry).length;
            return (
              <button
                key={entry}
                type="button"
                className="ohf-chip ohf-chip--role"
                aria-pressed={entry === role}
                onClick={() => pickRole(entry)}
              >
                {ROLE_LABELS[entry]}
                <span className="ohf-chip-count">
                  {used}/{model.roles[entry] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div
        className="ohf-assets-body ohf-scroll"
        onScroll={(event) => {
          if (shelf !== "generations" && shelf !== "favorites") return;
          const node = event.currentTarget;
          if (node.scrollTop + node.clientHeight < node.scrollHeight - 80) return;
          onLoadOlder();
        }}
      >
        {undo && (
          <div className="ohf-undo ohf-asset-undo" role="status">
            <span className="ohf-undo-drain" style={{ animationDuration: `${UNDO_MS}ms` }} aria-hidden />
            <span className="ohf-undo-text">Upload removed</span>
            <button
              type="button"
              className="ohf-undo-act"
              onClick={() => {
                onRestore(undo);
                setUndo(null);
              }}
            >
              Undo
            </button>
          </div>
        )}
        {assets.length === 0 ? (
          <div className="ohf-picker-empty">
            <span className="ohf-picker-empty-ic">
              {shelf === "uploads" ? (
                <UploadIcon size={15} />
              ) : shelf === "favorites" ? (
                <HeartIcon size={15} />
              ) : (
                <AssetsIcon size={15} />
              )}
            </span>
            <span className="ohf-picker-empty-title">{empty.title}</span>
            <span className="ohf-picker-empty-hint">{empty.hint}</span>
            {shelf === "uploads" && (
              <button
                type="button"
                className="ohf-btn-solid"
                disabled={!canUpload}
                onClick={() => onUpload(role)}
              >
                <UploadIcon />
                Upload file
              </button>
            )}
          </div>
        ) : (
          <div className="ohf-assets-grid">
            {shelf === "uploads" && (
              <button
                type="button"
                className="ohf-asset ohf-asset--upload"
                disabled={!canUpload}
                title={uploadTip}
                aria-label={uploadTip}
                onClick={() => onUpload(role)}
              >
                {uploading ? <span className="ohf-spinner" aria-hidden /> : <UploadIcon size={17} />}
                <span className="ohf-asset-upload-label">Upload file</span>
              </button>
            )}

            {assets.map((asset) => {
              const on = picked.has(asset.url);
              return (
                <AssetTile
                  key={asset.uploadId ?? asset.url}
                  asset={asset}
                  picked={on}
                  blocked={!on && room === 0}
                  onToggle={toggle}
                  onPreview={asset.uploadId ? () => setPreview(asset) : undefined}
                  onDelete={asset.uploadId ? () => setPendingDelete(asset) : undefined}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="ohf-assets-foot">
        <span className="ohf-assets-tally">
          {selected.length} of {max} {roleNoun(role, max)}
        </span>
        {/* Never disabled: with no change left to apply it is simply the way
            out, and the panel always offers one press that ends the task. */}
        <button
          type="button"
          className="ohf-btn-accent"
          data-quiet={added + dropped === 0}
          onClick={() => commit(selected)}
        >
          {applyLabel}
        </button>
      </div>
      {preview && <PreviewDialog asset={preview} onClose={() => setPreview(null)} />}
      {pendingDelete && (
        <ConfirmDeleteDialog
          name={pendingDelete.title}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

const UNDO_MS = 6000;

function resolutionOf(record: RunRecord): string {
  const value = record.settings?.resolution;
  if (typeof value === "string" && value.trim()) return value;
  const first = record.meta.split(" · ").map((part) => part.trim()).find(Boolean);
  if (first && /\d/.test(first) && !/s$/.test(first)) return first;
  return "";
}

function urlsOf(items: MediaItem[], role: MediaRole): string[] {
  return items.filter((item) => item.role === role).map((item) => item.url);
}

function emptyCopy(source: Source, kind: AssetKind): { title: string; hint: string } {
  if (source === "uploads") {
    return {
      title: "Nothing uploaded yet",
      hint: "Files you send from this device stay on this shelf for the next run too.",
    };
  }
  if (source === "favorites") {
    return {
      title: `No favorite ${kind} yet`,
      hint: "Press the heart on a finished run in the gallery and it shows up on this shelf.",
    };
  }
  if (kind === "audio") {
    return {
      title: "Runs never return audio",
      hint: "Attach an audio track from this device instead — it lands on the Uploads shelf.",
    };
  }
  return {
    title: `No finished ${kind} runs yet`,
    hint: `Every ${kind} you generate lands here, ready to feed the next run.`,
  };
}

/* Video assets preview on hover, the same reflex the gallery teaches, so the
   tile carries its own element and its own ref. The select control is a
   stretched button so preview and delete can sit beside it, not inside it. */
const AssetTile = memo(function AssetTile({
  asset,
  picked,
  blocked,
  onToggle,
  onPreview,
  onDelete,
}: {
  asset: Asset;
  picked: boolean;
  blocked: boolean;
  onToggle: (url: string) => void;
  onPreview?: () => void;
  onDelete?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <div className="ohf-asset" data-picked={picked} data-blocked={blocked || undefined} title={asset.title}>
      <span className="ohf-asset-art" style={asset.art ? { background: asset.art } : undefined} />

      {asset.kind === "video" ? (
        <video
          ref={videoRef}
          className="ohf-asset-media"
          src={withBasePath(asset.previewUrl ?? asset.url)}
          muted
          loop
          playsInline
          preload="auto"
          onLoadedMetadata={(event) => {
            paintFirstFrame(event.currentTarget);
            /* The preview already fetched this clip's header, so its length is
               free here — worth keeping for a model that edits clips. */
            rememberClipSeconds(asset.url, event.currentTarget.duration);
          }}
        />
      ) : asset.kind === "audio" ? (
        <span className="ohf-asset-glyph">
          <AudioIcon size={20} />
        </span>
      ) : (
        /* Blob and platform CDN hosts both; next/image would need every
           provider domain allow-listed up front for a 112px thumb. */
        /* eslint-disable-next-line @next/next/no-img-element */
        <img className="ohf-asset-media" src={withBasePath(asset.previewUrl ?? asset.url)} alt="" loading="eager" />
      )}

      {asset.kind === "video" && (
        <span className="ohf-asset-kind" aria-hidden>
          <PlayBadgeIcon size={8} />
        </span>
      )}
      {asset.createdBy && (
        <span className="ohf-asset-who" title={`Created by ${asset.createdBy}`}>
          {asset.createdBy}
        </span>
      )}
      {(asset.resolution || asset.createdBy) && (
        <span className="ohf-asset-caption">
          {asset.resolution && <span>{asset.resolution}</span>}
          {asset.createdBy && <span>{asset.createdBy}</span>}
        </span>
      )}

      <button
        type="button"
        className="ohf-asset-hit"
        disabled={blocked}
        aria-pressed={picked}
        aria-label={asset.title}
        onClick={() => onToggle(asset.url)}
        onMouseEnter={() => void videoRef.current?.play().catch(() => {})}
        onMouseLeave={() => {
          const video = videoRef.current;
          if (!video) return;
          video.pause();
          video.currentTime = 0;
        }}
      />

      <span className="ohf-asset-mark" aria-hidden>
        <CheckIcon size={12} />
      </span>

      {(onPreview || onDelete) && (
        <span className="ohf-asset-tools">
          {onPreview && (
            <button type="button" className="ohf-asset-tool" aria-label={`Preview ${asset.title}`} onClick={onPreview}>
              <EyeIcon size={12} />
            </button>
          )}
          {onDelete && (
            <button type="button" className="ohf-asset-tool" aria-label={`Delete ${asset.title}`} onClick={onDelete}>
              <TrashIcon size={12} />
            </button>
          )}
        </span>
      )}
    </div>
  );
});

function paintFirstFrame(video: HTMLVideoElement) {
  const span = Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 0.1 : 0.1;
  const nudge = Math.min(0.1, Math.max(span, 0.001));
  const back = () => {
    video.currentTime = 0;
  };
  video.addEventListener("seeked", back, { once: true });
  try {
    video.currentTime = nudge;
  } catch {
    video.removeEventListener("seeked", back);
  }
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 6;

export function PreviewDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const image = asset.kind !== "video" && asset.kind !== "audio";
  return (
    <dialog ref={ref} className="ohf" aria-label={`Preview ${asset.title}`} onClose={onClose} onCancel={onClose}>
      <div className="ohf-dialog-panel ohf-asset-preview">
        <div className="ohf-keys-head">
          <div>
            <div className="ohf-keys-title">Preview</div>
            <p className="ohf-keys-copy">{asset.title}</p>
            {(asset.resolution || asset.createdBy) && (
              <p className="ohf-keys-copy">
                {[asset.resolution, asset.createdBy ? `Created by ${asset.createdBy}` : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            {image && <p className="ohf-keys-copy">Scroll to zoom</p>}
          </div>
          <button type="button" className="ohf-icon-btn ohf-icon-btn--ghost" aria-label="Close preview" onClick={onClose}>
            <CloseIcon size={14} />
          </button>
        </div>
        {image ? (
          <ZoomStage src={withBasePath(asset.previewUrl ?? asset.url)} alt={asset.title} />
        ) : (
          <div className="ohf-asset-preview-stage">
            {asset.kind === "video" ? (
              <video src={withBasePath(asset.previewUrl ?? asset.url)} controls playsInline />
            ) : (
              <audio src={withBasePath(asset.previewUrl ?? asset.url)} controls />
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}

/** Scroll zooms toward the pointer. Drag pans once the picture is larger than
    the stage, and a double click puts it back at 1×. */
function ZoomStage({ src, alt }: { src: string; alt: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ scale: ZOOM_MIN, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [view, setView] = useState(viewRef.current);
  const [grabbing, setGrabbing] = useState(false);

  function apply(next: { scale: number; x: number; y: number }) {
    const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next.scale));
    const settled = scale === ZOOM_MIN ? { scale, x: 0, y: 0 } : { scale, x: next.x, y: next.y };
    viewRef.current = settled;
    setView(settled);
  }

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const current = viewRef.current;
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current.scale * factor));
      if (scale === current.scale) return;
      if (scale === ZOOM_MIN) {
        apply({ scale, x: 0, y: 0 });
        return;
      }
      const ratio = scale / current.scale;
      const px = event.clientX - rect.left - rect.width / 2;
      const py = event.clientY - rect.top - rect.height / 2;
      apply({
        scale,
        x: px - (px - current.x) * ratio,
        y: py - (py - current.y) * ratio,
      });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      ref={stageRef}
      className="ohf-asset-preview-stage ohf-asset-preview-stage--zoom"
      data-zoomed={view.scale > ZOOM_MIN}
      data-grabbing={grabbing}
      onDoubleClick={() => apply({ scale: ZOOM_MIN, x: 0, y: 0 })}
      onPointerDown={(event) => {
        if (viewRef.current.scale <= ZOOM_MIN) return;
        drag.current = { x: event.clientX, y: event.clientY, ox: viewRef.current.x, oy: viewRef.current.y };
        setGrabbing(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const from = drag.current;
        if (!from) return;
        apply({
          scale: viewRef.current.scale,
          x: from.ox + (event.clientX - from.x),
          y: from.oy + (event.clientY - from.y),
        });
      }}
      onPointerUp={() => {
        drag.current = null;
        setGrabbing(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setGrabbing(false);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      />
    </div>
  );
}

function ConfirmDeleteDialog({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="ohf" aria-label="Delete upload" onCancel={onCancel}>
      <div className="ohf-dialog-panel ohf-asset-confirm">
        <div className="ohf-keys-head">
          <div>
            <div className="ohf-keys-title">Hapus unggahan ini?</div>
            <p className="ohf-keys-copy">{name}</p>
          </div>
        </div>
        <div className="ohf-asset-confirm-acts">
          <button type="button" className="ohf-btn-solid" onClick={onCancel}>
            Batal
          </button>
          <button type="button" className="ohf-btn-accent" onClick={onConfirm}>
            Hapus
          </button>
        </div>
      </div>
    </dialog>
  );
}
