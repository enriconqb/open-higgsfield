"use client";

import { useEffect, useRef, useState } from "react";

const HANDOFF_S = 0.08;

/** Two stacked videos. The next clip is primed while the current one plays,
    and it starts just before the end so the last frame stays up until the
    next one is actually painting. */
export function TimelinePlayer({
  urls,
  playing,
  startIndex,
  seekNonce,
  startAt = 0,
  volume = 1,
  lockDownload = false,
  onProgress,
}: {
  urls: string[];
  playing: boolean;
  startIndex: number;
  seekNonce: number;
  /** Seconds into the clip named by startIndex. Studio leaves this at 0. */
  startAt?: number;
  /** 0–1. Applied to both stacked videos. */
  volume?: number;
  lockDownload?: boolean;
  onProgress: (index: number, ratio: number, duration: number) => void;
}) {
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);
  const indexRef = useRef(0);
  const activeRef = useRef<0 | 1>(0);
  const handoffRef = useRef(false);
  const urlsRef = useRef(urls);
  const onProgressRef = useRef(onProgress);
  const startAtRef = useRef(startAt);
  const volumeRef = useRef(volume);
  const playingRef = useRef(playing);
  const seekPending = useRef(false);
  urlsRef.current = urls;
  onProgressRef.current = onProgress;
  startAtRef.current = startAt;
  volumeRef.current = volume;
  playingRef.current = playing;
  const [front, setFront] = useState<0 | 1>(0);

  function slot(which: 0 | 1) {
    return which === 0 ? aRef.current : bRef.current;
  }

  function sameMedia(video: HTMLVideoElement, url: string): boolean {
    if (!video.currentSrc) return false;
    try {
      const current = new URL(video.currentSrc);
      return current.pathname === new URL(url, current.origin).pathname;
    } catch {
      return false;
    }
  }

  function applyVolume(video: HTMLVideoElement) {
    const level = Math.min(1, Math.max(0, volumeRef.current));
    video.volume = level;
    video.muted = level === 0;
  }

  function place(video: HTMLVideoElement, at: number, report: boolean) {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const next = duration > 0 ? Math.min(Math.max(0, at), Math.max(0, duration - 0.05)) : Math.max(0, at);
    try {
      video.currentTime = next;
    } catch {
      /* metadata not ready yet */
    }
    if (report && duration > 0) {
      onProgressRef.current(indexRef.current, next / duration, duration);
    }
  }

  function prime(video: HTMLVideoElement | null, url: string | undefined, at = 0, report = false) {
    if (!video) return;
    applyVolume(video);
    if (!url) {
      video.removeAttribute("src");
      video.load();
      return;
    }
    if (video.getAttribute("src") !== url) {
      video.src = url;
    }
    video.pause();
    const seek = () => place(video, at, report);
    if (video.readyState >= 1) seek();
    else video.addEventListener("loadedmetadata", seek, { once: true });
  }

  const urlsKeyRef = useRef("");
  const seekSeen = useRef<number | null>(null);
  const indexSeen = useRef<number | null>(null);

  useEffect(() => {
    const key = urls.join("\n");
    const sameSequence = key === urlsKeyRef.current;
    urlsKeyRef.current = key;
    if (sameSequence && seekNonce === seekSeen.current && startIndex === indexSeen.current) return;
    seekSeen.current = seekNonce;
    indexSeen.current = startIndex;
    const index = Math.min(Math.max(0, startIndex), Math.max(0, urls.length - 1));
    indexRef.current = index;
    activeRef.current = 0;
    handoffRef.current = false;
    setFront(0);
    const first = aRef.current;
    const second = bRef.current;
    if (!first) return;
    const at = Math.max(0, startAtRef.current);
    let cancelled = false;
    let onSeeked: (() => void) | null = null;
    seekPending.current = true;
    const finish = () => {
      if (cancelled) return;
      seekPending.current = false;
      if (playingRef.current && urls[index]) void first.play().catch(() => {});
      else first.pause();
    };
    const seekTo = () => {
      if (cancelled) return;
      const duration = Number.isFinite(first.duration) ? first.duration : 0;
      const next = duration > 0 ? Math.min(at, Math.max(0, duration - 0.05)) : at;
      if (duration > 0) onProgressRef.current(index, next / duration, duration);
      else if (at <= 0) onProgressRef.current(index, 0, 0);
      if (first.readyState >= 1 && Math.abs(first.currentTime - next) < 0.08) {
        finish();
        return;
      }
      onSeeked = () => {
        if (onSeeked) first.removeEventListener("seeked", onSeeked);
        finish();
      };
      first.addEventListener("seeked", onSeeked);
      try {
        first.currentTime = next;
      } catch {
        if (onSeeked) first.removeEventListener("seeked", onSeeked);
        finish();
      }
    };
    applyVolume(first);
    if (!sameMedia(first, urls[index])) first.src = urls[index];
    first.pause();
    if (first.readyState >= 1) seekTo();
    else first.addEventListener("loadedmetadata", seekTo, { once: true });
    prime(second, urls[index + 1]);
    return () => {
      cancelled = true;
      seekPending.current = false;
      first.removeEventListener("loadedmetadata", seekTo);
      if (onSeeked) first.removeEventListener("seeked", onSeeked);
    };
    // playing is applied again by the effect below; this jump only runs on seek.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls, startIndex, seekNonce]);

  useEffect(() => {
    const current = slot(activeRef.current);
    if (!current || !urls[0] || seekPending.current) return;
    if (playing) void current.play().catch(() => {});
    else {
      current.pause();
      slot(activeRef.current === 0 ? 1 : 0)?.pause();
    }
  }, [playing, urls]);

  useEffect(() => {
    const level = Math.min(1, Math.max(0, volume));
    for (const video of [aRef.current, bRef.current]) {
      if (!video) continue;
      video.volume = level;
      video.muted = level === 0;
    }
  }, [volume]);

  function armNext(from: 0 | 1) {
    const nextIndex = indexRef.current + 1;
    const next = slot(from === 0 ? 1 : 0);
    const list = urlsRef.current;
    if (!next || next.readyState < 2 || nextIndex >= list.length) return;
    handoffRef.current = true;
    try {
      next.currentTime = 0;
    } catch {
      /* still seeking */
    }
    void next.play().catch(() => {
      handoffRef.current = false;
    });
  }

  function onTime(which: 0 | 1) {
    if (activeRef.current !== which || handoffRef.current) return;
    const current = slot(which);
    if (!current || !Number.isFinite(current.duration) || current.duration === 0) return;
    onProgressRef.current(indexRef.current, current.currentTime / current.duration, current.duration);
    if (current.duration - current.currentTime > HANDOFF_S) return;
    armNext(which);
  }

  function onPlaying(which: 0 | 1) {
    if (!handoffRef.current || which === activeRef.current) return;
    const previous = slot(activeRef.current);
    previous?.pause();
    activeRef.current = which;
    indexRef.current += 1;
    handoffRef.current = false;
    setFront(which);
    onProgressRef.current(indexRef.current, 0, 0);
    prime(previous, urlsRef.current[indexRef.current + 1]);
  }

  function onEnded(which: 0 | 1) {
    if (activeRef.current !== which) return;
    if (handoffRef.current) return;
    armNext(which);
  }

  return (
    <div className="ohf-tl-stage">
      <video
        ref={aRef}
        className="ohf-tl-video"
        data-front={front === 0 || undefined}
        playsInline
        preload="auto"
        controlsList={lockDownload ? "nodownload" : undefined}
        disablePictureInPicture={lockDownload}
        onContextMenu={lockDownload ? (event) => event.preventDefault() : undefined}
        onTimeUpdate={() => onTime(0)}
        onPlaying={() => onPlaying(0)}
        onEnded={() => onEnded(0)}
      />
      <video
        ref={bRef}
        className="ohf-tl-video"
        data-front={front === 1 || undefined}
        playsInline
        preload="auto"
        controlsList={lockDownload ? "nodownload" : undefined}
        disablePictureInPicture={lockDownload}
        onContextMenu={lockDownload ? (event) => event.preventDefault() : undefined}
        onTimeUpdate={() => onTime(1)}
        onPlaying={() => onPlaying(1)}
        onEnded={() => onEnded(1)}
      />
    </div>
  );
}
