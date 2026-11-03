"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import DataTable, { Column } from "datatables.net-react";
import DtCore from "datatables.net-dt";

import "datatables.net-dt/css/dataTables.dataTables.css";

import {
  adminClearUserApiKey,
  adminCreateUser,
  adminDeleteUser,
  adminListUsers,
  adminSetUserStatus,
  getAuthState,
} from "@/auth/actions";
import type { PublicUser, UserRole, UserStatus } from "@/auth/types";
import { hasStudioAdminAccess } from "@/auth/types";
import { unwrap } from "@/lib/action-result";
import type { KeyProvider } from "@/generation/credentials";

import { CloseIcon, CheckIcon, ClockIcon, KeyIcon, TrashIcon } from "./icons";

const ROLES = ["user", "admin", "superadmin"] as const;
const PROVIDERS = ["openrouter", "higgsfield"] as const;

DataTable.use(DtCore);

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const createRef = useRef<HTMLDialogElement>(null);
  const [selfId, setSelfId] = useState<number | null>(null);
  const [selfRole, setSelfRole] = useState<UserRole | null>(null);
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<KeyProvider>("openrouter");
  const [providerQuery, setProviderQuery] = useState("openrouter");
  const [providerOpen, setProviderOpen] = useState(false);
  const [role, setRole] = useState<UserRole>("user");
  const [roleQuery, setRoleQuery] = useState("user");
  const [roleOpen, setRoleOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    if (createOpen) createRef.current?.showModal();
  }, [createOpen]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const state = unwrap(await getAuthState());
        if (!live) return;
        if (!state.user || !hasStudioAdminAccess(state.user.role)) {
          onClose();
          return;
        }
        setSelfId(state.user.id);
        setSelfRole(state.user.role);
        const list = unwrap(await adminListUsers());
        if (live) setUsers(list);
      } catch (caught) {
        if (live) setError(caught instanceof Error ? caught.message : "Could not load users");
      }
    })();
    return () => {
      live = false;
    };
  }, [onClose]);

  async function setStatus(id: number, status: UserStatus) {
    setBusyId(id);
    setError(null);
    try {
      const list = unwrap(await adminSetUserStatus({ id, status }));
      setUsers(list);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  async function clearKey(id: number) {
    if (!window.confirm("Remove this user's API key? They will need to save a new one before generating.")) return;
    setBusyId(id);
    setError(null);
    try {
      const list = unwrap(await adminClearUserApiKey({ id }));
      setUsers(list);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove API key");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: number) {
    if (!window.confirm("Delete this user and their encrypted API key?")) return;
    setBusyId(id);
    setError(null);
    try {
      const list = unwrap(await adminDeleteUser({ id }));
      setUsers(list);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  function openCreate() {
    setUsername("");
    setPassword("");
    setApiKey("");
    setProvider("openrouter");
    setProviderQuery("openrouter");
    setProviderOpen(false);
    setRole("user");
    setRoleQuery("user");
    setRoleOpen(false);
    setCreateError(null);
    setCreateOpen(true);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const list = unwrap(await adminCreateUser({ username, password, role, apiKey, provider }));
      setUsers(list);
      setCreateOpen(false);
      createRef.current?.close();
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : "Could not create user");
    } finally {
      setCreating(false);
    }
  }

  const tableKey = (users ?? []).map((user) => `${user.id}:${user.status}:${user.hasApiKey ? 1 : 0}`).join("|");

  return (
    <>
    <dialog
      ref={ref}
      className="ohf-users-dialog"
      aria-labelledby="ohf-users-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="ohf-dialog-panel ohf-manage-panel ohf-users-panel">
        <div className="ohf-keys-head">
          <div>
            <div id="ohf-users-title" className="ohf-keys-title">
              Users management
            </div>
            <p className="ohf-keys-copy">
              Create an active user, change status, delete an account, or remove another user&apos;s API key. Key
              contents are never shown here.
            </p>
          </div>
          <button type="button" className="ohf-icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>
        <div className="ohf-manage-body ohf-scroll">
          <div className="ohf-users-toolbar">
            <button type="button" className="ohf-keys-save" onClick={openCreate}>
              Create user
            </button>
          </div>
          {error && (
            <div className="ohf-alert" role="alert">
              <span className="ohf-alert-text">{error}</span>
            </div>
          )}
          {!users && !error && <p className="ohf-keys-copy">Loading users…</p>}
          {users && (
            <div className="ohf-users-dt">
              <DataTable
                key={tableKey}
                data={users}
                className="ohf-admin-table"
                options={{ pageLength: 10, order: [[0, "asc"]], layout: { topStart: "pageLength", topEnd: "search" } }}
              >
                <Column title="Username" data="username" />
                <Column title="Role" data="role" />
                <Column title="Status" data="status">
                  {(status: string, type: string, _row: PublicUser) =>
                    type === "display" ? (
                      <span className="ohf-admin-status" data-status={status}>
                        {status}
                      </span>
                    ) : (
                      status
                    )
                  }
                </Column>
                <Column title="Actions" data={null} options={{ orderable: false, searchable: false }}>
                  {(person: PublicUser, type: string, _row: PublicUser) =>
                    type !== "display" ? (
                      ""
                    ) : (
                      <span className="ohf-admin-actions">
                        {person.hasApiKey && person.id !== selfId && (
                          <button
                            type="button"
                            className="ohf-admin-icon"
                            title="Remove API key"
                            aria-label="Remove API key"
                            disabled={busyId === person.id}
                            onClick={() => void clearKey(person.id)}
                          >
                            <KeyIcon size={14} />
                          </button>
                        )}
                        {person.role === "user" ? (
                          <>
                            {person.status !== "active" && (
                              <button
                                type="button"
                                className="ohf-admin-icon"
                                title="Approve"
                                aria-label="Approve"
                                disabled={busyId === person.id}
                                onClick={() => void setStatus(person.id, "active")}
                              >
                                <CheckIcon size={14} />
                              </button>
                            )}
                            {person.status !== "pending" && (
                              <button
                                type="button"
                                className="ohf-admin-icon"
                                title="Pending"
                                aria-label="Pending"
                                disabled={busyId === person.id}
                                onClick={() => void setStatus(person.id, "pending")}
                              >
                                <ClockIcon size={14} />
                              </button>
                            )}
                            {person.status !== "disabled" && (
                              <button
                                type="button"
                                className="ohf-admin-icon"
                                title="Disable"
                                aria-label="Disable"
                                disabled={busyId === person.id}
                                onClick={() => void setStatus(person.id, "disabled")}
                              >
                                <CloseIcon size={14} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="ohf-admin-icon ohf-admin-icon--danger"
                              title="Delete"
                              aria-label="Delete"
                              disabled={busyId === person.id}
                              onClick={() => void remove(person.id)}
                            >
                              <TrashIcon size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            {person.role === "admin" && selfRole === "superadmin" && (
                              <button
                                type="button"
                                className="ohf-admin-icon ohf-admin-icon--danger"
                                title="Delete"
                                aria-label="Delete"
                                disabled={busyId === person.id}
                                onClick={() => void remove(person.id)}
                              >
                                <TrashIcon size={14} />
                              </button>
                            )}
                            {(person.id === selfId || !person.hasApiKey) &&
                            !(person.role === "admin" && selfRole === "superadmin") ? (
                              <span className="ohf-keys-copy">—</span>
                            ) : null}
                          </>
                        )}
                      </span>
                    )
                  }
                </Column>
              </DataTable>
            </div>
          )}
        </div>
      </div>
    </dialog>
    {createOpen && (
      <dialog
        ref={createRef}
        className="ohf-users-dialog"
        aria-labelledby="ohf-users-create-title"
        onClose={() => setCreateOpen(false)}
        onClick={(event) => {
          if (event.target === createRef.current) {
            setCreateOpen(false);
            createRef.current?.close();
          }
        }}
      >
        <form className="ohf-dialog-panel ohf-users-create-panel ohf-users-form" onSubmit={(event) => void create(event)}>
          <div className="ohf-keys-head">
            <div id="ohf-users-create-title" className="ohf-keys-title">
              Create user
            </div>
            <button
              type="button"
              className="ohf-icon-btn"
              aria-label="Close"
              onClick={() => {
                setCreateOpen(false);
                createRef.current?.close();
              }}
            >
              <CloseIcon size={13} />
            </button>
          </div>
          <label className="ohf-field">
            <div className="ohf-field-label">Username</div>
            <input
              className="ohf-input"
              value={username}
              required
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_]+"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="ohf-field">
            <div className="ohf-field-label">Initial password</div>
            <input
              className="ohf-input"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="ohf-field">
            <div className="ohf-field-label">API key</div>
            <input
              className="ohf-input"
              type="password"
              autoComplete="off"
              value={apiKey}
              placeholder="Optional"
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <div className="ohf-field ohf-role-field">
            <div className="ohf-field-label">Provider</div>
            <input
              className="ohf-input"
              value={providerQuery}
              role="combobox"
              aria-expanded={providerOpen}
              aria-controls="ohf-provider-list"
              autoComplete="off"
              onFocus={() => setProviderOpen(true)}
              onChange={(event) => {
                setProviderQuery(event.target.value);
                setProviderOpen(true);
              }}
              onBlur={() => {
                window.setTimeout(() => setProviderOpen(false), 120);
              }}
            />
            {providerOpen && (
              <div id="ohf-provider-list" className="ohf-role-list" role="listbox">
                {PROVIDERS.filter((item) => item.includes(providerQuery.trim().toLowerCase())).map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="option"
                    aria-selected={provider === item}
                    className="ohf-role-option"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setProvider(item);
                      setProviderQuery(item);
                      setProviderOpen(false);
                    }}
                  >
                    {item}
                  </button>
                ))}
                {!PROVIDERS.some((item) => item.includes(providerQuery.trim().toLowerCase())) && (
                  <p className="ohf-keys-copy">No matching provider</p>
                )}
              </div>
            )}
          </div>
          <div className="ohf-field ohf-role-field">
            <div className="ohf-field-label">Role</div>
            <input
              className="ohf-input"
              value={roleQuery}
              role="combobox"
              aria-expanded={roleOpen}
              aria-controls="ohf-role-list"
              autoComplete="off"
              onFocus={() => setRoleOpen(true)}
              onChange={(event) => {
                setRoleQuery(event.target.value);
                setRoleOpen(true);
              }}
              onBlur={() => {
                window.setTimeout(() => setRoleOpen(false), 120);
              }}
            />
            {roleOpen && (
              <div id="ohf-role-list" className="ohf-role-list" role="listbox">
                {ROLES.filter((item) => item.includes(roleQuery.trim().toLowerCase())).map((item) => (
                    <button
                      key={item}
                      type="button"
                      role="option"
                      aria-selected={role === item}
                      className="ohf-role-option"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setRole(item);
                        setRoleQuery(item);
                        setRoleOpen(false);
                      }}
                    >
                      {item}
                    </button>
                  ))}
                {!ROLES.some((item) => item.includes(roleQuery.trim().toLowerCase())) && (
                  <p className="ohf-keys-copy">No matching role</p>
                )}
              </div>
            )}
          </div>
          {createError && (
            <div className="ohf-alert" role="alert">
              <span className="ohf-alert-text">{createError}</span>
            </div>
          )}
          <button type="submit" className="ohf-keys-save" disabled={creating}>
            {creating ? "Creating…" : "Create user"}
          </button>
        </form>
      </dialog>
    )}
    </>
  );
}
