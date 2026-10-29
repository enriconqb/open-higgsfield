"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { defaultKv } from "./idb";
import { CompareIcon, CloseIcon, PlusIcon, SearchIcon } from "./icons";
import { CompareStage, type CompareItem } from "./compare-stage";
import type { RunRecord } from "./history";
import { sourcesForUrls } from "./media-source";
import { uploadMedia } from "@/generation/upload";
import { loadUploads, type UploadRecord } from "./uploads";

const COMPARE_KEY = "compare.v1";
const MAX_ITEMS = 20;

type Shelf = "studio" | "generations";

/** The comparison panel: a strip the visitor fills from their own library, their
    uploads, or a file they drop, and a stage that shows the chosen pair — two
    videos playing on the same second under a divider that can be dragged while
    they run. */
export function Compare({ history, ready }: { history: RunRecord[]; ready: boolean }) {
  const [items, setItems] = useState<CompareItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [uploadsReady, setUploadsReady] = useState(false);
  const [pair, setPair] = useState<{ before: string; after: string | null } | null>(null);
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /* The strip outlives a reload the way the timeline does. */
  useEffect(() => {
    let live = true;
    void Promise.all([defaultKv().get<unknown>(COMPARE_KEY), loadUploads()])
      .then(([stored, rows]) => {
        if (!live) return;
        if (Array.isArray(stored)) {
          const restored = stored.filter(isCompareItem).slice(0, MAX_ITEMS);
          setItems(restored);
        }
        setUploads(rows.filter((row) => row.kind === "video" || row.kind === "image"));        setLoaded(true);
        setUploadsReady(true);
      })
      .catch(() => {
        if (!live) return;
        setLoaded(true);
        setUploadsReady(true);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    void defaultKv().set(COMPARE_KEY, items);
  }, [loaded, items]);

  /* The shelves: what the studio already made, and what was uploaded here. */
  const shelfItems = useMemo(() => {
    const list: CompareItem[] = [];
    const generations = history
      .filter((record) => record.status === "completed" && record.urls[0])
      .map((record) => {
        const sources = sourcesForUrls({
          kind: record.kind,
          url: record.urls[0]!,
          remoteUrl: record.remoteUrls?.[0],
        });
        const item: CompareItem = {
          id: `g:${record.id}`,
          kind: record.kind,
          title: record.prompt,
          url: sources.primary,
        };
        return item;
      });
    if (shelf === "generations") list.push(...generations);
    if (shelf === "studio") {
      for (const row of uploads) {
        /* The uploads shelf also holds audio, which has nothing to show here. */
        if (row.kind !== "image" && row.kind !== "video") continue;
        list.push({
          id: `u:${row.id}`,
          kind: row.kind,
          title: row.name,
          url: row.url,
        });
      }
    }
    const needle = query.trim().toLowerCase();
    const filtered = needle ? list.filter((item) => item.title.toLowerCase().includes(needle)) : list;
    return filtered.slice(0, 60);
  }, [history, query, shelf, uploads]);

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  /* A pair is only meaningful while both of its items are still in the strip. */
  useEffect(() => {
    if (items.length === 0) {
      setPair(null);
      return;
    }
    setPair((current) => {
      const before = current?.before && byId.has(current.before) ? current.before : items[0]!.id;
      const after =
        current?.after && byId.has(current.after) && current.after !== before
          ? current.after
          : (items.find((item) => item.id !== before)?.id ?? null);
      return { before, after };
    });
  }, [byId, items]);

  const before = pair?.before ? (byId.get(pair.before) ?? null) : null;
  const after = pair?.after ? (byId.get(pair.after) ?? null) : null;

  function add(item: CompareItem) {
    setItems((current) => {
      if (current.some((row) => row.id === item.id)) return current;
      return [...current, item].slice(-MAX_ITEMS);
    });
  }

  async function addFiles(files: File[]) {
    const accepted = files.filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
    if (accepted.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of accepted) {
        /* Local picks go to the server like every other upload, so the strip
           survives a reload and the file is not tied to this tab. */
        const uploaded = await uploadMedia(file);
        add({
          id: `l:${uploaded.url}`,
          kind: file.type.startsWith("video/") ? "video" : "image",
          title: file.name,
          url: uploaded.url,
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That file could not be added.");
    } finally {
      setBusy(false);
    }
  }

  function remove(index: number) {
    setItems((current) => current.filter((_, position) => position !== index));
  }

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= items.length) return;
    setItems((current) => {
      const next = [...current];
      const [row] = next.splice(from, 1);
      if (!row) return current;
      next.splice(to, 0, row);
      return next;
    });
  }

  function clearAll() {
    setItems([]);
    setPair(null);
    setError(null);
  }

  return (
    <section className="ohf-cmp ohf-scroll" id="ohf-panel" role="tabpanel" aria-labelledby="ohf-tab-compare">
      {items.length > 0 && before ? (
        <CompareStage before={before} after={after} />
      ) : (
        <div className="ohf-cmp-blank">
          <CompareIcon size={22} />
          <p className="ohf-cmp-blank-title">Nothing to compare yet</p>
          <p className="ohf-cmp-blank-hint">
            Add two items — from your generated runs, your uploads, or a file from this device — then drag
            the divider. Two videos play on the same second.
          </p>
        </div>
      )}

      <div className="ohf-cmp-strip-wrap">
        <div className="ohf-cmp-strip-head">
          <h2 className="ohf-cmp-label">Strip</h2>
          <div className="ohf-cmp-group">
            <button
              type="button"
              className="ohf-cmp-chip"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
            >
              <PlusIcon size={12} /> {busy ? "Adding…" : "Add file"}
            </button>
            <button
              type="button"
              className="ohf-cmp-chip"
              data-on={shelf === "generations" || undefined}
              onClick={() => setShelf((current) => (current === "generations" ? null : "generations"))}
            >
              Runs
            </button>
            <button
              type="button"
              className="ohf-cmp-chip"
              data-on={shelf === "studio" || undefined}
              onClick={() => setShelf((current) => (current === "studio" ? null : "studio"))}
            >
              Uploads
            </button>
            {items.length > 0 && (
              <button type="button" className="ohf-cmp-chip" onClick={clearAll} title="Empty the strip">
                Clear
              </button>
            )}
          </div>
        </div>

        {error && <p className="ohf-cmp-error">{error}</p>}

        <input
          ref={fileInput}
          type="file"
          accept="image/*,video/*"
          multiple
          className="ohf-cmp-file"
          onChange={(event) => {
            const files = event.target.files ? [...event.target.files] : [];
            event.target.value = "";
            void addFiles(files);
          }}
        />

        {items.length === 0 ? (
          <p className="ohf-cmp-hintline">
            Drop a file here, or pull one from Runs / Uploads. Numbered tiles keep their order.
          </p>
        ) : (
          <ul
            className="ohf-cmp-strip"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (dragFrom !== null) {
                move(dragFrom, items.length - 1);
                setDragFrom(null);
                return;
              }
              void addFiles([...(event.dataTransfer?.files ?? [])]);
            }}
          >
            {items.map((item, index) => (
              <li key={item.id} className="ohf-cmp-item" data-before={before?.id === item.id || undefined} data-after={after?.id === item.id || undefined}>
                <button
                  type="button"
                  className="ohf-cmp-thumb"
                  draggable
                  onDragStart={() => setDragFrom(index)}
                  onDragEnd={() => setDragFrom(null)}
                  onClick={() => setPair({ before: item.id, after: after?.id ?? null })}
                  title={`${item.title} — make this the Before side`}
                >
                  {item.kind === "video" ? (
                    <video className="ohf-cmp-thumb-media" src={item.url} muted playsInline preload="metadata" />
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img className="ohf-cmp-thumb-media" src={item.url} alt="" />
                  )}
                  <span className="ohf-cmp-index">{index + 1}</span>
                </button>

                <button
                  type="button"
                  className="ohf-cmp-remove"
                  aria-label={`Remove ${item.title}`}
                  onClick={() => remove(index)}
                >
                  <CloseIcon size={11} />
                </button>

                {index < items.length - 1 && (
                  <button
                    type="button"
                    className="ohf-cmp-pair"
                    aria-label={`Compare ${index + 1} with ${index + 2}`}
                    title="Compare these two"
                    data-on={before?.id === item.id && after?.id === items[index + 1]?.id ? true : undefined}
                    onClick={() =>
                      setPair({ before: item.id, after: items[index + 1]?.id ?? null })
                    }
                  >
                    <CompareIcon size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {shelf && (
          <div className="ohf-cmp-shelf">
            <div className="ohf-cmp-shelf-head">
              <span className="ohf-cmp-note">
                {shelf === "generations" ? "Finished runs" : "Uploaded here"}
              </span>
              <label className="ohf-cmp-search">
                <SearchIcon size={12} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter"
                  aria-label="Filter the shelf"
                />
              </label>
              <button type="button" className="ohf-cmp-chip" onClick={() => setShelf(null)}>
                Close
              </button>
            </div>
            {!ready || !uploadsReady ? (
              <p className="ohf-cmp-hintline">Reading your library…</p>
            ) : shelfItems.length === 0 ? (
              <p className="ohf-cmp-hintline">Nothing here yet.</p>
            ) : (
              <div className="ohf-cmp-grid">
                {shelfItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="ohf-cmp-pick"
                    title={item.title}
                    onClick={() => add(item)}
                  >
                    {item.kind === "video" ? (
                      <video className="ohf-cmp-thumb-media" src={item.url} muted playsInline preload="metadata" />
                    ) : (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img className="ohf-cmp-thumb-media" src={item.url} alt="" />
                    )}
                    <span className="ohf-cmp-pick-tag">Add</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function isCompareItem(value: unknown): value is CompareItem {
  if (value === null || typeof value !== "object") return false;
  const row = value as Partial<CompareItem>;
  return (
    typeof row.id === "string" &&
    (row.kind === "image" || row.kind === "video") &&
    typeof row.title === "string" &&
    typeof row.url === "string" &&
    (row.remoteUrl === undefined || typeof row.remoteUrl === "string")
  );
}
