"use client";

import { useEffect, useRef, useState, type Ref, type SyntheticEvent } from "react";

const ZOOM_MIN = 1;
const ZOOM_MAX = 6;

/** Scroll zooms toward the pointer. Drag pans once the picture is larger than
    the stage, and a double click puts it back at 1×. `resetKey` returns to 1×
    when the picture underneath changes. */
export function ZoomStage({
  src,
  alt,
  className = "ohf-asset-preview-stage ohf-asset-preview-stage--zoom",
  imgClassName,
  resetKey,
  imgRef,
  onLoad,
  onError,
}: {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  resetKey?: string;
  imgRef?: Ref<HTMLImageElement>;
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  onError?: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ scale: ZOOM_MIN, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [view, setView] = useState(viewRef.current);
  const [grabbing, setGrabbing] = useState(false);

  function apply(next: { scale: number; x: number; y: number }) {
    const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next.scale));
    const settled = scale === ZOOM_MIN ? { scale, x: 0, y: 0 } : { scale, x: next.x, y: next.y };
    viewRef.current = settled;
    setView(settled);
  }

  useEffect(() => {
    viewRef.current = { scale: ZOOM_MIN, x: 0, y: 0 };
    setView(viewRef.current);
    drag.current = null;
    setGrabbing(false);
  }, [resetKey]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const current = viewRef.current;
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current.scale * factor));
      if (scale === current.scale) return;
      if (scale === ZOOM_MIN) {
        apply({ scale, x: 0, y: 0 });
        return;
      }
      const ratio = scale / current.scale;
      const px = event.clientX - rect.left - rect.width / 2;
      const py = event.clientY - rect.top - rect.height / 2;
      apply({
        scale,
        x: px - (px - current.x) * ratio,
        y: py - (py - current.y) * ratio,
      });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      ref={stageRef}
      className={className}
      data-zoomed={view.scale > ZOOM_MIN}
      data-grabbing={grabbing}
      onDoubleClick={() => apply({ scale: ZOOM_MIN, x: 0, y: 0 })}
      onPointerDown={(event) => {
        if (viewRef.current.scale <= ZOOM_MIN) return;
        drag.current = { x: event.clientX, y: event.clientY, ox: viewRef.current.x, oy: viewRef.current.y };
        setGrabbing(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const from = drag.current;
        if (!from) return;
        apply({
          scale: viewRef.current.scale,
          x: from.ox + (event.clientX - from.x),
          y: from.oy + (event.clientY - from.y),
        });
      }}
      onPointerUp={() => {
        drag.current = null;
        setGrabbing(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setGrabbing(false);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        className={imgClassName}
        src={src}
        alt={alt}
        draggable={false}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        onLoad={onLoad}
        onError={onError}
      />
    </div>
  );
}
