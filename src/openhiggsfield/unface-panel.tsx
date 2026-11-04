"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { withBasePath } from "@/base-path";
import { uploadMedia } from "@/generation/upload";

import { artFor } from "./artwork";
import type { RunRecord } from "./history";
import { CloseIcon, DownloadIcon, PlusIcon, UploadIcon } from "./icons";
import { loadUploads, rememberUpload, saveUploads, type UploadRecord } from "./uploads";
import {
  DEFAULT_MARK,
  drawComposite,
  fitBox,
  markExtent,
  outputSize,
  type GridSettings,
  type MarkSettings,
  type Raster,
  type ScenerySettings,
  type UnfaceMethod,
} from "./unface-render";

const METHODS: { id: UnfaceMethod; label: string }[] = [
  { id: "grid", label: "Grid" },
  { id: "scenery", label: "Scenery" },
  { id: "x", label: "X" },
  { id: "sheet", label: "Sheet" },
];

const GRID_PRESETS = [4, 6, 10] as const;

const GRID_COLORS = [
  { id: "white", value: "#f4f6f6" },
  { id: "black", value: "#111214" },
  { id: "accent", value: "#7b88ff" },
];

const SCENERY_PRESETS = [
  { id: "mist", name: "Mountain Mist", src: "/unface/mountain-mist.jpg" },
  { id: "sunset", name: "River Sunset", src: "/unface/river-sunset.jpg" },
  { id: "stone", name: "Stone Texture", src: "/unface/stone-texture.jpg" },
] as const;

type XMark = MarkSettings & { id: string };

function createMark(partial?: Partial<MarkSettings>): XMark {
  return { ...DEFAULT_MARK, ...partial, id: localId() };
}

interface SourceImage {
  name: string;
  raster: Raster;
  ownedUrl: string | null;
}

interface PlacedFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
  header: number;
}

interface LibraryItem {
  id: string;
  name: string;
  url: string;
}

