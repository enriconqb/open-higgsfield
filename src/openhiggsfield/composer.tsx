"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { openRouterCapabilities, openRouterQuote } from "@/generation/actions";
import { overlayModel, snapSettings } from "@/generation/capabilities";
import type { OpenRouterCaps } from "@/generation/capabilities";
import { parseSettings } from "@/generation/catalog";
import { estimateUsd, formatUsd } from "@/generation/estimate";
import type { OpenRouterQuote } from "@/generation/estimate";
import type { ModelEntry, Surface } from "@/generation/catalog";
import { unwrap } from "@/lib/action-result";
import type { KeyProvider } from "@/generation/credentials";
import { MAX_BATCH, useActive } from "@/generation/stores/active";
import { useImagePrompt, useVideoPrompt } from "@/generation/stores/prompt";
import { useSettings } from "@/generation/stores/settings";

import { swatchFor } from "./artwork";
import { AssetPicker } from "./asset-picker";
import { clipSeconds, editsClip } from "./clip-length";
import { PROMPT_PLACEHOLDERS, countSetting } from "./data";
import type { RunRecord } from "./history";
import { ArrowUpIcon, CaretDownIcon, CloseIcon, MinusIcon, PlusIcon, WarningIcon } from "./icons";
import { MediaStrip, useMediaTray } from "./media-tray";
import { ModelIcon, modelIconSrc } from "./model-icon";
import { ModelPicker } from "./model-picker";
import { SettingPill, SettingPopover } from "./settings";

/* Overlay ids: the two fixed panels, or one setting addressed by its catalog
   key — the rail renders whatever the model declares, so the ids cannot be a
   closed union. */
const PICKER = "picker";
const ASSETS = "assets";
const SETTING = "setting:";

const PROMPT_MAX_HEIGHT = 168;

/* What the studio itself can deliver for a model that carries no count of its
   own: one platform request per result. */
const STUDIO_COUNTS = Array.from({ length: MAX_BATCH }, (_, index) => index + 1);

/** Breathing room between a popover and the control it opened from. */
const POPOVER_GAP = 8;

/** Images copied to the clipboard (screenshot, copy image) become reference files. */
function clipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  for (const item of data.items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (!file) continue;
    if (file.name) {
      files.push(file);
      continue;
    }
    const subtype = file.type.slice("image/".length).split("+")[0] || "png";
    const ext = subtype === "jpeg" ? "jpg" : subtype;
    files.push(new File([file], `clipboard.${ext}`, { type: file.type }));
  }
  return files;
}

/** Declared widths keep an opening popover inside the composer's own column. */
function popoverWidth(id: string, model: ModelEntry): number {
  if (id === PICKER || id === ASSETS) return 560;
  /* A list of an enum's values is the narrow panel; a slider needs its travel. */
  if (id.startsWith(SETTING) && model.settings[id.slice(SETTING.length)]?.type === "enum") {
    return 216;
  }
  return 268;
}

