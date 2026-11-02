"use client";

import { useEffect, useRef, useState } from "react";

import { discardGalleryTrashItems, loadGalleryTrash } from "@/generation/result-actions";
import { unwrap } from "@/lib/action-result";

import { CloseIcon, TrashIcon, UndoIcon } from "./icons";
import type { RunRecord } from "./history";
import { sourcesFor } from "./media-source";

const DAY_MS = 24 * 60 * 60 * 1000;

type GalleryTrashItem = {
  record: RunRecord;
  expiresAt: number;
};

/** Whole days left, or "<1day" once less than 24 hours remain. */
function TempVideo({ primary, fallback }: { primary: string; fallback: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setSource(primary);
        observer.disconnect();
      },
      { rootMargin: "200px" },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [primary]);

  return (
    <video
      ref={ref}
      className="ohf-temp-media"
      src={source ?? undefined}
      muted
      playsInline
      preload={source ? "metadata" : "none"}
      onLoadedData={(event) => {
        const video = event.currentTarget;
        if (video.currentTime > 0) return;
        const target = Math.min(0.1, (video.duration || 0.2) / 2);
        if (target > 0) video.currentTime = target;
      }}
      onError={() => {
        if (fallback && source !== fallback) setSource(fallback);
      }}
    />
  );
}

export function trashCountdown(expiresAt: number, now = Date.now()): string {
  const left = expiresAt - now;
  if (left < DAY_MS) return "<1day";
  return `${Math.ceil(left / DAY_MS)} day`;
}

export function TempPanel({
  onClose,
  onRestore,
}: {
  onClose: () => void;
  onRestore: (records: RunRecord[]) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<GalleryTrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const list = unwrap(await loadGalleryTrash());
        if (live) setItems(list);
      } catch (caught) {
        if (live) setError(caught instanceof Error ? caught.message : "Could not load Temp");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  async function restore(item: GalleryTrashItem) {
    setBusyId(item.record.id);
    setError(null);
    onRestore([item.record]);
    setItems((prev) => prev?.filter((entry) => entry.record.id !== item.record.id) ?? prev);
    setBusyId(null);
  }

  async function discard(item: GalleryTrashItem) {
    setBusyId(item.record.id);
    setError(null);
    try {
      unwrap(await discardGalleryTrashItems([item.record.id]));
      setItems((prev) => prev?.filter((entry) => entry.record.id !== item.record.id) ?? prev);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete permanently");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="ohf-temp-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="ohf-dialog-panel ohf-temp-panel">
        <div className="ohf-keys-head">
          <div>
            <div id="ohf-temp-title" className="ohf-keys-title">
              Temp
            </div>
            <p className="ohf-keys-copy">Deleted runs stay here for 10 days, then the record and its media are removed.</p>
          </div>
          <button type="button" className="ohf-icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>
        <div className="ohf-manage-body ohf-scroll">
          {!items && !error && <p className="ohf-keys-copy">Loading…</p>}
          {error && <p className="ohf-keys-copy">{error}</p>}
          {items && items.length === 0 && <p className="ohf-keys-copy">Temp is empty.</p>}
          {items && items.length > 0 && (
            <ul className="ohf-temp-grid">
              {items.map((item) => {
                const sources = sourcesFor(item.record, 0);
                const label = item.record.prompt || `${item.record.modelLabel} run`;
                return (
                  <li key={item.record.id} className="ohf-tile ohf-temp-card" title={label}>
                    {item.record.kind === "video" ? (
                      <TempVideo primary={sources.primary} fallback={sources.fallback} />
                    ) : (
                      <img className="ohf-temp-media" src={sources.primary} alt="" loading="lazy" />
                    )}
                    <span className="ohf-temp-badge">{trashCountdown(item.expiresAt, now)}</span>
                    <div className="ohf-tile-acts">
                      <button
                        type="button"
                        className="ohf-tile-act"
                        aria-label={`Restore ${label}`}
                        title="Restore"
                        disabled={busyId === item.record.id}
                        onClick={() => void restore(item)}
                      >
                        <UndoIcon size={15} />
                      </button>
                      <button
                        type="button"
                        className="ohf-tile-act ohf-tile-act--danger"
                        aria-label={`Delete ${label} permanently`}
                        title="Delete permanently"
                        disabled={busyId === item.record.id}
                        onClick={() => void discard(item)}
                      >
                        <TrashIcon size={15} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </dialog>
  );
}
