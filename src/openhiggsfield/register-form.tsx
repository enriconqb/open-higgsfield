"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { registerAccount } from "@/auth/actions";

export function RegisterForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await registerAccount({ username, password });
      setDone(result.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="ohf-auth-form">
        <div className="ohf-alert" role="status">
          <span className="ohf-alert-text">{done}</span>
        </div>
        <p className="ohf-auth-foot">
          <Link href="/login">Sign in</Link>
          {" · "}
          <Link href="/">Back to studio</Link>
        </p>
      </div>
    );
  }

  return (
    <form className="ohf-auth-form" onSubmit={(event) => void onSubmit(event)}>
      <p className="ohf-keys-copy">
        Pick a unique username. Accounts stay pending until a superadmin approves them. Your API key
        is encrypted with your password and is never shown to admins.
      </p>
      <label className="ohf-field">
        <div className="ohf-field-label">Username</div>
        <input
          className="ohf-input"
          type="text"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          minLength={3}
          maxLength={32}
          pattern="[A-Za-z0-9_]+"
          placeholder="e.g. studio_user"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <label className="ohf-field">
        <div className="ohf-field-label">Password</div>
        <input
          className="ohf-input"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error && (
        <div className="ohf-alert" role="alert">
          <span className="ohf-alert-text">{error}</span>
        </div>
      )}
      <button type="submit" className="ohf-keys-save" disabled={busy}>
        {busy ? "Submitting…" : "Request access"}
      </button>
      <p className="ohf-auth-foot">
        Already approved? <Link href="/login">Sign in</Link>
        {" · "}
        <Link href="/">Back to studio</Link>
      </p>
    </form>
  );
}
