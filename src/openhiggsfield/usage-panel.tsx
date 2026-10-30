"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { loadUsageDashboard, type UsageDashboard, type UsageFilters, type UsageRow } from "@/usage/dashboard";
import { unwrap } from "@/lib/action-result";

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
      const next = unwrap(await loadUsageDashboard(filters));
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
      formatUsageUsd(rowUsd(row)),
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

  const maxUsd = Math.max(0, ...(data?.days.map((day) => day.usd) ?? [0])) || 1;
  const generations = data?.kpis.generations ?? 0;
  const successRate = generations === 0 ? 0 : (data!.kpis.success / generations) * 100;
  const failRate = generations === 0 ? 0 : (data!.kpis.failed / generations) * 100;
  const dayUsd = data?.days.reduce((sum, day) => sum + day.usd, 0) ?? 0;
  const columns = data?.isSuperadmin ? 8 : 7;

  return (
    <div className="ohf-usage">
      <header className="ohf-usage-head">
        <div>
          <Link href="/" className="ohf-usage-back">
            Back to studio
          </Link>
          <p className="ohf-usage-eyebrow">Account</p>
          <h1>Usage</h1>
          <p className="ohf-usage-lead">
            {data?.isSuperadmin
              ? "Spend and generation logs for every account, shown in USD."
              : "Spend and generation logs for your account, shown in USD."}
          </p>
        </div>
        <div className="ohf-usage-actions">
          <button type="button" className="ohf-usage-ghost" onClick={exportCsv} disabled={!data?.rows.length}>
            Export CSV
          </button>
          <button type="submit" form="usage-filters" className="ohf-usage-apply" disabled={loading}>
            {loading ? "Loading" : "Apply"}
          </button>
        </div>
      </header>

      <form
        id="usage-filters"
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
        <label className="ohf-usage-search">
          Request
          <input
            value={draft.requestId}
            placeholder="Request id"
            onChange={(event) => setDraft({ ...draft, requestId: event.target.value })}
          />
        </label>
      </form>

      {error && (
        <div className="ohf-alert" role="alert">
          {error}
        </div>
      )}

      {data && (
        <>
          <section className="ohf-usage-kpis" aria-label="Usage summary">
            <Kpi label="Spent" value={formatUsageUsd(data.kpis.usd)} note="In this range" tone="gold" />
            <Kpi label="Generations" value={formatCount(data.kpis.generations)} note="In this range" />
            <Kpi
              label="Success"
              value={formatCount(data.kpis.success)}
              note={generations ? `${successRate.toFixed(1)}% pass rate` : "No generations"}
              tone="ok"
            />
            <Kpi
              label="Failed"
              value={formatCount(data.kpis.failed)}
              note={generations ? `${failRate.toFixed(1)}% fail rate` : "No generations"}
              tone="bad"
            />
            {data.isSuperadmin && (
              <Kpi label="Active users" value={formatCount(data.kpis.activeUsers)} note="In this range" />
            )}
          </section>

          <section className={`ohf-usage-split${data.isSuperadmin ? "" : " is-solo"}`}>
            <article className="ohf-usage-card">
              <div className="ohf-usage-card-head">
                <div>
                  <h2>Spend per day</h2>
                  <p>Successful spend across the selected dates.</p>
                </div>
              </div>
              {data.days.length === 0 ? (
                <p className="ohf-usage-empty">No usage in this range.</p>
              ) : (
                <div className="ohf-usage-bars" aria-label="Spend per day">
                  {data.days.map((day) => (
                    <div key={day.day} className="ohf-usage-bar" title={`${day.day}: ${formatUsageUsd(day.usd)}`}>
                      <span style={{ height: `${Math.max(4, (day.usd / maxUsd) * 100)}%` }} />
                      <em>{day.day.slice(8)}</em>
                    </div>
                  ))}
                </div>
              )}
              <p className="ohf-usage-footnote">Daily total {formatUsageUsd(dayUsd)}</p>
            </article>
            {data.isSuperadmin && (
              <article className="ohf-usage-card">
                <div className="ohf-usage-card-head">
                  <div>
                    <h2>Top users</h2>
                    <p>Ranked by spend in this range.</p>
                  </div>
                </div>
                {data.topUsers.length === 0 ? (
                  <p className="ohf-usage-empty">No users in this range.</p>
                ) : (
                  <ol className="ohf-usage-top">
                    {data.topUsers.map((user, index) => (
                      <li key={user.username}>
                        <span className="ohf-usage-rank">{index + 1}</span>
                        <strong>{user.username}</strong>
                        <span>
                          {formatUsageUsd(user.usd)} · {formatCount(user.generations)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </article>
            )}
          </section>

          <section className="ohf-usage-card ohf-usage-ledger">
            <div className="ohf-usage-card-head">
              <div>
                <h2>Generation log</h2>
                <p>
                  Showing {formatCount(data.rows.length)}
                  {data.rows.length === 500 ? " of the latest 500" : ""} events
                </p>
              </div>
            </div>
            <div className="ohf-usage-table-wrap">
              <table className="ohf-usage-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    {data.isSuperadmin && <th>User</th>}
                    <th>Model</th>
                    <th>Type</th>
                    <th>Spec</th>
                    <th>USD</th>
                    <th>Status</th>
                    <th>Request</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 ? (
                    <tr>
                      <td colSpan={columns}>No generations in this range.</td>
                    </tr>
                  ) : (
                    data.rows.map((row) => <LogRow key={`${row.requestId}-${row.createdAt}`} row={row} showUser={data.isSuperadmin} />)
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "gold" | "ok" | "bad";
}) {
  return (
    <article className="ohf-usage-kpi" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{note}</em>
    </article>
  );
}

function LogRow({ row, showUser }: { row: UsageRow; showUser: boolean }) {
  return (
    <tr>
      <td className="ohf-usage-mono">{formatTime(row.createdAt)}</td>
      {showUser && <td>{row.username}</td>}
      <td>{row.modelId}</td>
      <td className="ohf-usage-kind">{row.kind}</td>
      <td>{row.spec || "—"}</td>
      <td className="ohf-usage-mono">{formatUsageUsd(rowUsd(row))}</td>
      <td>
        <span className="ohf-usage-status" data-status={row.status}>
          {row.status}
        </span>
      </td>
      <td className="ohf-usage-mono ohf-usage-request" title={row.requestId}>
        {row.requestId}
      </td>
    </tr>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("id-ID").format(value);
}

function rowUsd(row: UsageRow): number {
  return row.costUsd != null ? row.costUsd : row.credits * 0.01;
}

function formatUsageUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return "$0.00";
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= 0.01) return `${sign}$${abs.toFixed(2)}`;
  return `${sign}$${plainUsd(abs)}`;
}

function plainUsd(amount: number): string {
  const precise = amount.toPrecision(12);
  const trimmed = (value: string) => value.replace(/0+$/, "").replace(/\.$/, "");
  if (!/[eE]/.test(precise)) return trimmed(precise);
  const [coeff, expRaw] = precise.toLowerCase().split("e");
  const exp = Number(expRaw);
  const digits = coeff.replace(".", "");
  const dot = coeff.indexOf(".");
  const point = (dot < 0 ? digits.length : dot) + exp;
  if (point <= 0) return trimmed(`0.${"0".repeat(-point)}${digits}`);
  if (point >= digits.length) return trimmed(digits + "0".repeat(point - digits.length));
  return trimmed(`${digits.slice(0, point)}.${digits.slice(point)}`);
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
