"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { getAuthState } from "@/auth/actions";
import { unwrap } from "@/lib/action-result";
import { deletePromptTemplate, listPromptTemplates, savePromptTemplate, type PromptTemplate } from "@/prompts/actions";

import { CloseIcon } from "./icons";

type Scope = "mine" | "global";

export function TemplatesPanel({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [templates, setTemplates] = useState<PromptTemplate[] | null>(null);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<Scope>("mine");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const state = unwrap(await getAuthState());
        if (!live) return;
        if (!state.user) {
          onClose();
          return;
        }
        setIsSuperadmin(state.user.role === "superadmin");
        const list = unwrap(await listPromptTemplates());
        if (live) setTemplates(list);
      } catch (caught) {
        if (live) setError(caught instanceof Error ? caught.message : "Could not load templates");
      }
    })();
    return () => {
      live = false;
    };
  }, [onClose]);

  function resetForm() {
    setTitle("");
    setBody("");
    setScope("mine");
    setEditingId(null);
  }

  function edit(template: PromptTemplate) {
    setEditingId(template.id);
    setTitle(template.title);
    setBody(template.body);
    setScope(template.scope === "global" ? "global" : "mine");
    setError(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const list = unwrap(
        await savePromptTemplate({
          id: editingId ?? undefined,
          title,
          body,
          scope: isSuperadmin ? scope : "mine",
        }),
      );
      setTemplates(list);
      resetForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save template");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!window.confirm("Delete this prompt template?")) return;
    setBusy(true);
    setError(null);
    try {
      const list = unwrap(await deletePromptTemplate({ id }));
      setTemplates(list);
      if (editingId === id) resetForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete template");
    } finally {
      setBusy(false);
    }
  }

  const presets = (templates ?? []).filter((template) => template.scope === "global");
  const mine = (templates ?? []).filter((template) => template.scope === "mine");

  return (
    <dialog
      ref={ref}
      aria-labelledby="ohf-templates-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="ohf-dialog-panel ohf-manage-panel">
        <div className="ohf-keys-head">
          <div>
            <div id="ohf-templates-title" className="ohf-keys-title">
              Prompt templates
            </div>
            <p className="ohf-keys-copy">
        {isSuperadmin
          ? "Mine is only for your account. Presets are shared with every user and stay read-only for them."
          : "Templates you save here are only for your account. Shared presets are read-only."}
            </p>
          </div>
          <button type="button" className="ohf-icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>
        <div className="ohf-manage-body ohf-scroll">
          {!templates && !error && <p className="ohf-keys-copy">Loading templates…</p>}
      {templates && <form className="ohf-admin-create ohf-template-form" onSubmit={(event) => void save(event)}>
        <label className="ohf-field">
          <div className="ohf-field-label">Title</div>
          <input className="ohf-input" value={title} required maxLength={120} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="ohf-field">
          <div className="ohf-field-label">Prompt</div>
          <textarea className="ohf-input ohf-template-body" value={body} required maxLength={8000} onChange={(event) => setBody(event.target.value)} />
        </label>
        {isSuperadmin && (
          <label className="ohf-field">
            <div className="ohf-field-label">Save as</div>
            <select
              className="ohf-input"
              value={scope}
              disabled={editingId !== null}
              onChange={(event) => setScope(event.target.value === "global" ? "global" : "mine")}
            >
              <option value="mine">Mine</option>
              <option value="global">Preset</option>
            </select>
          </label>
        )}
        <div className="ohf-admin-actions">
          <button type="submit" className="ohf-keys-save" disabled={busy}>
            {busy ? "Saving…" : editingId ? "Update template" : "Save template"}
          </button>
          {editingId !== null && (
            <button type="button" className="ohf-btn-quiet" disabled={busy} onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>}
      {error && (
        <div className="ohf-alert" role="alert">
          <span className="ohf-alert-text">{error}</span>
        </div>
      )}
      {templates && <TemplateList title="Presets" templates={presets} busy={busy} onEdit={edit} onDelete={remove} />}
      {templates && <TemplateList title="Mine" templates={mine} busy={busy} onEdit={edit} onDelete={remove} />}
        </div>
      </div>
    </dialog>
  );
}

function TemplateList({
  title,
  templates,
  busy,
  onEdit,
  onDelete,
}: {
  title: string;
  templates: PromptTemplate[];
  busy: boolean;
  onEdit: (template: PromptTemplate) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <section className="ohf-admin-block">
      <h2 className="ohf-admin-block-title">{title}</h2>
      {templates.length === 0 ? (
        <p className="ohf-keys-copy">None yet.</p>
      ) : (
        <div className="ohf-admin-table-wrap">
          <table className="ohf-admin-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Prompt</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id}>
                  <td>{template.title}</td>
                  <td className="ohf-template-preview">{template.body}</td>
                  <td className="ohf-admin-actions">
                    {template.editable ? (
                      <>
                        <button type="button" className="ohf-btn-quiet" disabled={busy} onClick={() => onEdit(template)}>
                          Edit
                        </button>
                        <button type="button" className="ohf-btn-quiet" disabled={busy} onClick={() => onDelete(template.id)}>
                          Delete
                        </button>
                      </>
                    ) : (
                      <span className="ohf-keys-copy">Read only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
