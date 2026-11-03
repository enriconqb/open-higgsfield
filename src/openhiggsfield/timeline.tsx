"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { withBasePath } from "@/base-path";
import { unwrap } from "@/lib/action-result";
import { createShare } from "@/share/actions";

import { defaultKv } from "./idb";
import type { RunRecord } from "./history";
import { CheckIcon, CloseIcon, PauseIcon, PlayBadgeIcon, PlayIcon } from "./icons";
import { sharePageUrl } from "./share-link";
import { TimelinePlayer } from "./timeline-player";
import { loadUploads, type UploadRecord } from "./uploads";

const TIMELINE_KEY = "timeline.v1";

type ClipSource = {
  key: string;
  url: string;
  title: string;
  art?: string;
};

export function Timeline({ history, ready }: { history: RunRecord[]; ready: boolean }) {
  const [order, setOrder] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [uploadsReady, setUploadsReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [startIndex, setStartIndex] = useState(0);
  const [startAt, setStartAt] = useState(0);
  const [seekNonce, setSeekNonce] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [ratio, setRatio] = useState(0);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [shared, setShared] = useState<"idle" | "busy" | "done" | "error">("idle");

  useEffect(() => {
    let live = true;
    void Promise.all([defaultKv().get<unknown>(TIMELINE_KEY), loadUploads()])
      .then(([stored, rows]) => {
        if (!live) return;
        if (Array.isArray(stored) && stored.every((id) => typeof id === "string")) setOrder(stored);
        setUploads(rows.filter((row) => row.kind === "video"));
        setLoaded(true);
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

  const library = useMemo(() => {
    const tiles: ClipSource[] = [];
    for (const record of history) {
      if (record.kind !== "video" || record.status !== "completed" || !record.urls[0]) continue;
      tiles.push({
        key: record.id,
        url: withBasePath(record.urls[0]),
        title: record.prompt,
        art: record.art,
      });
    }
    for (const row of uploads) {
      tiles.push({
        key: `u:${row.id}`,
        url: withBasePath(row.url),
        title: row.name,
      });
    }
    return tiles;
  }, [history, uploads]);

  const byKey = useMemo(() => {
    const map = new Map<string, ClipSource>();
    for (const tile of library) map.set(tile.key, tile);
    return map;
  }, [library]);

  useEffect(() => {
    if (!loaded || !ready || !uploadsReady) return;
    const next = order.filter((key) => byKey.has(key));
    if (next.length !== order.length) setOrder(next);
  }, [byKey, loaded, order, ready, uploadsReady]);

  useEffect(() => {
    if (!loaded) return;
    void defaultKv().set(TIMELINE_KEY, order);
  }, [loaded, order]);

  const clips = useMemo(
    () =>
      order.flatMap((key) => {
        const tile = byKey.get(key);
        return tile ? [tile] : [];
      }),
    [byKey, order],
  );
  const urls = useMemo(() => clips.map((clip) => clip.url), [clips]);
  const picked = new Set(order);

  function playFrom(index: number, at = 0) {
    setStartIndex(index);
    setStartAt(at);
    setActiveIndex(index);
    const length = durations[clips[index]?.key ?? ""] ?? 0;
    setRatio(length > 0 ? Math.min(1, at / length) : 0);
    setSeekNonce((nonce) => nonce + 1);
    setPlaying(true);
  }

  const known = clips.length > 0 && clips.every((clip) => (durations[clip.key] ?? 0) > 0);
  const weights = clips.map((clip) => (known ? durations[clip.key]! : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const elapsed =
    weights.slice(0, activeIndex).reduce((sum, weight) => sum + weight, 0) +
    (weights[activeIndex] ?? 0) * ratio;

  function seekTo(fraction: number) {
    if (clips.length === 0 || total <= 0) return;
    const target = Math.min(1, Math.max(0, fraction)) * total;
    let cursor = 0;
    for (let index = 0; index < clips.length; index += 1) {
      const weight = weights[index] ?? 0;
      const end = cursor + weight;
      if (target <= end || index === clips.length - 1) {
        const into = weight > 0 ? ((target - cursor) / weight) * (known ? weight : 0) : 0;
        playFrom(index, into);
        return;
      }
      cursor = end;
    }
  }

  function toggle(key: string) {
    setPlaying(false);
    setStartIndex(0);
    setStartAt(0);
    setActiveIndex(0);
    setRatio(0);
    setOrder((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  }

  function remove(index: number) {
    setPlaying(false);
    setStartIndex(0);
    setStartAt(0);
    setActiveIndex(0);
    setRatio(0);
    setOrder((prev) => prev.filter((_, i) => i !== index));
  }

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= order.length) return;
    setPlaying(false);
    setStartIndex(0);
    setStartAt(0);
    setActiveIndex(0);
    setRatio(0);
    setOrder((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      if (!item) return prev;
      next.splice(to, 0, item);
      return next;
    });
  }

  return (
    <section className="ohf-timeline ohf-scroll" id="ohf-panel" role="tabpanel" aria-labelledby="ohf-tab-timeline">
      <div className="ohf-tl-stage-wrap">
        {clips.length > 0 ? (
          <>
            <div className="ohf-tl-frame">
            <TimelinePlayer
              urls={urls}
              playing={playing}
              startIndex={startIndex}
              startAt={startAt}
              seekNonce={seekNonce}
              onProgress={(index, nextRatio, duration) => {
                setActiveIndex(index);
                setRatio(nextRatio);
                if (duration > 0) {
                  const key = clips[index]?.key;
                  if (!key) return;
                  setDurations((prev) => (prev[key] === duration ? prev : { ...prev, [key]: duration }));
                }
              }}
            />
            </div>
            <div className="ohf-tl-transport">
            <button
              type="button"
              className="ohf-tl-play"
              aria-label={playing ? "Pause" : "Play"}
              onClick={() => setPlaying((on) => !on)}
            >
              {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
            </button>
            <input
              className="ohf-tl-range"
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={total > 0 ? Math.min(1, elapsed / total) : 0}
              aria-label="Sequence progress"
              onChange={(event) => seekTo(Number(event.target.value))}
            />
            <button
              type="button"
              className="ohf-tl-share"
              disabled={clips.length === 0 || shared === "busy"}
              onClick={() => {
                setShared("busy");
                void createShare({
                  kind: "timeline",
                  clips: clips.map((clip) => ({ kind: "video" as const, url: clip.url })),
                })
                  .then(unwrap)
                  .then((created) => navigator.clipboard.writeText(sharePageUrl(created.token)))
                  .then(() => setShared("done"))
                  .catch(() => setShared("error"));
              }}
            >
              {shared === "done" ? "Link copied" : shared === "error" ? "Cannot share" : shared === "busy" ? "Sharing…" : "Share"}
            </button>
            </div>
          </>
        ) : (
          <p className="ohf-tl-empty">Tap videos below to build one sequence.</p>
        )}
      </div>

      <div className="ohf-tl-strip-wrap">
        <h2 className="ohf-tl-label">Sequence</h2>
        {clips.length === 0 ? (
          <p className="ohf-tl-hint">Nothing on the timeline yet.</p>
        ) : (
          <ul className="ohf-tl-strip">
            {clips.map((clip, index) => (
              <li
                key={clip.key}
                className="ohf-tl-thumb"
                data-active={index === activeIndex || undefined}
                draggable
                onClick={() => playFrom(index)}
                onDragStart={() => setDragFrom(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragFrom !== null) move(dragFrom, index);
                  setDragFrom(null);
                }}
              >
                <video
                  className="ohf-tl-thumb-media"
                  src={clip.url}
                  muted
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={(event) => {
                    const seconds = event.currentTarget.duration;
                    if (!Number.isFinite(seconds) || seconds <= 0) return;
                    setDurations((prev) => (prev[clip.key] === seconds ? prev : { ...prev, [clip.key]: seconds }));
                  }}
                />
                <span className="ohf-tl-index">{index + 1}</span>
                <button
                  type="button"
                  className="ohf-tl-remove"
                  aria-label={`Remove ${clip.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    remove(index);
                  }}
                >
                  <CloseIcon size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="ohf-tl-videos">
        <h2 className="ohf-tl-label">Videos</h2>
        {library.length === 0 ? (
          <p className="ohf-tl-hint">Finished generations and uploaded videos show up here.</p>
        ) : (
          <div className="ohf-tl-grid">
            {library.map((tile) => (
              <TimelineTile key={tile.key} tile={tile} picked={picked.has(tile.key)} onToggle={() => toggle(tile.key)} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function TimelineTile({
  tile,
  picked,
  onToggle,
}: {
  tile: ClipSource;
  picked: boolean;
  onToggle: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  return (
    <div className="ohf-asset ohf-tl-tile" data-picked={picked} title={tile.title}>
      <span className="ohf-asset-art" style={tile.art ? { background: tile.art } : undefined} />
      <video
        ref={videoRef}
        className="ohf-asset-media"
        src={tile.url}
        muted
        playsInline
        preload="metadata"
        onMouseEnter={() => void videoRef.current?.play().catch(() => {})}
        onMouseLeave={() => {
          const video = videoRef.current;
          if (!video) return;
          video.pause();
          video.currentTime = 0;
        }}
      />
      <span className="ohf-asset-kind" aria-hidden>
        <PlayBadgeIcon size={8} />
      </span>
      <button type="button" className="ohf-asset-hit" aria-pressed={picked} aria-label={tile.title} onClick={onToggle} />
      <span className="ohf-asset-mark" aria-hidden>
        <CheckIcon size={12} />
      </span>
      <span className="ohf-tl-caption">{tile.title}</span>
    </div>
  );
}
