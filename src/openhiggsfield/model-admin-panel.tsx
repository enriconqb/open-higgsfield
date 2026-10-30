"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getAuthState } from "@/auth/actions";
import { adminListModels, adminSetModelMark, type ManagedModel } from "@/models/actions";
import { MODEL_MARKS, MODEL_MARK_LABELS, type ModelMark } from "@/models/marks";
import { unwrap } from "@/lib/action-result";

export function ModelAdminPanel() {
  const router = useRouter();
  const [models, setModels] = useState<ManagedModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const state = unwrap(await getAuthState());
        if (!live) return;
        if (!state.user || state.user.role !== "superadmin") {
          router.replace("/login");
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
  }, [router]);

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

  if (!models && !error) {
    return <p className="ohf-keys-copy">Loading models…</p>;
  }

  const groups = [
    { surface: "image" as const, title: "Image" },
    { surface: "video" as const, title: "Video" },
  ];

  return (
    <div className="ohf-admin">
      <p className="ohf-keys-copy">
        Mark a model so it sorts to the top of the picker. One status per model. Clear the status to
        return it to the catalog order.
      </p>
      {error && (
        <div className="ohf-alert" role="alert">
          <span className="ohf-alert-text">{error}</span>
        </div>
      )}
      {groups.map((group) => {
        const rows = (models ?? []).filter((model) => model.surface === group.surface);
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
      <p className="ohf-auth-foot">
        <Link href="/">Back to studio</Link>
      </p>
    </div>
  );
}
