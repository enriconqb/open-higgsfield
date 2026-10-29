"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { loginAccount } from "@/auth/actions";
import { unwrap } from "@/lib/action-result";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      unwrap(await loginAccount({ username, password }));
      router.push("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="ohf-auth-form" onSubmit={(event) => void onSubmit(event)}>
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
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <label className="ohf-field">
        <div className="ohf-field-label">Password</div>
        <input
          className="ohf-input"
          type="password"
          autoComplete="current-password"
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
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p className="ohf-auth-foot">
        No account? <Link href="/register">Request access</Link>
        {" · "}
        <Link href="/">Back to studio</Link>
      </p>
    </form>
  );
}
