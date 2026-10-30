"use client";

import { useState } from "react";

import { withBasePath } from "@/base-path";
import type { ShareFact, ShareKind } from "@/share/types";

import { AiIcon, PlayIcon, StopIcon, VolumeIcon, VolumeOffIcon } from "./icons";
import { TimelinePlayer } from "./timeline-player";

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

export function SharePreview({
  token,
  kind,
  count,
  facts,
}: {
  token: string;
  kind: ShareKind;
  count: number;
  facts: ShareFact[];
}) {
  const urls = Array.from({ length: count }, (_, index) => `/api/s/${token}/${index}`);
  const [playing, setPlaying] = useState(false);
  const [startIndex, setStartIndex] = useState(0);
  const [seekNonce, setSeekNonce] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [ratio, setRatio] = useState(0);
  const [durations, setDurations] = useState<number[]>([]);
  const [startAt, setStartAt] = useState(0);
  const [volume, setVolume] = useState(1);
  const [heldVolume, setHeldVolume] = useState(1);
  const [measured, setMeasured] = useState("");
  const fact = facts[kind === "timeline" ? activeIndex : 0];
  const model = kind === "timeline" ? "" : fact?.model ?? "";
  const frame = fact?.ratio ?? "";
  const size = fact?.size || measured;
  const known = durations.length === count && durations.every((item) => item > 0);
  const elapsed = durations.slice(0, activeIndex).reduce((sum, item) => sum + (item || 0), 0) + ratio * (durations[activeIndex] || 0);
  const total = known ? durations.reduce((sum, item) => sum + item, 0) : 0;

  function playFrom(index: number, at = 0) {
    const duration = durations[index] || 0;
    const seconds = duration > 0 ? Math.min(Math.max(0, at), Math.max(0, duration - 0.05)) : 0;
    setStartIndex(index);
    setActiveIndex(index);
    setRatio(duration > 0 ? seconds / duration : 0);
    setStartAt(seconds);
    setSeekNonce((nonce) => nonce + 1);
    setPlaying(true);
  }

  function noteSize(event: React.SyntheticEvent<HTMLElement>) {
    const media = event.target;
    if (!(media instanceof HTMLImageElement || media instanceof HTMLVideoElement)) return;
    const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
    const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
    if (width > 0 && height > 0) setMeasured(`${width}×${height}`);
  }

  return (
    <main className="ohf-share" onContextMenu={(event) => event.preventDefault()}>
      <header className="ohf-share-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="ohf-share-logo" src={withBasePath("/logo.png")} alt="" width={28} height={28} />
        <span>Vicend VTA AI</span>
      </header>
      <div className="ohf-share-frame">
        <div className="ohf-share-fit">
        <div className="ohf-share-stage" onLoadedMetadata={noteSize} onLoad={noteSize}>
          {kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="ohf-share-still" src={urls[0]} alt="" draggable={false} onLoad={noteSize} />
          ) : (
            <>
              <TimelinePlayer
                urls={urls}
                playing={playing}
                startIndex={startIndex}
                seekNonce={seekNonce}
                startAt={startAt}
                volume={volume}
                lockDownload
                onProgress={(index, nextRatio, duration) => {
                  setActiveIndex(index);
                  setRatio(nextRatio);
                  if (duration > 0) {
                    setDurations((prev) => {
                      if (prev[index] === duration) return prev;
                      const next = prev.slice();
                      next[index] = duration;
                      return next;
                    });
                  }
                }}
              />
              <button
                type="button"
                className="ohf-share-hit"
                aria-label={playing ? "Stop" : "Play"}
                onClick={() => setPlaying((on) => !on)}
              />
              {!playing && (
                <span className="ohf-share-play" aria-hidden>
                  <PlayIcon size={28} />
                </span>
              )}
              <div className="ohf-share-controls">
                <button
                  type="button"
                  className="ohf-share-toggle"
                  aria-label={playing ? "Stop" : "Play"}
                  onClick={() => setPlaying((on) => !on)}
                >
                  {playing ? <StopIcon size={14} /> : <PlayIcon size={14} />}
                </button>
                <span className="ohf-share-time">{clock(elapsed)}</span>
                <div className="ohf-share-segs" role="group" aria-label="Clips">
                  {urls.map((_, index) => {
                    const fill = index < activeIndex ? 1 : index === activeIndex ? ratio : 0;
                    return (
                      <button
                        key={index}
                        type="button"
                        className="ohf-share-seg"
                        aria-label={`Clip ${index + 1}`}
                        aria-current={index === activeIndex || undefined}
                        onClick={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          const at = rect.width <= 0 ? 0 : (event.clientX - rect.left) / rect.width;
                          const duration = durations[index] || 0;
                          playFrom(index, duration > 0 ? at * duration : 0);
                        }}
                      >
                        <span style={{ width: `${Math.min(1, Math.max(0, fill)) * 100}%` }} />
                      </button>
                    );
                  })}
                </div>
                <span className="ohf-share-time ohf-share-time--end">
                  {known ? clock(total) : `${activeIndex + 1}/${count}`}
                </span>
                <div className="ohf-share-volume">
                  <button
                    type="button"
                    className="ohf-share-toggle"
                    aria-label={volume === 0 ? "Unmute" : "Mute"}
                    onClick={() => {
                      if (volume === 0) setVolume(heldVolume || 1);
                      else {
                        setHeldVolume(volume);
                        setVolume(0);
                      }
                    }}
                  >
                    {volume === 0 ? <VolumeOffIcon size={16} /> : <VolumeIcon size={16} />}
                  </button>
                  <input
                    className="ohf-share-volume-range"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volume}
                    aria-label="Volume"
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setVolume(next);
                      if (next > 0) setHeldVolume(next);
                    }}
                  />
                </div>
              </div>
            </>
          )}
          <span className="ohf-share-ai" title={model || "AI"}>
            <AiIcon size={14} />
            {model && <span>{model}</span>}
          </span>
        </div>
        </div>
        {(model || frame || size) && (
          <p className="ohf-share-facts">
            {model && <span>Model: {model}</span>}
            {frame && <span>Ratio: {frame}</span>}
            {size && <span>Size: {size}</span>}
          </p>
        )}
      </div>
    </main>
  );
}
