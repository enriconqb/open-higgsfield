"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  createApiTokenAction,
  deleteApiTokenAction,
  getAuthState,
  getPublicApiInfo,
  listApiTokensAction,
  revokeApiTokenAction,
} from "@/auth/actions";
import { configuredBasePath } from "@/base-path";
import { unwrap } from "@/lib/action-result";

import { CloseIcon } from "./icons";

type TokenView = {
  id: number;
  label: string;
  teamId: number | null;
  hint: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  expired: boolean;
  active: boolean;
};

const EXPIRY_OPTIONS = [
  { value: "0", label: "Never expires" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
];

function when(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function ApiTokensPanel({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tokens, setTokens] = useState<TokenView[]>([]);
  const [loading, setLoading] = useState(true);
  const [workspaceName, setWorkspaceName] = useState("Personal");
  const [teams, setTeams] = useState<{ id: number; name: string }[]>([]);
  const [signedIn, setSignedIn] = useState(true);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [apiBase, setApiBase] = useState("");
  const [models, setModels] = useState<{ image: string; video: string } | null>(null);
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState("0");
  const [canGenerate, setCanGenerate] = useState(true);
  const [canRead, setCanRead] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [existingOpen, setExistingOpen] = useState(false);
  const generateRef = useRef<HTMLDialogElement>(null);
  const existingRef = useRef<HTMLDialogElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [info, state] = await Promise.all([
        getPublicApiInfo().then(unwrap),
        getAuthState().then(unwrap),
      ]);
      setApiBase(info.apiBase);
      setModels(info.models);
      setSignedIn(state.user !== null);
      if (!state.user) {
        setTokens([]);
        return;
      }
      const list = unwrap(await listApiTokensAction());
      setHasApiKey(state.hasApiKey);
      const named = state.teams.find((team) => team.id === state.activeTeamId);
      setTeams(state.teams);
      setWorkspaceName(named?.name ?? "Personal");
      setTokens(list as TokenView[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load tokens");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const dialog = generateRef.current;
    if (!dialog) return;
    if (generateOpen && !dialog.open) dialog.showModal();
    if (!generateOpen && dialog.open) dialog.close();
  }, [generateOpen]);

  useEffect(() => {
    const dialog = existingRef.current;
    if (!dialog) return;
    if (existingOpen && !dialog.open) dialog.showModal();
    if (!existingOpen && dialog.open) dialog.close();
  }, [existingOpen]);

  const basePath = configuredBasePath();
  const baseUrl = typeof window === "undefined" ? basePath : `${window.location.origin}${basePath}`;

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setCopied(null);
    const scopes = [canRead ? "read" : null, canGenerate ? "generate" : null].filter(
      (item): item is string => item !== null,
    );
    if (!scopes.length) {
      setError("Pick at least one scope");
      return;
    }
    setBusy(true);
    try {
      const created = unwrap(
        await createApiTokenAction({
          label: label.trim() || "OpenMontage",
          expiresInDays: Number(expiry),
          scopes,
        }),
      );
      setFresh(created.token);
      setTokens(created.tokens as TokenView[]);
      setLabel("");
      setGenerateOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the token");
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(id: number) {
    setError(null);
    setBusy(true);
    try {
      setTokens(unwrap(await revokeApiTokenAction({ id })) as TokenView[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not revoke the token");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: number) {
    setError(null);
    setBusy(true);
    try {
      setTokens(unwrap(await deleteApiTokenAction({ id })) as TokenView[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the token");
    } finally {
      setBusy(false);
    }
  }

  function workspaceOf(token: TokenView): string {
    if (token.teamId == null) return "Personal";
    return teams.find((team) => team.id === token.teamId)?.name ?? "Team";
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
      setError("Clipboard is blocked on this origin — select the text and copy it by hand.");
    }
  }

  return (
    <>
    <dialog
      ref={ref}
      aria-labelledby="ohf-tokens-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
    <div className="ohf-dialog-panel ohf-manage-panel">
    <section className="ohf-tokens ohf-manage-body ohf-scroll">
      <div className="ohf-keys-head">
        <div>
          <div id="ohf-tokens-title" className="ohf-keys-title">API tokens</div>
          <p className="ohf-keys-copy">
            A token lets Claude, OpenMontage, or a script start generations on this account. It spends
            the platform key saved here. Jobs land in the workspace that is active when you create the
            token. The token is shown once. Current workspace: {workspaceName}.
          </p>
        </div>
        <button type="button" className="ohf-icon-btn" aria-label="Close" onClick={onClose}>
          <CloseIcon size={13} />
        </button>
      </div>

      <div className="ohf-token-endpoint">
        <div className="ohf-token-endpoint-label">Claude connector URL</div>
        <code className="ohf-token-code">{`${baseUrl}/mcp`}</code>
        <p className="ohf-keys-copy">
          In Claude, add a custom connector with that URL, choose no sign-in, and set header
          Authorization to Bearer plus the token. Claude must reach this host on HTTPS port 443.
        </p>
      </div>

      {apiBase && (
        <div className="ohf-token-endpoint">
          <div className="ohf-token-endpoint-label">API address to paste into OpenMontage</div>
          <code className="ohf-token-code">{apiBase}</code>
          <div className="ohf-token-fresh-actions">
            <button type="button" className="ohf-token-ghost" onClick={() => void copy(apiBase, "base")}>
              {copied === "base" ? "Copied" : "Copy address"}
            </button>
            {models && (
              <span className="ohf-keys-copy">
                Example models: {models.video} (video) · {models.image} (image)
              </span>
            )}
          </div>
        </div>
      )}

      {!signedIn && !loading && (
        <div className="ohf-token-signin">
          <p className="ohf-keys-copy">
            Sign in to create a token. Each token belongs to one account, spends that account&apos;s
            platform key, and every job it starts is recorded against that account.
          </p>
          <Link href="/login" className="ohf-keys-save ohf-token-signin-link">
            Sign in to create a token
          </Link>
        </div>
      )}

      {signedIn && !hasApiKey && (
        <div className="ohf-alert" role="alert">
          <span className="ohf-alert-text">
            Save a platform key in the studio first: a token has nothing to spend without one.
          </span>
        </div>
      )}

      {fresh && (
        <div className="ohf-token-fresh">
          <div className="ohf-token-fresh-title">Copy this token now</div>
          <code className="ohf-token-code">{fresh}</code>
          <div className="ohf-token-fresh-actions">
            <button type="button" className="ohf-keys-save" onClick={() => void copy(fresh, "token")}>
              {copied === "token" ? "Copied" : "Copy token"}
            </button>
            <button type="button" className="ohf-token-ghost" onClick={() => setFresh(null)}>
              Done
            </button>
          </div>
          <p className="ohf-keys-copy">
            In OpenMontage, open the <strong>Settings → API</strong> page on the board (or put these two
            lines in <code>.env</code>):
          </p>
          <code className="ohf-token-code ohf-token-code--env">
            {`VICEND_BASE_URL=${baseUrl}\nVICEND_API_TOKEN=${fresh}`}
          </code>
          <div className="ohf-token-fresh-actions">
            <button
              type="button"
              className="ohf-token-ghost"
              onClick={() => void copy(`VICEND_BASE_URL=${baseUrl}\nVICEND_API_TOKEN=${fresh}`, "env")}
            >
              {copied === "env" ? "Copied" : "Copy .env lines"}
            </button>
          </div>
        </div>
      )}

      {signedIn && (
        <div className="ohf-token-actions">
          <button type="button" className="ohf-keys-save" onClick={() => setGenerateOpen(true)}>
            Generate Token
          </button>
          <button type="button" className="ohf-token-ghost" onClick={() => setExistingOpen(true)}>
            Existing
          </button>
        </div>
      )}

      {error && !generateOpen && !existingOpen && (
        <div className="ohf-alert" role="alert">
          <span className="ohf-alert-text">{error}</span>
        </div>
      )}
    </section>
    </div>
    </dialog>

    <dialog
      ref={generateRef}
      className="ohf-token-subdialog"
      aria-labelledby="ohf-generate-token-title"
      onClose={() => setGenerateOpen(false)}
      onClick={(event) => {
        if (event.target === generateRef.current) setGenerateOpen(false);
      }}
    >
      <div className="ohf-dialog-panel ohf-manage-panel">
        <section className="ohf-tokens ohf-manage-body ohf-scroll">
          <div className="ohf-keys-head">
            <div id="ohf-generate-token-title" className="ohf-keys-title">Generate token</div>
            <button type="button" className="ohf-icon-btn" aria-label="Close" onClick={() => setGenerateOpen(false)}>
              <CloseIcon size={13} />
            </button>
          </div>
          <p className="ohf-keys-copy">Workspace for this token: {workspaceName}.</p>
          <form className="ohf-keys-form" onSubmit={(event) => void onCreate(event)}>
            <label className="ohf-field">
              <div className="ohf-field-label">Label</div>
              <input
                className="ohf-input"
                type="text"
                placeholder="OpenMontage"
                maxLength={64}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <label className="ohf-field">
              <div className="ohf-field-label">Expires</div>
              <select className="ohf-input" value={expiry} onChange={(event) => setExpiry(event.target.value)}>
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="ohf-keys-provider">
              <label>
                <input type="checkbox" checked={canRead} onChange={(event) => setCanRead(event.target.checked)} />
                Read jobs
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={canGenerate}
                  onChange={(event) => setCanGenerate(event.target.checked)}
                />
                Start generations
              </label>
            </fieldset>
            {error && generateOpen && (
              <div className="ohf-alert" role="alert">
                <span className="ohf-alert-text">{error}</span>
              </div>
            )}
            <div className="ohf-keys-actions">
              <button type="submit" className="ohf-keys-save" disabled={busy}>
                {busy ? "Working…" : "Generate"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </dialog>

    <dialog
      ref={existingRef}
      className="ohf-token-subdialog"
      aria-labelledby="ohf-existing-token-title"
      onClose={() => setExistingOpen(false)}
      onClick={(event) => {
        if (event.target === existingRef.current) setExistingOpen(false);
      }}
    >
      <div className="ohf-dialog-panel ohf-manage-panel">
        <section className="ohf-tokens ohf-manage-body ohf-scroll">
          <div className="ohf-keys-head">
            <div id="ohf-existing-token-title" className="ohf-keys-title">Existing tokens</div>
            <button type="button" className="ohf-icon-btn" aria-label="Close" onClick={() => setExistingOpen(false)}>
              <CloseIcon size={13} />
            </button>
          </div>
          {error && existingOpen && (
            <div className="ohf-alert" role="alert">
              <span className="ohf-alert-text">{error}</span>
            </div>
          )}
          {loading ? (
            <p className="ohf-keys-copy">Loading…</p>
          ) : tokens.length === 0 ? (
            <p className="ohf-keys-copy">No tokens yet.</p>
          ) : (
            <div className="ohf-token-table-wrap">
              <table className="ohf-token-table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Workspace</th>
                    <th>Hint</th>
                    <th>Scopes</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Last used</th>
                    <th>Expires</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token) => (
                    <tr key={token.id}>
                      <td>{token.label || "Token"}</td>
                      <td>{workspaceOf(token)}</td>
                      <td>{token.hint}</td>
                      <td>{token.scopes.join(" + ") || "—"}</td>
                      <td>
                        <span className={`ohf-token-state ${token.active ? "is-live" : "is-dead"}`}>
                          {token.revokedAt ? "revoked" : token.expired ? "expired" : "active"}
                        </span>
                      </td>
                      <td>{when(token.createdAt)}</td>
                      <td>{when(token.lastUsedAt)}</td>
                      <td>{token.expiresAt ? when(token.expiresAt) : "never"}</td>
                      <td>
                        <div className="ohf-token-row-actions">
                          {token.active && (
                            <button
                              type="button"
                              className="ohf-token-ghost"
                              disabled={busy}
                              onClick={() => void onRevoke(token.id)}
                            >
                              Revoke
                            </button>
                          )}
                          {(token.revokedAt || token.expired) && (
                            <button
                              type="button"
                              className="ohf-token-ghost ohf-token-delete"
                              disabled={busy}
                              onClick={() => void onDelete(token.id)}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </dialog>
    </>
  );
}
