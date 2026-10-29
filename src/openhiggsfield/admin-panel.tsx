"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { adminCreateUser, adminDeleteUser, adminListUsers, adminSetUserStatus, getAuthState } from "@/auth/actions";
import type { PublicUser, UserStatus } from "@/auth/types";
import { unwrap } from "@/lib/action-result";

export function AdminPanel() {
  const router = useRouter();
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);

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
        const list = unwrap(await adminListUsers());
        if (live) setUsers(list);
      } catch (caught) {
        if (live) {
          setError(caught instanceof Error ? caught.message : "Could not load users");
          router.replace("/login");
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [router]);

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

  async function create(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const list = unwrap(await adminCreateUser({ username, password }));
      setUsers(list);
      setUsername("");
      setPassword("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create user");
    } finally {
      setCreating(false);
    }
  }

  if (!users) {
    return <p className="ohf-keys-copy">Loading users…</p>;
  }

  return (
    <div className="ohf-admin">
      <p className="ohf-keys-copy">
        Create an active user, change status, or delete an account. Encrypted API keys are removed
        with the user and are never shown here.
      </p>
      <form className="ohf-admin-create" onSubmit={(event) => void create(event)}>
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
        <button type="submit" className="ohf-keys-save" disabled={creating}>
          {creating ? "Creating…" : "Create user"}
        </button>
      </form>
      {error && (
        <div className="ohf-alert" role="alert">
          <span className="ohf-alert-text">{error}</span>
        </div>
      )}
      <div className="ohf-admin-table-wrap">
        <table className="ohf-admin-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.username}</td>
                <td>{user.role}</td>
                <td>
                  <span className="ohf-admin-status" data-status={user.status}>
                    {user.status}
                  </span>
                </td>
                <td className="ohf-admin-actions">
                  {user.role === "superadmin" ? (
                    <span className="ohf-keys-copy">—</span>
                  ) : (
                    <>
                      {user.status !== "active" && (
                        <button
                          type="button"
                          className="ohf-btn-quiet"
                          disabled={busyId === user.id}
                          onClick={() => void setStatus(user.id, "active")}
                        >
                          Approve
                        </button>
                      )}
                      {user.status !== "pending" && (
                        <button
                          type="button"
                          className="ohf-btn-quiet"
                          disabled={busyId === user.id}
                          onClick={() => void setStatus(user.id, "pending")}
                        >
                          Pending
                        </button>
                      )}
                      {user.status !== "disabled" && (
                        <button
                          type="button"
                          className="ohf-btn-quiet"
                          disabled={busyId === user.id}
                          onClick={() => void setStatus(user.id, "disabled")}
                        >
                          Disable
                        </button>
                      )}
                      <button
                        type="button"
                        className="ohf-btn-quiet"
                        disabled={busyId === user.id}
                        onClick={() => void remove(user.id)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ohf-auth-foot">
        <Link href="/">Back to studio</Link>
      </p>
    </div>
  );
}
