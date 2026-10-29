"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { withBasePath } from "@/base-path";

import { defaultKv } from "./idb";
import type { RunRecord } from "./history";
import { CheckIcon, CloseIcon, PlayBadgeIcon } from "./icons";
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
  const [seekNonce, setSeekNonce] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [ratio, setRatio] = useState(0);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);

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

  function playFrom(index: number) {
    setStartIndex(index);
    setActiveIndex(index);
    setRatio(0);
    setSeekNonce((nonce) => nonce + 1);
    setPlaying(true);
  }

  function toggle(key: string) {
    setPlaying(false);
    setStartIndex(0);
    setActiveIndex(0);
    setRatio(0);
    setOrder((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  }

  function remove(index: number) {
    setPlaying(false);
    setStartIndex(0);
    setActiveIndex(0);
    setRatio(0);
    setOrder((prev) => prev.filter((_, i) => i !== index));
  }

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= order.length) return;
    setPlaying(false);
    setStartIndex(0);
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
              seekNonce={seekNonce}
              onProgress={(index, nextRatio) => {
                setActiveIndex(index);
                setRatio(nextRatio);
              }}
            />
            <button type="button" className="ohf-tl-play" onClick={() => setPlaying((on) => !on)}>
              {playing ? "Pause" : "Play"}
            </button>
            </div>
            <div className="ohf-tl-bar" role="group" aria-label="Sequence progress">
              {clips.map((clip, index) => {
                const known = clips.every((item) => (durations[item.key] ?? 0) > 0);
                const weight = known ? durations[clip.key]! : 1;
                const fill = index < activeIndex ? 1 : index === activeIndex ? ratio : 0;
                return (
                  <button
                    key={clip.key}
                    type="button"
                    className="ohf-tl-seg"
                    style={{ flex: `${weight} 1 0` }}
                    aria-label={`Play segment ${index + 1}`}
                    aria-current={index === activeIndex || undefined}
                    onClick={() => playFrom(index)}
                  >
                    <span className="ohf-tl-seg-fill" style={{ width: `${Math.min(1, Math.max(0, fill)) * 100}%` }} />
                  </button>
                );
              })}
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