export function Composer({
  surface,
  model,
  keyKind,
  generating,
  error,
  focusNonce,
  history,
  notice,
  selection,
  selecting,
  onError,
  onGenerate,
}: {
  surface: Surface;
  model: ModelEntry;
  keyKind: KeyProvider | null;
  generating: boolean;
  error: string | null;
  focusNonce: number;
  /* Finished runs are attachable inputs, so the asset picker reads the same
     log the gallery renders. */
  history: RunRecord[];
  /* Transient receipts from the gallery share the composer's banner strip
     rather than adding a floating layer of their own. */
  notice?: ReactNode;
  /* The bulk toolbar takes the composer's slot while runs are picked; it is
     always mounted so it can animate away, and states its own presence. */
  selection: ReactNode;
  selecting: boolean;
  onError: (message: string | null) => void;
  onGenerate: (costUsd?: number) => void;
}) {
  const setModel = useActive((state) => state.setModel);
  const batch = useActive((state) => state.batch);
  const setBatch = useActive((state) => state.setBatch);
  const imagePrompt = useImagePrompt();
  const videoPrompt = useVideoPrompt();
  const prompt = surface === "image" ? imagePrompt : videoPrompt;
  const settings = useSettings();
  const [caps, setCaps] = useState<OpenRouterCaps | null>(null);
  useEffect(() => {
    if (keyKind !== "openrouter") {
      setCaps(null);
      return;
    }
    let live = true;
    void openRouterCapabilities(model.id)
      .then(unwrap)
      .then((next) => {
        if (live) setCaps(next);
      })
      .catch(() => {
        if (live) setCaps(null);
      });
    return () => {
      live = false;
    };
  }, [keyKind, model.id]);
  const tuned = keyKind === "openrouter" ? overlayModel(model, caps) : model;
  const rawSettings = settings.byModel[model.id] ?? {};
  const snapped = snapSettings(tuned, rawSettings);
  useEffect(() => {
    if (keyKind !== "openrouter" || !caps) return;
    const next = snapSettings(overlayModel(model, caps), settings.byModel[model.id] ?? {});
    const current = settings.byModel[model.id] ?? {};
    const patch: Record<string, unknown> = {};
    for (const key of ["resolution", "aspectRatio", "duration", "quality"] as const) {
      if (next[key] !== current[key]) patch[key] = next[key];
    }
    if (Object.keys(patch).length > 0) settings.set(model.id, patch);
  }, [caps, keyKind, model, settings]);
  const values = parseSettings(tuned, snapped);
  const tray = useMediaTray(model, onError);

  /* An edit keeps the clip it is handed, so that clip's own length is the only
     sensible default for its output duration — the provider's own fallback is
     5 s, which would shorten the very clip being edited. The dial only moves
     while it still holds what this effect last put there, so a duration chosen
     by hand stays chosen. Extend is left alone on purpose: there the number
     means the added length, not the total. */
  const autoDuration = useRef<Record<string, number>>({});
  const clipUrl = tray.items.find((item) => item.role === "video")?.url ?? null;
  const durationField = tuned.settings.duration;
  const minDuration = durationField?.type === "range" ? durationField.min : null;
  const maxDuration = durationField?.type === "range" ? durationField.max : null;
  const defaultDuration = durationField?.type === "range" ? durationField.default : null;
  const storedDuration =
    typeof rawSettings.duration === "number"
      ? rawSettings.duration
      : Number.isFinite(Number(rawSettings.duration))
        ? Number(rawSettings.duration)
        : undefined;
  useEffect(() => {
    if (!editsClip(model.id) || !clipUrl) return;
    if (minDuration === null || maxDuration === null || defaultDuration === null) return;
    let live = true;
    void clipSeconds(clipUrl).then((seconds) => {
      if (!live || seconds === null) return;
      const rounded = Math.min(maxDuration, Math.max(minDuration, Math.round(seconds)));
      const auto = autoDuration.current[model.id];
      if (storedDuration !== undefined) {
        if (auto !== undefined && storedDuration !== auto) return;
        if (auto === undefined && storedDuration !== defaultDuration) return;
      }
      if (rounded === storedDuration) return;
      autoDuration.current[model.id] = rounded;
      settings.set(model.id, { duration: rounded });
    });
    return () => {
      live = false;
    };
  }, [clipUrl, defaultDuration, maxDuration, minDuration, model.id, settings, storedDuration]);

  const [overlay, setOverlay] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const [shortcut, setShortcut] = useState<string | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  /* A run in flight is not a lock: it holds its own tile in the grid, so the
     only thing that can stop a press is having nothing to say. */
  const disabled = prompt.text.trim().length === 0;

  /* One batch control, two mechanisms. A model that declares its own
     results-per-request gets that setting written; the rest are submitted once
     per result by the studio. Either way the control means "results per press",
     so the model's own count key never also appears as a settings pill. */
  const native = countSetting(model);
  const counts = native ? native.counts : STUDIO_COUNTS;
  const batchValue = native ? Number(values[native.key]) || counts[0]! : batch;
  const [quote, setQuote] = useState<OpenRouterQuote | null>(null);
  useEffect(() => {
    if (keyKind !== "openrouter") {
      setQuote(null);
      return;
    }
    let live = true;
    void openRouterQuote(model.id)
      .then(unwrap)
      .then((next) => {
        if (live) setQuote(next);
      })
      .catch(() => {
        if (live) setQuote(null);
      });
    return () => {
      live = false;
    };
  }, [keyKind, model.id]);
  const referenceCounts = tray.items.reduce(
    (counts, item) => {
      if (item.role === "video") counts.videos += 1;
      else if (item.role === "audio") counts.audios += 1;
      else counts.images += 1;
      return counts;
    },
    { images: 0, videos: 0, audios: 0 },
  );
  const estimate = quote
    ? estimateUsd(quote, {
        resolution: typeof values.resolution === "string" ? values.resolution : undefined,
        aspectRatio: typeof values.aspectRatio === "string" ? values.aspectRatio : undefined,
        duration: typeof values.duration === "number" ? values.duration : undefined,
        audio: values.generateAudio === true || values.sound === true,
        images: referenceCounts.images,
        videos: referenceCounts.videos,
        audios: referenceCounts.audios,
        batch: batchValue,
      })
    : null;
  const settingKeys = Object.keys(tuned.settings).filter((key) => key !== native?.key);

  function setBatchValue(next: number) {
    if (!native) {
      setBatch(next);
      return;
    }
    settings.set(model.id, { [native.key]: native.kind === "enum" ? String(next) : next });
  }

  /* The dock floats over the gallery, so the gallery cannot reserve its height
     from layout. It reads it from here instead, and the last row keeps clearing
     a composer that grew — a long prompt, a media strip, the undo receipt. */
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const observer = new ResizeObserver(() => {
      dock.parentElement?.style.setProperty("--ohf-dock-h", `${dock.offsetHeight}px`);
    });
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!overlay) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOverlay(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOverlay(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [overlay]);

  /* Auto-grow the prompt, including when text is set programmatically — and
     again when the column narrows, because the field shares its line with the
     attachment now and the same text rewraps onto more of them. Only a width
     change re-measures: reacting to the height we just set would loop. */
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    const grow = () => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, PROMPT_MAX_HEIGHT)}px`;
    };
    grow();
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      grow();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [prompt.text]);

  useEffect(() => {
    if (focusNonce > 0) promptRef.current?.focus();
  }, [focusNonce]);

  /* A panel anchored to a control the visitor can no longer see is a stray
     plate — the swap closes whatever the composer had open. */
  useEffect(() => {
    if (selecting) setOverlay(null);
  }, [selecting]);

  // Rendered only after mount: the modifier is the visitor's, not the server's.
  useEffect(() => {
    setShortcut(/Mac|iP(hone|ad|od)/.test(navigator.userAgent) ? "⌘↵" : "Ctrl↵");
  }, []);

  /* Popovers are positioned by the composer so the wide ones stay inside its
     column, but they open off the control that summoned them: the anchor
     travels to the trigger's left edge, clamped to the column, and rises from
     just above the trigger's own top rather than from the whole dock.
     One thing outranks the trigger: the attachments. A panel laid over the
     frames already on the plane makes the visitor choose blind, so where the
     strip is present every panel clears it. */
  function toggle(next: string, trigger: HTMLElement) {
    if (overlay === next) {
      setOverlay(null);
      return;
    }
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wrapBox = wrap.getBoundingClientRect();
    const triggerBox = trigger.getBoundingClientRect();
    const strip = wrap.querySelector(".ohf-strip");
    const ceiling = strip
      ? Math.min(triggerBox.top, strip.getBoundingClientRect().top)
      : triggerBox.top;
    const available = wrap.clientWidth;
    const width = Math.min(popoverWidth(next, tuned), available);
    setAnchor({
      x: Math.round(Math.max(0, Math.min(triggerBox.left - wrapBox.left, available - width))),
      y: Math.round(wrapBox.bottom - ceiling + POPOVER_GAP),
    });
    setOverlay(next);
  }

  const attachLabel = tray.allFull ? "Change the inputs" : "Add an input";
  const settingKey = overlay?.startsWith(SETTING) ? overlay.slice(SETTING.length) : null;
  const generateLabel = batchValue > 1 ? `Generate ${batchValue} results` : "Generate";
  const generateTip = disabled ? "Write a prompt first" : `${generateLabel} · ${shortcut ?? "⌘↵"}`;

  return (
    <div className="ohf-dock" ref={dockRef} data-selecting={selecting}>
      <div
        className="ohf-composer-wrap ohf-enter-2"
        ref={wrapRef}
        style={
          {
            "--ohf-pop-x": `${anchor.x}px`,
            "--ohf-pop-y": `${anchor.y}px`,
          } as CSSProperties
        }
      >
        {notice}

        {error && (
          <div className="ohf-alert" role="alert">
            <span className="ohf-alert-ic">
              <WarningIcon />
            </span>
            <span className="ohf-alert-text">{error}</span>
            <button
              type="button"
              className="ohf-icon-btn ohf-icon-btn--ghost"
              aria-label="Dismiss error"
              title="Dismiss error"
              onClick={() => onError(null)}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        )}

        {settingKey && <SettingPopover model={tuned} settingKey={settingKey} values={values} />}
        {overlay === ASSETS && (
          <AssetPicker
            model={model}
            items={tray.items}
            uploads={tray.uploads}
            history={history}
            staged={tray.staged}
            uploading={tray.uploading}
            onUpload={tray.begin}
            onApply={tray.apply}
            onForget={tray.forgetUpload}
            onRestore={tray.restoreUpload}
            onClose={() => setOverlay(null)}
          />
        )}
        {overlay === PICKER && (
          <ModelPicker
            selectedId={model.id}
            surface={surface}
            keyKind={keyKind}
            onPick={(next) => {
              setModel(next.id);
              setOverlay(null);
            }}
            onClose={() => setOverlay(null)}
          />
        )}

        {/* One slot, two instruments. Both are laid on the same cell and
            aligned to the same bottom edge, so the dock never changes height
            and the toolbar rises exactly where the composer's rail was. */}
        <div className="ohf-swap">
            <div
              className="ohf-composer"
              data-dropping={dropping || undefined}
              onDragEnter={(event) => {
                if (!event.dataTransfer.types.includes("Files")) return;
                event.preventDefault();
                setDropping(true);
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes("Files")) return;
                event.preventDefault();
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                setDropping(false);
              }}
              onDrop={(event) => {
                if (!event.dataTransfer.types.includes("Files")) return;
                event.preventDefault();
                setDropping(false);
                void tray.receive([...event.dataTransfer.files]);
              }}
              onPaste={(event) => {
                const files = clipboardImageFiles(event.clipboardData);
                if (files.length === 0) return;
                event.preventDefault();
                void tray.receive(files);
              }}
            >
            <MediaStrip model={model} />

            {/* The attachment sits beside the words it belongs to, on the same
                left rail the control row starts from. */}
            <div className="ohf-composer-head">
              {tray.roles.length > 0 && (
                <>
                  {tray.input}
                  <button
                    type="button"
                    className="ohf-attach ohf-tip ohf-tip--start"
                    data-tip={attachLabel}
                    disabled={tray.allFull}
                    aria-label={tray.uploading ? "Uploading" : attachLabel}
                    aria-expanded={overlay === ASSETS}
                    aria-haspopup="dialog"
                    onClick={(event) => toggle(ASSETS, event.currentTarget)}
                  >
                    {tray.uploading ? (
                      <span className="ohf-spinner" aria-hidden />
                    ) : (
                      <PlusIcon size={16} />
                    )}
                  </button>
                </>
              )}

              {/* The prompt lives inside the wrap the outside-pointer rule
                  guards, so it has to dismiss for itself: reaching for the words
                  puts the open control away. Pointer and focus both, because a
                  button click does not move focus on every platform — the field
                  can still hold it while a popover stands open. */}
              <textarea
                ref={promptRef}
                className="ohf-prompt"
                rows={1}
                value={prompt.text}
                placeholder={PROMPT_PLACEHOLDERS[surface]}
                aria-label="Prompt"
                onPointerDown={() => setOverlay(null)}
                onFocus={() => setOverlay(null)}
                onChange={(event) => prompt.setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    if (!disabled) onGenerate(estimate ?? undefined);
                  }
                }}
              />
            </div>

            <div className="ohf-composer-row">
              <div className="ohf-controls">
                <button
                  type="button"
                  className="ohf-ctl ohf-ctl--model ohf-tip"
                  data-tip="Change model"
                  aria-expanded={overlay === PICKER}
                  aria-haspopup="dialog"
                  onClick={(event) => toggle(PICKER, event.currentTarget)}
                >
                  {modelIconSrc(model.id) ? (
                    <ModelIcon modelId={model.id} />
                  ) : (
                    <span className="ohf-model-swatch" style={{ background: swatchFor(surface, model.id) }} />
                  )}
                  <span className="ohf-ctl-name">{model.label}</span>
                  <span className="ohf-caret">
                    <CaretDownIcon />
                  </span>
                </button>

                {settingKeys.map((key) => (
                  <SettingPill
                    key={key}
                    model={tuned}
                    settingKey={key}
                    values={values}
                    open={overlay === `${SETTING}${key}`}
                    onOpen={(trigger) => toggle(`${SETTING}${key}`, trigger)}
                  />
                ))}

                <BatchStepper value={batchValue} counts={counts} onChange={setBatchValue} />
              </div>

              <span className="ohf-generate-slot ohf-tip ohf-tip--end" data-tip={generateTip}>
                <button
                  type="button"
                  className="ohf-generate"
                  disabled={disabled}
                  data-busy={generating}
                  aria-label={generateLabel}
                  onClick={() => onGenerate(estimate ?? undefined)}
                >
                  {/* The sheen is the only thing a run in flight changes here:
                      the label still names what pressing does, because pressing
                      is still allowed. Progress is the grid's to report. */}
                  {generating && <span className="ohf-generate-sheen" aria-hidden />}
                  <span className="ohf-generate-glyph" aria-hidden>
                    <ArrowUpIcon size={15} />
                  </span>
                  <span className="ohf-generate-label">
                    Generate{estimate !== null ? ` ${formatUsd(estimate)}` : ""}
                  </span>
                  {shortcut && <kbd className="ohf-kbd">{shortcut}</kbd>}
                </button>
              </span>
            </div>
          </div>

          {selection}
        </div>
      </div>
    </div>
  );
}

/* Results per press. Every unit is a real generation, so the number is a
   spinbutton the keyboard can drive rather than two anonymous arrows, and the
   ceiling stays in view beside it. The arrows walk the counts the model
   actually allows — Soul offers 1 or 4, and there is no 2 to land on. */
function BatchStepper({
  value,
  counts,
  onChange,
}: {
  value: number;
  counts: number[];
  onChange: (next: number) => void;
}) {
  const index = Math.max(0, counts.indexOf(value));
  const last = counts.length - 1;
  const max = counts[last]!;
  const label = `Batch size — ${value} result${value > 1 ? "s" : ""} per press`;

  const step = (delta: number) => {
    const next = counts[Math.min(last, Math.max(0, index + delta))]!;
    if (next !== value) onChange(next);
  };

  return (
    <div className="ohf-batch ohf-tip" data-tip={label}>
      <button
        type="button"
        className="ohf-batch-step"
        aria-label="Fewer results"
        disabled={index <= 0}
        onClick={() => step(-1)}
      >
        <MinusIcon size={12} />
      </button>
      <span
        className="ohf-batch-value"
        role="spinbutton"
        tabIndex={0}
        aria-label="Batch size"
        aria-valuemin={counts[0]}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value} of ${max}`}
        onKeyDown={(event) => {
          const delta =
            event.key === "ArrowUp" || event.key === "ArrowRight"
              ? 1
              : event.key === "ArrowDown" || event.key === "ArrowLeft"
                ? -1
                : 0;
          if (delta !== 0) {
            event.preventDefault();
            step(delta);
            return;
          }
          if (event.key === "Home") {
            event.preventDefault();
            onChange(counts[0]!);
          }
          if (event.key === "End") {
            event.preventDefault();
            onChange(max);
          }
        }}
      >
        {value}
        <span className="ohf-batch-max" aria-hidden>
          /{max}
        </span>
      </span>
      <button
        type="button"
        className="ohf-batch-step"
        aria-label="More results"
        disabled={index >= last}
        onClick={() => step(1)}
      >
        <PlusIcon size={12} />
      </button>
    </div>
  );
}
