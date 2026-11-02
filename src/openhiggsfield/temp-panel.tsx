"use client";

import { useEffect, useRef, useState } from "react";

import { discardGalleryTrashItems, loadGalleryTrash } from "@/generation/result-actions";
import { unwrap } from "@/lib/action-result";

import { CloseIcon, TrashIcon } from "./icons";
import type { RunRecord } from "./history";
import { sourcesFor } from "./media-source";

const DAY_MS = 24 * 60 * 60 * 1000;

type GalleryTrashItem = {
  record: RunRecord;
  expiresAt: number;
};

/** Whole days left, or "<1day" once less than 24 hours remain. */
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
            <ul className="ohf-temp-list">
              {items.map((item) => {
                const source = sourcesFor(item.record, 0).primary;
                const label = item.record.prompt || `${item.record.modelLabel} run`;
                return (
                  <li key={item.record.id} className="ohf-temp-row">
                    <div className="ohf-temp-thumb">
                      {item.record.kind === "video" ? (
                        <video src={source} muted playsInline preload="metadata" />
                      ) : (
                        <img src={source} alt="" />
                      )}
                    </div>
                    <div className="ohf-temp-copy">
                      <div className="ohf-temp-prompt">{label}</div>
                      <div className="ohf-temp-count">{trashCountdown(item.expiresAt, now)}</div>
                    </div>
                    <div className="ohf-temp-acts">
                      <button
                        type="button"
                        className="ohf-btn-accent"
                        data-quiet="true"
                        disabled={busyId === item.record.id}
                        onClick={() => void restore(item)}
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        className="ohf-icon-btn"
                        aria-label={`Delete ${label} permanently`}
                        disabled={busyId === item.record.id}
                        onClick={() => void discard(item)}
                      >
                        <TrashIcon />
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
