"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { loadUsageDashboard, type UsageDashboard, type UsageFilters, type UsageRow } from "@/usage/dashboard";

const EMPTY: UsageFilters = {
  from: "",
  to: "",
  modelId: "",
  kind: "",
  status: "",
  requestId: "",
  username: "",
};

export function UsagePanel() {
  const router = useRouter();
  const [data, setData] = useState<UsageDashboard | null>(null);
  const [draft, setDraft] = useState<UsageFilters>(EMPTY);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load(filters?: UsageFilters) {
    setLoading(true);
    setError("");
    try {
      const next = await loadUsageDashboard(filters);
      setData(next);
      setDraft(next.filters);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not load usage";
      if (message === "Login required" || message === "Forbidden") {
        router.replace("/login");
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function exportCsv() {
    if (!data) return;
    const headers = [
      "Time",
      ...(data.isSuperadmin ? ["User"] : []),
      "Model",
      "Type",
      "Spec",
      "Credits",
      "USD",
      "Status",
      "Request ID",
    ];
    const body = data.rows.map((row) => [
      formatTime(row.createdAt),
      ...(data.isSuperadmin ? [row.username] : []),
      row.modelId,
      row.kind,
      row.spec,
      String(row.credits),
      row.costUsd == null ? "" : row.costUsd.toFixed(4),
      row.status,
      row.requestId,
    ]);
    const lines = [headers, ...body].map((cells) => cells.map(csvCell).join(","));
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `usage-${data.filters.from}-${data.filters.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const maxCredits = Math.max(1, ...(data?.days.map((day) => day.credits) ?? [1]));

  return (
    <div className="ohf-usage">
      <p className="ohf-usage-lead">
        {data?.isSuperadmin
          ? "Credits and generation logs for every account. 1 credit = $0.01."
          : "Credits and generation logs for your account. 1 credit = $0.01."}
      </p>
      <form
        className="ohf-usage-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void load(draft);
        }}
      >
        <label>
          From
          <input type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
        </label>
        <label>
          To
          <input type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
        </label>
        {data?.isSuperadmin && (
          <label>
            User
            <select value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })}>
              <option value="">All users</option>
              {data.usernames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Model
          <select value={draft.modelId} onChange={(event) => setDraft({ ...draft, modelId: event.target.value })}>
            <option value="">All models</option>
            {(data?.models ?? []).map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select
            value={draft.kind}
            onChange={(event) => setDraft({ ...draft, kind: event.target.value as UsageFilters["kind"] })}
          >
            <option value="">All</option>
            <option value="image">Image</option>
            <option value="video">Video</option>
          </select>
        </label>
        <label>
          Status
          <select
            value={draft.status}
            onChange={(event) => setDraft({ ...draft, status: event.target.value as UsageFilters["status"] })}
          >
            <option value="">All</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
          </select>
        </label>
        <label>
          Request
          <input
            value={draft.requestId}
            placeholder="Request id"
            onChange={(event) => setDraft({ ...draft, requestId: event.target.value })}
          />
        </label>
        <button type="submit" className="ohf-auth-submit" disabled={loading}>
          {loading ? "Loading" : "Apply"}
        </button>
        <button type="button" className="ohf-auth-submit" onClick={exportCsv} disabled={!data?.rows.length}>
          Export CSV
        </button>
      </form>
      {error && (
        <div className="ohf-alert" role="alert">
          {error}
        </div>
      )}
      {data && (
        <>
          <div className="ohf-usage-kpis">
            <Kpi label="Credits used" value={formatCount(data.kpis.credits)} />
            <Kpi label="Generations" value={formatCount(data.kpis.generations)} />
            <Kpi label="Success" value={formatCount(data.kpis.success)} />
            <Kpi label="Failed" value={formatCount(data.kpis.failed)} />
            {data.isSuperadmin && <Kpi label="Active users" value={formatCount(data.kpis.activeUsers)} />}
          </div>
          <section className="ohf-usage-split">
            <div>
              <h2>Credits per day</h2>
              {data.days.length === 0 ? (
                <p className="ohf-usage-empty">No usage in this range.</p>
              ) : (
                <div className="ohf-usage-bars" aria-label="Credits per day">
                  {data.days.map((day) => (
                    <div key={day.day} className="ohf-usage-bar" title={`${day.day}: ${day.credits}`}>
                      <span style={{ height: `${Math.max(4, (day.credits / maxCredits) * 100)}%` }} />
                      <em>{day.day.slice(5)}</em>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {data.isSuperadmin && (
              <div>
                <h2>Top users</h2>
                {data.topUsers.length === 0 ? (
                  <p className="ohf-usage-empty">No users in this range.</p>
                ) : (
                  <ol className="ohf-usage-top">
                    {data.topUsers.map((user) => (
                      <li key={user.username}>
                        <strong>{user.username}</strong>
                        <span>
                          {formatCount(user.credits)} cr · {formatCount(user.generations)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </section>
          <div className="ohf-admin-table-wrap">
            <table className="ohf-admin-table">
              <thead>
                <tr>
                  <th>Time</th>
                  {data.isSuperadmin && <th>User</th>}
                  <th>Model</th>
                  <th>Type</th>
                  <th>Spec</th>
                  <th>Credits</th>
                  <th>Status</th>
                  <th>Request</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={data.isSuperadmin ? 8 : 7}>No generations in this range.</td>
                  </tr>
                ) : (
                  data.rows.map((row) => <LogRow key={row.requestId} row={row} showUser={data.isSuperadmin} />)
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="ohf-usage-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LogRow({ row, showUser }: { row: UsageRow; showUser: boolean }) {
  return (
    <tr>
      <td>{formatTime(row.createdAt)}</td>
      {showUser && <td>{row.username}</td>}
      <td>{row.modelId}</td>
      <td>{row.kind}</td>
      <td>{row.spec || "—"}</td>
      <td>{formatCount(row.credits)}</td>
      <td>
        <span className="ohf-admin-status" data-status={row.status === "success" ? "active" : row.status === "failed" ? "disabled" : "pending"}>
          {row.status}
        </span>
      </td>
      <td>{row.requestId}</td>
    </tr>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("id-ID").format(value);
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