export function UnFace({
  history,
  onSaved,
}: {
  history: RunRecord[];
  onSaved: (record: RunRecord) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sceneryFileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{
    mode: "move" | "resize" | "rotate";
    target: "mark" | "scenery";
    pointerId: number;
    originX: number;
    originY: number;
    markId: string;
    mark: XMark;
    scenery: ScenerySettings;
  } | null>(null);

  const [method, setMethod] = useState<UnfaceMethod>("grid");
  const [source, setSource] = useState<SourceImage | null>(null);
  const [grid, setGrid] = useState<GridSettings>({
    columns: 6,
    rows: 6,
    lineWidth: 12,
    opacity: 100,
    color: "#f4f6f6",
  });
  const [scenery, setScenery] = useState<ScenerySettings>({ opacity: 58, scale: 100, cx: 0.5, cy: 0.5 });
  const [presetId, setPresetId] = useState<(typeof SCENERY_PRESETS)[number]["id"]>("mist");
  const [customScenery, setCustomScenery] = useState<{ url: string; name: string } | null>(null);
  const [sceneryRaster, setSceneryRaster] = useState<Raster | null>(null);
  const [marks, setMarks] = useState<XMark[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [frame, setFrame] = useState<PlacedFrame | null>(null);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [busy, setBusy] = useState<"download" | "save" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const marksRef = useRef(marks);
  marksRef.current = marks;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const sceneryRef = useRef(scenery);
  sceneryRef.current = scenery;
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    let live = true;
    void loadUploads()
      .then((rows) => {
        if (live) setUploads(rows);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (source?.ownedUrl) URL.revokeObjectURL(source.ownedUrl);
    };
  }, [source]);

  useEffect(() => {
    return () => {
      if (customScenery) URL.revokeObjectURL(customScenery.url);
    };
  }, [customScenery]);

  const scenerySrc = customScenery?.url ?? withBasePath(SCENERY_PRESETS.find((item) => item.id === presetId)!.src);

  useEffect(() => {
    let live = true;
    const image = new Image();
    image.onload = () => {
      if (!live) return;
      setSceneryRaster({ image, width: image.naturalWidth || 800, height: image.naturalHeight || 800 });
    };
    image.onerror = () => {
      if (live) setSceneryRaster(null);
    };
    image.src = scenerySrc;
    return () => {
      live = false;
    };
  }, [scenerySrc]);

  const paint = useCallback(() => {
    const board = boardRef.current;
    const canvas = canvasRef.current;
    const current = sourceRef.current;
    if (!board || !canvas || !current) {
      setFrame(null);
      return;
    }
    const bounds = board.getBoundingClientRect();
    const size = outputSize(current.raster.width, current.raster.height, method);
    const fitted = fitBox(bounds.width, bounds.height, size.width, size.height);
    const nextFrame: PlacedFrame = { ...fitted, header: size.header };
    setFrame((prev) => (sameFrame(prev, nextFrame) ? prev : nextFrame));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bitmapWidth = Math.max(1, Math.round(fitted.width * dpr));
    const bitmapHeight = Math.max(1, Math.round(fitted.height * dpr));
    if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
    if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scaleX = bitmapWidth / size.width;
    const scaleY = bitmapHeight / size.height;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    drawComposite(ctx, {
      image: current.raster,
      method,
      grid,
      scenery,
      sceneryImage: sceneryRaster,
      marks: marksForPaint(marksRef.current, draftRef.current),
    });
  }, [grid, method, scenery, sceneryRaster]);

  useEffect(() => {
    paint();
    const board = boardRef.current;
    if (!board) return;
    const observer = new ResizeObserver(() => paint());
    observer.observe(board);
    return () => observer.disconnect();
  }, [paint, source]);

  useEffect(() => {
    paint();
  }, [marks, draft, paint]);

  const library = useMemo(() => {
    const items: LibraryItem[] = [];
    const seen = new Set<string>();
    const push = (item: LibraryItem) => {
      if (!item.url || seen.has(item.url)) return;
      seen.add(item.url);
      items.push(item);
    };
    for (const record of history) {
      if (record.status !== "completed" || record.kind !== "image" || !record.urls[0]) continue;
      push({
        id: record.id,
        name: record.prompt || record.modelLabel,
        url: withBasePath(record.urls[0]),
      });
      if (items.length >= 40) break;
    }
    for (const row of uploads) {
      if (row.kind !== "image") continue;
      push({ id: row.id, name: row.name, url: withBasePath(row.url) });
      if (items.length >= 80) break;
    }
    return items;
  }, [history, uploads]);

  async function useFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Choose a PNG, JPEG, WebP, or GIF.");
      return;
    }
    setError(null);
    setNotice(null);
    const ownedUrl = URL.createObjectURL(file);
    try {
      const raster = await loadRaster(ownedUrl, false);
      setSource({ name: file.name, raster, ownedUrl });
      setPickerOpen(false);
    } catch {
      URL.revokeObjectURL(ownedUrl);
      setError("That image could not be read.");
    }
  }

  async function useLibrary(item: LibraryItem) {
    setError(null);
    setNotice(null);
    try {
      const cross = isCrossOrigin(item.url);
      const raster = await loadRaster(item.url, cross);
      setSource({ name: item.name, raster, ownedUrl: null });
      setPickerOpen(false);
    } catch {
      setError("That library image could not be opened for editing. Upload it again from this device.");
    }
  }

  function onSceneryFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Scenery needs an image file.");
      return;
    }
    const url = URL.createObjectURL(file);
    setCustomScenery({ url, name: file.name });
    setError(null);
  }

  async function exportBlob(): Promise<Blob> {
    const current = sourceRef.current;
    if (!current) throw new Error("Choose an image first.");
    const size = outputSize(current.raster.width, current.raster.height, method);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot export the image.");
    drawComposite(ctx, {
      image: current.raster,
      method,
      grid,
      scenery,
      sceneryImage: sceneryRaster,
      marks,
    });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Export failed. Use an image from this device so the canvas stays readable.");
    return blob;
  }

  async function download() {
    if (!source || busy) return;
    setBusy("download");
    setError(null);
    try {
      const blob = await exportBlob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = fileName(source.name, method);
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
      setNotice("Download started.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Download failed.");
    } finally {
      setBusy(null);
    }
  }

  async function saveToAssets() {
    if (!source || busy) return;
    setBusy("save");
    setError(null);
    try {
      const blob = await exportBlob();
      const name = fileName(source.name, method);
      const file = new File([blob], name, { type: "image/png" });
      const uploaded = await uploadMedia(file);
      const createdAt = Date.now();
      const upload: UploadRecord = {
        id: localId(),
        url: uploaded.url,
        kind: "image",
        name,
        createdAt,
      };
      const stored = await loadUploads();
      await saveUploads(rememberUpload(stored, upload));
      setUploads((prev) => rememberUpload(prev, upload));
      const id = localId();
      const size = outputSize(source.raster.width, source.raster.height, method);
      onSaved({
        id,
        surface: "image",
        modelId: "unface",
        modelLabel: "unFace",
        prompt: `unFace ${method} — ${source.name}`,
        ratio: `${size.width} / ${size.height}`,
        meta: "Local overlay",
        kind: "image",
        urls: [uploaded.url],
        status: "completed",
        art: artFor("image", 222, id),
        createdAt,
      });
      setNotice("Saved to Assets and to your uploads.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Save failed.";
      setError(message.includes("Login") || message.includes("Sign in") ? "Sign in to save this image to Assets." : message);
    } finally {
      setBusy(null);
    }
  }

  function onPointerDown(
    event: React.PointerEvent<HTMLElement>,
    mode: "move" | "resize" | "rotate",
    target: "mark" | "scenery" = "mark",
    markId?: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const chosen =
      marksRef.current.find((item) => item.id === markId) ??
      marksRef.current.find((item) => item.id === selectedId) ??
      marksRef.current[0];
    if (!chosen) return;
    if (target === "mark") setSelectedId(chosen.id);
    dragRef.current = {
      mode,
      target,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      markId: chosen.id,
      mark: chosen,
      scenery: sceneryRef.current,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* A synthetic pointer has no active id. Real drags still capture. */
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const photo = photoRef.current;
    const current = sourceRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !photo || !current) return;
    const rect = photo.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const imageWidth = current.raster.width;
    const imageHeight = current.raster.height;
    const dx = (event.clientX - drag.originX) / rect.width;
    const dy = (event.clientY - drag.originY) / rect.height;
    if (drag.target === "scenery") {
      if (drag.mode === "move") {
        setScenery({
          ...drag.scenery,
          cx: clamp(drag.scenery.cx + dx, 0, 1),
          cy: clamp(drag.scenery.cy + dy, 0, 1),
        });
        return;
      }
      const nx = (event.clientX - rect.left) / rect.width;
      const ny = (event.clientY - rect.top) / rect.height;
      const reach = Math.max(Math.abs(nx - drag.scenery.cx), Math.abs(ny - drag.scenery.cy));
      setScenery({ ...drag.scenery, scale: clamp(Math.round(reach * 200), 40, 160) });
      return;
    }
    const writeMark = (next: MarkSettings) => {
      setMarks((prev) => prev.map((item) => (item.id === drag.markId ? { ...item, ...next, id: item.id } : item)));
    };
    if (drag.mode === "move") {
      writeMark({
        ...drag.mark,
        cx: clamp(drag.mark.cx + dx, 0, 1),
        cy: clamp(drag.mark.cy + dy, 0, 1),
      });
      return;
    }
    const local = localPoint(event.clientX, event.clientY, rect, drag.mark, imageWidth, imageHeight);
    if (drag.mode === "resize") {
      const halfW = Math.abs(local.lx) / imageWidth;
      const halfH = Math.abs(local.ly) / imageHeight;
      writeMark({
        ...drag.mark,
        w: clamp(halfW * 2, 0.005, 4),
        h: clamp(halfH * 2, 0.005, 4),
      });
      return;
    }
    const degrees = (Math.atan2(local.dy, local.dx) * 180) / Math.PI - 90;
    writeMark({ ...drag.mark, rotation: Math.round(normalizeDegrees(degrees)) });
  }

  function onPointerUp(event: React.PointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    const box = draftRef.current;
    if (!box) return;
    setDraft(null);
    const w = Math.abs(box.x1 - box.x0);
    const h = Math.abs(box.y1 - box.y0);
    const rect = photoRef.current?.getBoundingClientRect();
    const pixelW = rect ? w * rect.width : 0;
    const pixelH = rect ? h * rect.height : 0;
    if (pixelW < 4 && pixelH < 4) return;
    const next = createMark({
      cx: (box.x0 + box.x1) / 2,
      cy: (box.y0 + box.y1) / 2,
      w: clamp(w, 0.005, 4),
      h: clamp(h, 0.005, 4),
      rotation: 0,
    });
    setMarks((prev) => [...prev, next]);
    setSelectedId(next.id);
  }

  function onDrawDown(event: React.PointerEvent<HTMLDivElement>) {
    if (method !== "x" && method !== "sheet") return;
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    setDraft({ x0: x, y0: y, x1: x, y1: y });
    dragRef.current = null;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* A synthetic pointer has no active id. */
    }
  }

  function onDrawMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!draftRef.current) {
      onPointerMove(event);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    setDraft((prev) => (prev ? { ...prev, x1: x, y1: y } : prev));
  }

  const output = source ? outputSize(source.raster.width, source.raster.height, method) : null;
  const selectedMark = marks.find((item) => item.id === selectedId) ?? null;
  const activePreset = SCENERY_PRESETS.find((item) => item.id === presetId);

  return (
    <section className="ohf-unface" aria-label="unFace">
      <div className="ohf-unface-work">
        <div className="ohf-unface-toolbar">
          <button type="button" className="ohf-unface-quiet" onClick={() => setPickerOpen(true)}>
            <PlusIcon />
            New image
          </button>
          <span className="ohf-unface-meta">
            {source && output ? `${output.width} × ${output.height} px` : "No image yet"}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void useFile(file);
            }}
          />
        </div>

        <div
          className="ohf-unface-board"
          ref={boardRef}
          data-empty={source ? "false" : "true"}
          data-over={dragOver ? "true" : "false"}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            const file = event.dataTransfer.files[0];
            if (file) void useFile(file);
          }}
        >
          {source ? (
            <>
              <canvas
                ref={canvasRef}
                className="ohf-unface-canvas"
                style={frame ? boxStyle(frame) : { visibility: "hidden" }}
              />
              {frame && (method === "x" || method === "sheet" || method === "scenery") && (
                <div
                  className="ohf-unface-photo"
                  ref={photoRef}
                  style={{
                    left: frame.left,
                    top: frame.top + frame.header * frame.scale,
                    width: frame.width,
                    height: frame.height - frame.header * frame.scale,
                    cursor: method === "x" || method === "sheet" ? "crosshair" : undefined,
                  }}
                  onPointerDown={onDrawDown}
                  onPointerMove={onDrawMove}
                  onPointerUp={onPointerUp}
                >
                  {method === "scenery" ? (
                    <div
                      className="ohf-unface-layer"
                      style={{
                        left: `${scenery.cx * 100}%`,
                        top: `${scenery.cy * 100}%`,
                        width: `${scenery.scale}%`,
                        height: `${scenery.scale}%`,
                        transform: "translate(-50%, -50%)",
                      }}
                      onPointerDown={(event) => onPointerDown(event, "move", "scenery")}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                    >
                      {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                        <button
                          key={corner}
                          type="button"
                          className={`ohf-unface-handle ohf-unface-handle-${corner}`}
                          aria-label={`Resize scenery from the ${corner} corner`}
                          onPointerDown={(event) => onPointerDown(event, "resize", "scenery")}
                          onPointerMove={onPointerMove}
                          onPointerUp={onPointerUp}
                        />
                      ))}
                    </div>
                  ) : (
                    marks.map((item) => {
                      const chosen = item.id === selectedMark?.id;
                      return (
                        <div
                          key={item.id}
                          className="ohf-unface-mark"
                          data-selected={chosen ? "true" : "false"}
                          style={{
                            left: `${item.cx * 100}%`,
                            top: `${item.cy * 100}%`,
                            width: `${item.w * 100}%`,
                            height: `${item.h * 100}%`,
                            transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`,
                          }}
                          onPointerDown={(event) => onPointerDown(event, "move", "mark", item.id)}
                          onPointerMove={onPointerMove}
                          onPointerUp={onPointerUp}
                        >
                          {chosen &&
                            (["nw", "ne", "sw", "se"] as const).map((corner) => (
                              <button
                                key={corner}
                                type="button"
                                className={`ohf-unface-handle ohf-unface-handle-${corner}`}
                                aria-label={`Resize from the ${corner} corner`}
                                onPointerDown={(event) => onPointerDown(event, "resize", "mark", item.id)}
                                onPointerMove={onPointerMove}
                                onPointerUp={onPointerUp}
                              />
                            ))}
                          {chosen && (
                            <button
                              type="button"
                              className="ohf-unface-rotate"
                              aria-label="Rotate the X"
                              onPointerDown={(event) => onPointerDown(event, "rotate", "mark", item.id)}
                              onPointerMove={onPointerMove}
                              onPointerUp={onPointerUp}
                            />
                          )}
                        </div>
                      );
                    })
                  )}
                  {draft && (method === "x" || method === "sheet") && (
                    <div
                      className="ohf-unface-draft"
                      style={{
                        left: `${Math.min(draft.x0, draft.x1) * 100}%`,
                        top: `${Math.min(draft.y0, draft.y1) * 100}%`,
                        width: `${Math.abs(draft.x1 - draft.x0) * 100}%`,
                        height: `${Math.abs(draft.y1 - draft.y0) * 100}%`,
                      }}
                    />
                  )}
                </div>
              )}
            </>
          ) : (
            <button type="button" className="ohf-unface-empty" onClick={() => setPickerOpen(true)}>
              <PlusIcon size={16} />
              <span>Choose an uploaded image, a generated one, or add a new file.</span>
            </button>
          )}
        </div>
      </div>

      <aside className="ohf-unface-side">
        <header className="ohf-unface-intro">
          <p className="ohf-unface-kicker">unFace</p>
          <h2>Choose the method</h2>
          <p>Pick the visual treatment that best helps you move past a plain real-person portrait.</p>
        </header>

        <div className="ohf-unface-methods" role="tablist" aria-label="Overlay method">
          {METHODS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={method === item.id}
              className="ohf-unface-method"
              onClick={() => setMethod(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="ohf-unface-controls">
          {method === "grid" && (
            <>
              <p className="ohf-unface-label">Grid presets</p>
              <div className="ohf-unface-pills">
                {GRID_PRESETS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    className="ohf-unface-pill"
                    aria-pressed={grid.columns === count && grid.rows === count}
                    onClick={() => setGrid((prev) => ({ ...prev, columns: count, rows: count }))}
                  >
                    {count} × {count}
                  </button>
                ))}
              </div>
              <Slider
                label="Columns"
                min={2}
                max={16}
                value={grid.columns}
                onChange={(columns) => setGrid((prev) => ({ ...prev, columns }))}
              />
              <Slider
                label="Rows"
                min={2}
                max={16}
                value={grid.rows}
                onChange={(rows) => setGrid((prev) => ({ ...prev, rows }))}
              />
              <Slider
                label="Line width"
                min={1}
                max={40}
                value={grid.lineWidth}
                onChange={(lineWidth) => setGrid((prev) => ({ ...prev, lineWidth }))}
              />
              <Slider
                label="Opacity"
                min={0}
                max={100}
                suffix="%"
                value={grid.opacity}
                onChange={(opacity) => setGrid((prev) => ({ ...prev, opacity }))}
              />
              <p className="ohf-unface-label">Color</p>
              <div className="ohf-unface-swatches">
                {GRID_COLORS.map((swatch) => (
                  <button
                    key={swatch.id}
                    type="button"
                    className="ohf-unface-swatch"
                    style={{ background: swatch.value }}
                    aria-label={swatch.id}
                    aria-pressed={grid.color === swatch.value}
                    onClick={() => setGrid((prev) => ({ ...prev, color: swatch.value }))}
                  />
                ))}
              </div>
            </>
          )}

          {method === "scenery" && (
            <>
              <p className="ohf-unface-label">Scenery presets</p>
              <div className="ohf-unface-scenes">
                {SCENERY_PRESETS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="ohf-unface-scene"
                    aria-pressed={!customScenery && presetId === item.id}
                    onClick={() => {
                      setCustomScenery(null);
                      setPresetId(item.id);
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={withBasePath(item.src)} alt="" />
                    <span>{item.name}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="ohf-unface-upload" onClick={() => sceneryFileRef.current?.click()}>
                <UploadIcon />
                Upload custom scenery
              </button>
              <input
                ref={sceneryFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) onSceneryFile(file);
                }}
              />
              <p className="ohf-unface-active">
                Layer 2: {customScenery ? customScenery.name : activePreset?.name}
              </p>
              <p className="ohf-unface-copy">
                The portrait stays put. Drag the scenery layer to move it, or use a corner to resize it.
              </p>
              <Slider
                label="Opacity"
                min={0}
                max={100}
                suffix="%"
                value={scenery.opacity}
                onChange={(opacity) => setScenery((prev) => ({ ...prev, opacity }))}
              />
              <Slider
                label="Scale"
                min={40}
                max={160}
                suffix="%"
                value={scenery.scale}
                onChange={(scale) => setScenery((prev) => ({ ...prev, scale }))}
              />
            </>
          )}

          {(method === "x" || method === "sheet") && (
            <>
              <div className="ohf-unface-card-head">
                <h3>{method === "sheet" ? "Character reference sheet" : "X cover"}</h3>
                <button
                  type="button"
                  className="ohf-unface-quiet"
                  onClick={() => {
                    setMarks([]);
                    setSelectedId("");
                  }}
                >
                  Reset X
                </button>
              </div>
              <p className="ohf-unface-copy">
                Drag on the picture to draw a box. The X fills that box, wide or tall, as you pulled it. Drag again on empty space to add another.
              </p>
              <div className="ohf-unface-card-head">
                <button
                  type="button"
                  className="ohf-unface-quiet"
                  onClick={() => {
                    const last = marks[marks.length - 1] ?? DEFAULT_MARK;
                    const next = createMark({
                      cx: clamp(last.cx + 0.12, 0.08, 0.92),
                      cy: clamp(last.cy + 0.1, 0.08, 0.92),
                      w: last.w,
                      h: last.h,
                      rotation: last.rotation,
                    });
                    setMarks((prev) => [...prev, next]);
                    setSelectedId(next.id);
                  }}
                >
                  <PlusIcon />
                  Add X
                </button>
                <button
                  type="button"
                  className="ohf-unface-quiet"
                  disabled={!selectedMark}
                  onClick={() => {
                    if (!selectedMark) return;
                    const next = marks.filter((item) => item.id !== selectedMark.id);
                    setMarks(next);
                    setSelectedId(next[0]?.id ?? "");
                  }}
                >
                  Remove
                </button>
              </div>
              <p className="ohf-unface-note">
                {marks.length} mark{marks.length === 1 ? "" : "s"}. Place each X so it covers at least one eye.
              </p>
              {selectedMark && source && (
                <>
              <Slider
                label="X size"
                min={1}
                max={400}
                suffix="%"
                value={Math.round(clamp(markExtent(source.raster.width, source.raster.height, selectedMark), 1, 400))}
                onChange={(size) => {
                  const current = markExtent(source.raster.width, source.raster.height, selectedMark);
                  const ratio = current < 0.5 ? 1 : size / current;
                  setMarks((prev) =>
                    prev.map((item) =>
                      item.id === selectedMark.id
                        ? { ...item, w: clamp(item.w * ratio, 0.005, 4), h: clamp(item.h * ratio, 0.005, 4) }
                        : item,
                    ),
                  );
                }}
              />
              <Slider
                label="Rotation"
                min={-180}
                max={180}
                suffix=" deg"
                value={Math.round(selectedMark.rotation)}
                onChange={(rotation) =>
                  setMarks((prev) =>
                    prev.map((item) => (item.id === selectedMark.id ? { ...item, rotation } : item)),
                  )
                }
              />
                </>
              )}
            </>
          )}
        </div>

        {error && <p className="ohf-unface-error">{error}</p>}
        {notice && !error && <p className="ohf-unface-notice">{notice}</p>}

        <div className="ohf-unface-actions">
          <button type="button" className="ohf-unface-secondary" disabled={!source || busy !== null} onClick={() => void download()}>
            <DownloadIcon />
            {busy === "download" ? "Preparing…" : "Download"}
          </button>
          <button type="button" className="ohf-unface-primary" disabled={!source || busy !== null} onClick={() => void saveToAssets()}>
            {busy === "save" ? "Saving…" : "Save to Assets"}
          </button>
        </div>
      </aside>
      {pickerOpen && (
        <ImagePicker
          items={library}
          error={error}
          onClose={() => setPickerOpen(false)}
          onUpload={() => fileRef.current?.click()}
          onPick={(item) => void useLibrary(item)}
        />
      )}
    </section>
  );
}

function ImagePicker({
  items,
  error,
  onClose,
  onUpload,
  onPick,
}: {
  items: LibraryItem[];
  error: string | null;
  onClose: () => void;
  onUpload: () => void;
  onPick: (item: LibraryItem) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.showModal();
    panelRef.current?.focus();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="ohf-unface-picker-title"
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div ref={panelRef} tabIndex={-1} className="ohf-dialog-panel ohf-unface-picker">
        <div className="ohf-unface-picker-head">
          <div>
            <h2 id="ohf-unface-picker-title">Choose an image</h2>
            <p>Pick something already uploaded or generated, or add a new file.</p>
          </div>
          <button type="button" className="ohf-icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>
        <div className="ohf-unface-picker-grid">
          <button type="button" className="ohf-unface-picker-add" onClick={onUpload}>
            <PlusIcon />
            Upload
          </button>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="ohf-unface-picker-tile"
              title={item.name}
              onClick={() => onPick(item)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.url} alt={item.name} />
            </button>
          ))}
        </div>
        {items.length === 0 && <p className="ohf-unface-picker-empty">No images yet. Upload one to start.</p>}
        {error && <p className="ohf-unface-error ohf-unface-picker-error">{error}</p>}
      </div>
    </dialog>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  suffix = "",
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const id = `unface-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <label className="ohf-unface-slider" htmlFor={id}>
      <span>{label}</span>
      <span className="ohf-unface-value">
        {value}
        {suffix}
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function boxStyle(frame: PlacedFrame): CSSProperties {
  return {
    left: frame.left,
    top: frame.top,
    width: frame.width,
    height: frame.height,
  };
}

function sameFrame(prev: PlacedFrame | null, next: PlacedFrame): boolean {
  if (!prev) return false;
  return (
    Math.abs(prev.left - next.left) < 0.5 &&
    Math.abs(prev.top - next.top) < 0.5 &&
    Math.abs(prev.width - next.width) < 0.5 &&
    Math.abs(prev.height - next.height) < 0.5 &&
    prev.header === next.header
  );
}

function loadRaster(url: string, crossOrigin: boolean): Promise<Raster> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = "anonymous";
    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (!width || !height) {
        reject(new Error("empty"));
        return;
      }
      resolve({ image, width, height });
    };
    image.onerror = () => reject(new Error("load"));
    image.src = url;
  });
}

function isCrossOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

function marksForPaint(marks: XMark[], draft: { x0: number; y0: number; x1: number; y1: number } | null): XMark[] {
  if (!draft) return marks;
  const w = Math.abs(draft.x1 - draft.x0);
  const h = Math.abs(draft.y1 - draft.y0);
  if (w < 0.005 && h < 0.005) return marks;
  return [
    ...marks,
    {
      id: "draft",
      cx: (draft.x0 + draft.x1) / 2,
      cy: (draft.y0 + draft.y1) / 2,
      w,
      h,
      rotation: 0,
    },
  ];
}

function localPoint(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  mark: MarkSettings,
  imageWidth: number,
  imageHeight: number,
): { lx: number; ly: number; dx: number; dy: number } {
  const x = ((clientX - rect.left) / rect.width) * imageWidth;
  const y = ((clientY - rect.top) / rect.height) * imageHeight;
  const dx = x - mark.cx * imageWidth;
  const dy = y - mark.cy * imageHeight;
  const rad = (-mark.rotation * Math.PI) / 180;
  return {
    dx,
    dy,
    lx: dx * Math.cos(rad) - dy * Math.sin(rad),
    ly: dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

function normalizeDegrees(value: number): number {
  let next = value;
  while (next > 180) next -= 360;
  while (next < -180) next += 360;
  return next;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fileName(sourceName: string, method: UnfaceMethod): string {
  const stem = sourceName.replace(/\.[a-z0-9]+$/i, "").replace(/[^\w.-]+/g, "-").slice(0, 40) || "image";
  return `unface-${method}-${stem}.png`;
}

function localId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
