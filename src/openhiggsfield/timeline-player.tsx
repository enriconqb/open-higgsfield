"use client";

import { useEffect, useRef, useState } from "react";

const HANDOFF_S = 0.08;
const AHEAD_S = 1.5;

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
  loopSequence = false,
  onProgress,
  onActiveVideo,
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
  /** After the last clip, continue at the first. The studio leaves this off. */
  loopSequence?: boolean;
  onProgress: (index: number, ratio: number, duration: number) => void;
  /** The video element currently painted in front. */
  onActiveVideo?: (video: HTMLVideoElement | null) => void;
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
  const loopRef = useRef(loopSequence);
  const pendingIndex = useRef<number | null>(null);
  const onActiveVideoRef = useRef(onActiveVideo);
  onActiveVideoRef.current = onActiveVideo;
  const seekPending = useRef(false);
  urlsRef.current = urls;
  onProgressRef.current = onProgress;
  startAtRef.current = startAt;
  volumeRef.current = volume;
  playingRef.current = playing;
  loopRef.current = loopSequence;
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

  function covers(video: HTMLVideoElement, from: number, to: number): boolean {
    const end = Math.max(from, to);
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= from + 0.05 && video.buffered.end(i) >= end - 0.05) return true;
    }
    return false;
  }

  /* Play only from data already in the element. A full buffer starts at once.
     A short lead of about 1.5s is enough while the rest is still arriving. */
  function readyToPlay(video: HTMLVideoElement): boolean {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const at = Math.max(0, video.currentTime);
    if (duration > 0 && covers(video, at, Math.max(at, duration - 0.05))) return true;
    const horizon = duration > 0 ? Math.min(at + AHEAD_S, Math.max(at, duration - 0.05)) : at;
    if (horizon <= at + 0.05) return video.readyState >= 2;
    return covers(video, at, horizon);
  }

  function playWhenReady(video: HTMLVideoElement) {
    const stop = () => {
      video.removeEventListener("progress", attempt);
      video.removeEventListener("canplay", attempt);
    };
    const attempt = () => {
      if (!playingRef.current) {
        stop();
        video.pause();
        return;
      }
      if (!readyToPlay(video)) return;
      stop();
      void video.play().catch(() => {});
    };
    attempt();
    if (playingRef.current && video.paused) {
      video.addEventListener("progress", attempt);
      video.addEventListener("canplay", attempt);
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
      if (playingRef.current && urls[index]) playWhenReady(first);
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
    const changed = !sameMedia(first, urls[index] ?? "");
    if (changed && urls[index]) first.src = urls[index];
    first.pause();
    /* A leftover readyState belongs to the previous source. Wait until the new one reports. */
    if (!changed && first.readyState >= 1) seekTo();
    else first.addEventListener("loadedmetadata", seekTo, { once: true });
    prime(second, urlAfter(index));
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
    if (playing) playWhenReady(current);
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

  useEffect(() => {
    onActiveVideoRef.current?.(slot(front));
  }, [front]);

  function indexAfter(fromIndex: number): number | null {
    const list = urlsRef.current;
    if (list.length === 0) return null;
    const next = fromIndex + 1;
    if (next < list.length) return next;
    return loopRef.current ? 0 : null;
  }

  function urlAfter(fromIndex: number): string | undefined {
    const next = indexAfter(fromIndex);
    if (next === null || next === fromIndex) return undefined;
    return urlsRef.current[next];
  }

  function armNext(from: 0 | 1) {
    const nextIndex = indexAfter(indexRef.current);
    if (nextIndex === null) return;
    const current = slot(from);
    if (nextIndex === indexRef.current && current) {
      try {
        current.currentTime = 0;
      } catch {
        /* still seeking */
      }
      playWhenReady(current);
      onProgressRef.current(indexRef.current, 0, current.duration || 0);
      return;
    }
    const next = slot(from === 0 ? 1 : 0);
    const url = urlsRef.current[nextIndex];
    if (!next || !url) return;
    pendingIndex.current = nextIndex;
    handoffRef.current = true;
    const start = () => {
      try {
        next.currentTime = 0;
      } catch {
        /* still seeking */
      }
      if (!readyToPlay(next)) {
        const once = () => {
          if (!readyToPlay(next)) return;
          next.removeEventListener("progress", once);
          next.removeEventListener("canplay", once);
          start();
        };
        next.addEventListener("progress", once);
        next.addEventListener("canplay", once);
        return;
      }
      void next.play().catch(() => {
        handoffRef.current = false;
        pendingIndex.current = null;
      });
    };
    if (next.getAttribute("src") !== url) {
      next.src = url;
      next.addEventListener("loadeddata", start, { once: true });
      return;
    }
    if (next.readyState < 2) {
      next.addEventListener("loadeddata", start, { once: true });
      return;
    }
    start();
  }

  function onTime(which: 0 | 1) {
    if (seekPending.current) return;
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
    indexRef.current = pendingIndex.current ?? indexRef.current + 1;
    pendingIndex.current = null;
    handoffRef.current = false;
    setFront(which);
    onProgressRef.current(indexRef.current, 0, 0);
    prime(previous, urlAfter(indexRef.current));
  }

  function onWaiting(which: 0 | 1) {
    if (activeRef.current !== which || !playingRef.current) return;
    const video = slot(which);
    if (!video) return;
    const resume = () => {
      if (!readyToPlay(video)) return;
      video.removeEventListener("progress", resume);
      video.removeEventListener("canplay", resume);
      if (playingRef.current && activeRef.current === which) void video.play().catch(() => {});
    };
    video.addEventListener("progress", resume);
    video.addEventListener("canplay", resume);
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
        onWaiting={() => onWaiting(0)}
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
        onWaiting={() => onWaiting(1)}
        onEnded={() => onEnded(1)}
      />
    </div>
  );
}
