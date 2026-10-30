"use client";

import { useEffect, useRef, useState } from "react";

import { getAuthState } from "@/auth/actions";
import { unwrap } from "@/lib/action-result";
import { adminListModels, adminSetModelMark, type ManagedModel } from "@/models/actions";
import { MODEL_MARKS, MODEL_MARK_LABELS, type ModelMark } from "@/models/marks";

import { CloseIcon } from "./icons";

export function ModelAdminPanel({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [models, setModels] = useState<ManagedModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const state = unwrap(await getAuthState());
        if (!live) return;
        if (!state.user || state.user.role !== "superadmin") {
          onClose();
          return;
        }
        const list = unwrap(await adminListModels());
        if (live) setModels(list);
      } catch (caught) {
        if (live) setError(caught instanceof Error ? caught.message : "Could not load models");
      }
    })();
    return () => {
      live = false;
    };
  }, [onClose]);

  async function setStatus(modelId: string, status: ModelMark | null) {
    setBusyId(modelId);
    setError(null);
    try {
      const list = unwrap(await adminSetModelMark({ modelId, status }));
      setModels(list);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  const query = search.trim().toLowerCase();
  const visible = (models ?? []).filter(
    (model) => !query || `${model.label} ${model.id}`.toLowerCase().includes(query),
  );
  const groups = [
    { surface: "image" as const, title: "Image" },
    { surface: "video" as const, title: "Video" },
  ];

  return (
    <dialog
      ref={ref}
      aria-labelledby="ohf-models-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="ohf-dialog-panel ohf-manage-panel">
        <div className="ohf-keys-head">
          <div>
            <div id="ohf-models-title" className="ohf-keys-title">
              Model management
            </div>
            <p className="ohf-keys-copy">
              Mark a model so it sorts to the top of the picker. One status per model.
            </p>
          </div>
          <button type="button" className="ohf-icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>
        <div className="ohf-manage-body ohf-scroll">
          <label className="ohf-field">
            <div className="ohf-field-label">Search</div>
            <input
              className="ohf-input"
              value={search}
              placeholder="Name or model id"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {!models && !error && <p className="ohf-keys-copy">Loading models…</p>}
          {error && (
            <div className="ohf-alert" role="alert">
              <span className="ohf-alert-text">{error}</span>
            </div>
          )}
          {models && visible.length === 0 && <p className="ohf-keys-copy">No model matches.</p>}
          {groups.map((group) => {
            const rows = visible.filter((model) => model.surface === group.surface);
            if (rows.length === 0) return null;
            return (
              <section key={group.surface} className="ohf-admin-block">
                <h2 className="ohf-admin-block-title">{group.title}</h2>
                <div className="ohf-admin-table-wrap">
                  <table className="ohf-admin-table">
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((model) => (
                        <tr key={model.id}>
                          <td>
                            <div>{model.label}</div>
                            <div className="ohf-keys-copy">{model.id}</div>
                          </td>
                          <td>
                            <select
                              className="ohf-input"
                              value={model.status ?? ""}
                              disabled={busyId === model.id}
                              aria-label={`Status for ${model.label}`}
                              onChange={(event) => {
                                const value = event.target.value;
                                void setStatus(model.id, value === "" ? null : (value as ModelMark));
                              }}
                            >
                              <option value="">None</option>
                              {MODEL_MARKS.map((status) => (
                                <option key={status} value={status}>
                                  {MODEL_MARK_LABELS[status]}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </dialog>
  );
}
