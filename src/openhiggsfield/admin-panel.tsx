"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { adminListUsers, adminSetUserStatus, getAuthState } from "@/auth/actions";
import type { PublicUser, UserStatus } from "@/auth/types";

export function AdminPanel() {
  const router = useRouter();
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const state = await getAuthState();
        if (!live) return;
        if (!state.user || state.user.role !== "superadmin") {
          router.replace("/login");
          return;
        }
        const list = await adminListUsers();
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
      const list = await adminSetUserStatus({ id, status });
      setUsers(list);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  if (!users) {
    return <p className="ohf-keys-copy">Loading users…</p>;
  }

  return (
    <div className="ohf-admin">
      <p className="ohf-keys-copy">
        Approve registrations, disable accounts, or reopen pending ones. API keys stay encrypted —
        plaintext is never shown here.
      </p>
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
