"use client";

import { useEffect, useRef, useState } from "react";

import { unwrap } from "@/lib/action-result";
import { listPromptTemplates, type PromptTemplate } from "@/prompts/actions";

export function PromptTemplatesButton({ onApply }: { onApply: (body: string) => void }) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<PromptTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void listPromptTemplates()
      .then(unwrap)
      .then((list) => {
        if (live) {
          setTemplates(list);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!live) return;
        setTemplates([]);
        setError(caught instanceof Error ? caught.message : "Could not load templates");
      });
    return () => {
      live = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const presets = (templates ?? []).filter((template) => template.scope === "global");
  const mine = (templates ?? []).filter((template) => template.scope === "mine");

  return (
    <div className="ohf-template-anchor" ref={rootRef}>
      <button
        type="button"
        className="ohf-ctl ohf-template-open"
        aria-expanded={open}
        aria-haspopup="listbox"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setOpen((value) => !value)}
      >
        Templates
      </button>
      {open && (
        <div className="ohf-template-menu" role="listbox" aria-label="Prompt templates">
          {error && <p className="ohf-template-empty">{error}</p>}
          {!error && templates === null && <p className="ohf-template-empty">Loading…</p>}
          {!error && templates !== null && templates.length === 0 && (
            <p className="ohf-template-empty">No templates yet.</p>
          )}
          <TemplateGroup title="Presets" templates={presets} onApply={onApply} onDone={() => setOpen(false)} />
          <TemplateGroup title="Mine" templates={mine} onApply={onApply} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function TemplateGroup({
  title,
  templates,
  onApply,
  onDone,
}: {
  title: string;
  templates: PromptTemplate[];
  onApply: (body: string) => void;
  onDone: () => void;
}) {
  if (templates.length === 0) return null;
  return (
    <div className="ohf-template-group">
      <p className="ohf-template-group-title">{title}</p>
      {templates.map((template) => (
        <button
          key={template.id}
          type="button"
          className="ohf-template-item"
          role="option"
          onClick={() => {
            onApply(template.body);
            onDone();
          }}
        >
          <strong>{template.title}</strong>
          <span>{template.body}</span>
        </button>
      ))}
    </div>
  );
}
