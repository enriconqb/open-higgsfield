"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { changePassword, getAuthState } from "@/auth/actions";
import { unwrap } from "@/lib/action-result";

export function ChangePasswordForm() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getAuthState().then(unwrap).then((state) => {
      if (!live) return;
      if (!state.user) {
        router.replace("/login");
        return;
      }
      setUsername(state.user.username);
    });
    return () => {
      live = false;
    };
  }, [router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(null);
    if (nextPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const result = unwrap(await changePassword({ currentPassword, nextPassword }));
      setDone(result.message);
      setCurrentPassword("");
      setNextPassword("");
      setConfirmPassword("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change password");
    } finally {
      setBusy(false);
    }
  }

  if (!username) {
    return <p className="ohf-keys-copy">Loading…</p>;
  }

  return (
    <form className="ohf-auth-form" onSubmit={(event) => void onSubmit(event)}>
      <p className="ohf-keys-copy">
        Signed in as <strong>{username}</strong>. Your saved API key stays encrypted and is never shown.
      </p>
      <label className="ohf-field">
        <div className="ohf-field-label">Current password</div>
        <input
          className="ohf-input"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </label>
      <label className="ohf-field">
        <div className="ohf-field-label">New password</div>
        <input
          className="ohf-input"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={nextPassword}
          onChange={(event) => setNextPassword(event.target.value)}
        />
      </label>
      <label className="ohf-field">
        <div className="ohf-field-label">Confirm new password</div>
        <input
          className="ohf-input"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
      </label>
      {error && (
        <div className="ohf-alert" role="alert">
          <span className="ohf-alert-text">{error}</span>
        </div>
      )}
      {done && (
        <div className="ohf-alert" role="status">
          <span className="ohf-alert-text">{done}</span>
        </div>
      )}
      <button type="submit" className="ohf-keys-save" disabled={busy}>
        {busy ? "Updating…" : "Change password"}
      </button>
      <p className="ohf-auth-foot">
        <Link href="/">Back to studio</Link>
      </p>
    </form>
  );
}
