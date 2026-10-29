"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { compareInset } from "./compare-geometry";
import { CompareIcon, MinusIcon, PauseIcon, PlayIcon, PlusIcon } from "./icons";
import { sourcesForUrls } from "./media-source";

/** One thing the comparison can show. `url` is the copy on this server (or the
    only address there is); `remoteUrl` is the provider's link, tried first while
    it lasts — the same rule the gallery and the viewer follow. */
export type CompareItem = {
  id: string;
  kind: "image" | "video";
  title: string;
  url: string;
  remoteUrl?: string;
};

const MAX_ZOOM = 5;
const ZOOM_STEP = 0.5;
/** How far the two videos may drift before the follower is pulled back. Above a
    frame's worth of playback, so ordinary jitter is not corrected. */
const DRIFT_S = 0.05;

/** One side's address, with the CDN link tried first and the archived copy
    taken over the once it stops answering. */
function useSide(item: CompareItem | null) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [item?.id]);
  const sources = item
    ? sourcesForUrls({ kind: item.kind, url: item.url, remoteUrl: item.remoteUrl })
    : { primary: "", fallback: null };
  return {
    src: failed && sources.fallback ? sources.fallback : sources.primary,
    onError: () => setFailed(true),
  };
}

export function CompareStage({ before, after }: { before: CompareItem; after: CompareItem | null }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const beforeVideo = useRef<HTMLVideoElement>(null);
  const afterVideo = useRef<HTMLVideoElement>(null);

  const [pos, setPos] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [stageWidth, setStageWidth] = useState(0);
  const [ratio, setRatio] = useState(16 / 9);
  const [beforeSeconds, setBeforeSeconds] = useState<number | null>(null);
  const [afterSeconds, setAfterSeconds] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [drive, setDrive] = useState<"before" | "after">("before");
  const [audio, setAudio] = useState<"mute" | "before" | "after">("mute");
  const [fit, setFit] = useState<"contain" | "cover">("contain");
  const [now, setNow] = useState(0);

  /* Zoom and pan are read inside listeners that are attached once, so the live
     values are mirrored into refs rather than captured in a closure. */
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;

  const beforeSide = useSide(before);
  const afterSide = useSide(after);
  const both = after !== null;
  const bothVideo = before.kind === "video" && after?.kind === "video";
  const hasVideo = before.kind === "video" || after?.kind === "video";

  const clampPan = useCallback((next: { x: number; y: number }, z: number) => {
    const stage = stageRef.current;
    if (!stage) return next;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    return {
      x: Math.max(w - z * w, Math.min(0, next.x)),
      y: Math.max(h - z * h, Math.min(0, next.y)),
    };
  }, []);

  const applyZoom = useCallback(
    (next: number) => {
      const clamped = Math.max(1, Math.min(MAX_ZOOM, next));
      const current = zoomRef.current;
      if (Math.abs(clamped - current) < 1e-6) return;
      const w = stageRef.current?.clientWidth ?? 0;
      const h = stageRef.current?.clientHeight ?? 0;
      const k = clamped / current;
      const nextPan = clampPan(
        { x: w / 2 - (w / 2 - panRef.current.x) * k, y: h / 2 - (h / 2 - panRef.current.y) * k },
        clamped,
      );
      zoomRef.current = clamped;
      panRef.current = nextPan;
      setZoom(clamped);
      setPan(nextPan);
    },
    [clampPan],
  );

  const resetView = useCallback(() => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  /* Stage width in CSS pixels: the divider is placed as a percentage, but the
     clipped layer needs pixels, and both have to agree. */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setStageWidth(stage.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  /* A new pair starts from scratch: its own shape, its own clock. */
  useEffect(() => {
    setRatio(16 / 9);
    setBeforeSeconds(null);
    setAfterSeconds(null);
    setNow(0);
    setPlaying(false);
    setDrive("before");
    resetView();
    setPos(50);
  }, [before.id, after?.id, resetView]);

  /* Ctrl/Cmd + wheel zooms; a plain wheel keeps scrolling the panel, which the
     strip below relies on. Attached natively so preventDefault is allowed. */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      applyZoom(zoomRef.current + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  /* ---------- pointer: the divider, or panning a zoomed pair ---------- */
  const drag = useRef<{
    mode: "slider" | "pan";
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);

  function positionFrom(clientX: number) {
    const stage = stageRef.current;
    if (!stage) return pos;
    const rect = stage.getBoundingClientRect();
    if (rect.width === 0) return pos;
    return ((clientX - rect.left) / rect.width) * 100;
  }

  function onDividerDown(event: React.PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    drag.current = { mode: "slider", x: 0, y: 0, panX: 0, panY: 0 };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    setPos(Math.max(0, Math.min(100, positionFrom(event.clientX))));
  }

  function onStageDown(event: React.PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (!both || zoomRef.current <= 1) return;
    drag.current = {
      mode: "pan",
      x: event.clientX,
      y: event.clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function onStageMove(event: React.PointerEvent) {
    const state = drag.current;
    if (!state) return;
    if (state.mode === "slider") {
      setPos(Math.max(0, Math.min(100, positionFrom(event.clientX))));
      return;
    }
    const next = clampPan(
      { x: state.panX + (event.clientX - state.x), y: state.panY + (event.clientY - state.y) },
      zoomRef.current,
    );
    panRef.current = next;
    setPan(next);
  }

  function endDrag(event: React.PointerEvent) {
    if (!drag.current) return;
    drag.current = null;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  /* ---------- the clock: both videos on the same second ---------- */
  const masterRef = drive === "before" ? beforeVideo : afterVideo;
  const followerRef = drive === "before" ? afterVideo : beforeVideo;
  const masterSeconds = drive === "before" ? beforeSeconds : afterSeconds;
  const shorter = bothVideo && beforeSeconds && afterSeconds ? Math.min(beforeSeconds, afterSeconds) : 0;
  const durationsDiffer =
    bothVideo && beforeSeconds && afterSeconds && Math.abs(beforeSeconds - afterSeconds) > 0.3;

  const seekBoth = useCallback((seconds: number) => {
    for (const ref of [beforeVideo, afterVideo]) {
      const video = ref.current;
      if (!video) continue;
      const span = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
      try {
        video.currentTime = span ? seconds % span : seconds;
      } catch {
        /* metadata not ready yet */
      }
    }
    setNow(seconds);
  }, []);

  useEffect(() => {
    const master = masterRef.current;
    const follower = followerRef.current;
    if (!master) return;
    if (!playing) {
      master.pause();
      follower?.pause();
      return;
    }
    void master.play().catch(() => setPlaying(false));
    if (follower) void follower.play().catch(() => undefined);
    let raf = 0;
    let ticks = 0;
    const tick = () => {
      const lead = masterRef.current;
      const back = followerRef.current;
      if (lead && back && !lead.seeking && !back.seeking) {
        const span = Number.isFinite(back.duration) && back.duration > 0 ? back.duration : null;
        /* A shorter clip repeats on the leader's clock: both stay on the same
           second of the story instead of one of them stopping short. */
        const target = span ? lead.currentTime % span : lead.currentTime;
        if (Math.abs(back.currentTime - target) > DRIFT_S) back.currentTime = target;
      }
      ticks += 1;
      if (lead && ticks % 6 === 0) setNow(lead.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, drive, beforeSide.src, afterSide.src]);

  /* Sound: one side at a time, or neither. */
  useEffect(() => {
    const sides: Array<[HTMLVideoElement | null, "before" | "after"]> = [
      [beforeVideo.current, "before"],
      [afterVideo.current, "after"],
    ];
    for (const [video, side] of sides) {
      if (!video) continue;
      const silent = audio === "mute" || audio !== side;
      video.muted = silent;
      video.volume = silent ? 0 : 1;
    }
  }, [audio, beforeSide.src, afterSide.src]);

  const inset = useMemo(
    () => compareInset({ stageWidth, pos, zoom, panX: pan.x }),
    [stageWidth, pos, zoom, pan.x],
  );

  function media(item: CompareItem, side: "before" | "after") {
    const source = side === "before" ? beforeSide : afterSide;
    if (item.kind === "video") {
      return (
        <video
          key={item.id}
          ref={side === "before" ? beforeVideo : afterVideo}
          className="ohf-cmp-media"
          src={source.src}
          muted={audio !== side}
          playsInline
          preload="auto"
          loop={loop}
          onError={source.onError}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            const seconds = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
            if (side === "before") {
              setBeforeSeconds(seconds);
              if (video.videoWidth) setRatio(video.videoWidth / video.videoHeight);
            } else {
              setAfterSeconds(seconds);
            }
          }}
          onTimeUpdate={(event) => {
            if (drive === side) setNow(event.currentTarget.currentTime);
          }}
          onEnded={() => setPlaying(false)}
        />
      );
    }
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        key={item.id}
        className="ohf-cmp-media"
        src={source.src}
        alt=""
        onError={source.onError}
        onLoad={(event) => {
          const image = event.currentTarget;
          if (side === "before" && image.naturalWidth) {
            setRatio(image.naturalWidth / image.naturalHeight);
          }
        }}
      />
    );
  }

  return (
    <div className="ohf-cmp-frame">
      <div className="ohf-cmp-stage-wrap">
        <div
          ref={stageRef}
          className="ohf-cmp-stage"
          data-zoomed={zoom > 1 && both ? true : undefined}
          data-fit={fit}
          style={{ ["--cmp-ratio" as string]: String(ratio) }}
          onPointerDown={onStageDown}
          onPointerMove={onStageMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div
            className="ohf-cmp-content"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            {after && <div className="ohf-cmp-layer">{media(after, "after")}</div>}
            <div
              className="ohf-cmp-layer ohf-cmp-layer--under"
              style={{ clipPath: `inset(0 ${inset}px 0 0)` }}
            >
              {media(before, "before")}
            </div>
          </div>

          <span className="ohf-cmp-tag ohf-cmp-tag--before">Before</span>
          {after && <span className="ohf-cmp-tag ohf-cmp-tag--after">After</span>}

          {both && (
            <div className="ohf-cmp-divider" style={{ left: `${pos}%` }} onPointerDown={onDividerDown}>
              <span className="ohf-cmp-divider-line" />
              <button
                type="button"
                className="ohf-cmp-handle"
                role="slider"
                aria-label="Compare position"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pos)}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 10 : 1;
                  if (event.key === "ArrowLeft") setPos((value) => Math.max(0, value - step));
                  else if (event.key === "ArrowRight") setPos((value) => Math.min(100, value + step));
                  else if (event.key === "Home") setPos(0);
                  else if (event.key === "End") setPos(100);
                  else return;
                  event.preventDefault();
                }}
              >
                <CompareIcon size={13} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="ohf-cmp-controls">
        <div className="ohf-cmp-group">
          {hasVideo && (
            <>
              <button
                type="button"
                className="ohf-cmp-icon"
                onClick={() => setPlaying((on) => !on)}
                title={playing ? "Pause both" : "Play both"}
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
              </button>
              <button
                type="button"
                className="ohf-cmp-chip"
                onClick={() => seekBoth(0)}
                title="Back to the first frame"
              >
                Restart
              </button>
              <button
                type="button"
                className="ohf-cmp-chip"
                data-on={loop || undefined}
                onClick={() => setLoop((on) => !on)}
                title="Repeat both clips"
              >
                Loop
              </button>
            </>
          )}
        </div>

        <div className="ohf-cmp-group">
          <button
            type="button"
            className="ohf-cmp-icon"
            onClick={() => applyZoom(zoomRef.current - ZOOM_STEP)}
            disabled={zoom <= 1}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <MinusIcon size={13} />
          </button>
          <span className="ohf-cmp-zoom">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="ohf-cmp-icon"
            onClick={() => applyZoom(zoomRef.current + ZOOM_STEP)}
            disabled={zoom >= MAX_ZOOM}
            title="Zoom in (Ctrl/Cmd + wheel)"
            aria-label="Zoom in"
          >
            <PlusIcon size={13} />
          </button>
          <button type="button" className="ohf-cmp-chip" onClick={resetView} title="Back to 100%">
            Fit
          </button>
          <button
            type="button"
            className="ohf-cmp-chip"
            data-on={fit === "cover" || undefined}
            onClick={() => setFit((mode) => (mode === "cover" ? "contain" : "cover"))}
            title="Fill crops both sides to the frame instead of fitting them"
          >
            Fill
          </button>
        </div>
      </div>

      {hasVideo && (
        <div className="ohf-cmp-clock">
          <input
            className="ohf-cmp-scrub"
            type="range"
            min={0}
            max={masterSeconds ?? 0}
            step={0.05}
            value={Math.min(now, masterSeconds ?? 0)}
            onChange={(event) => seekBoth(Number(event.target.value))}
            aria-label="Playback position"
          />
          <span className="ohf-cmp-time">
            {now.toFixed(1)}s / {(masterSeconds ?? 0).toFixed(1)}s
            {durationsDiffer && shorter ? ` · shorter side repeats (${shorter.toFixed(1)}s)` : ""}
          </span>

          <div className="ohf-cmp-group">
            <span className="ohf-cmp-note">Drive</span>
            <button
              type="button"
              className="ohf-cmp-chip"
              data-on={drive === "before" || undefined}
              onClick={() => {
                setDrive("before");
                seekBoth(0);
              }}
            >
              Before
            </button>
            <button
              type="button"
              className="ohf-cmp-chip"
              data-on={drive === "after" || undefined}
              disabled={!bothVideo}
              onClick={() => {
                setDrive("after");
                seekBoth(0);
              }}
            >
              After
            </button>
          </div>

          <div className="ohf-cmp-group">
            <span className="ohf-cmp-note">Sound</span>
            {(["mute", "before", "after"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className="ohf-cmp-chip"
                data-on={audio === mode || undefined}
                onClick={() => setAudio(mode)}
              >
                {mode === "mute" ? "Off" : mode === "before" ? "Before" : "After"}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="ohf-cmp-hint">
        {both
          ? "Drag the divider — both videos keep playing on the same second."
          : "Add a second item to the strip to compare."}
      </p>
    </div>
  );
}
