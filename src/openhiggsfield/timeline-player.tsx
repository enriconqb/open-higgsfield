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
  onProgress,
}: {
  urls: string[];
  playing: boolean;
  startIndex: number;
  seekNonce: number;
  onProgress: (index: number, ratio: number, duration: number) => void;
}) {
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);
  const indexRef = useRef(0);
  const activeRef = useRef<0 | 1>(0);
  const handoffRef = useRef(false);
  const urlsRef = useRef(urls);
  const onProgressRef = useRef(onProgress);
  urlsRef.current = urls;
  onProgressRef.current = onProgress;
  const [front, setFront] = useState<0 | 1>(0);

  function slot(which: 0 | 1) {
    return which === 0 ? aRef.current : bRef.current;
  }

  function prime(video: HTMLVideoElement | null, url: string | undefined) {
    if (!video) return;
    if (!url) {
      video.removeAttribute("src");
      video.load();
      return;
    }
    if (video.getAttribute("src") !== url) {
      video.src = url;
    }
    video.pause();
    const seek = () => {
      try {
        video.currentTime = 0;
      } catch {
        /* metadata not ready yet */
      }
    };
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
    prime(first, urls[index]);
    prime(second, urls[index + 1]);
    onProgressRef.current(index, 0, 0);
    if (playing && urls[index]) void first.play().catch(() => {});
    else first.pause();
    // playing is applied again by the effect below; this jump only runs on seek.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls, startIndex, seekNonce]);

  useEffect(() => {
    const current = slot(activeRef.current);
    if (!current || !urls[0]) return;
    if (playing) void current.play().catch(() => {});
    else {
      current.pause();
      slot(activeRef.current === 0 ? 1 : 0)?.pause();
    }
  }, [playing, urls]);

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
        onTimeUpdate={() => onTime(1)}
        onPlaying={() => onPlaying(1)}
        onEnded={() => onEnded(1)}
      />
    </div>
  );
}
