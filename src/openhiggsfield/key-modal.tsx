"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { clearPlatformCredentials, savePlatformCredentials } from "@/generation/actions";
import type { KeyProvider } from "@/generation/credentials";

import { CloseIcon } from "./icons";

export function KeyModal({
  configured,
  onClose,
  onSaved,
  onCleared,
}: {
  configured: boolean;
  onClose: () => void;
  onSaved: () => void;
  onCleared: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<KeyProvider>("openrouter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
    panelRef.current?.focus();
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await savePlatformCredentials({ api_key: apiKey, provider });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the key");
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    setBusy(true);
    setError(null);
    try {
      await clearPlatformCredentials();
      setApiKey("");
      onCleared();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove the key");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="ohf-keys-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div ref={panelRef} tabIndex={-1} className="ohf-dialog-panel ohf-keys-panel">
        <div className="ohf-keys-head">
          <div>
            <div id="ohf-keys-title" className="ohf-keys-title">
              API key
            </div>
            <p className="ohf-keys-copy">
              {configured
                ? "A key is encrypted on the server for your account. Choose the provider and enter a new key to replace it. Admins cannot read the plaintext."
                : "Choose OpenRouter or Higgsfield, then paste the key. It is encrypted with your password and never shown again."}
            </p>
          </div>
          <button type="button" className="ohf-icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>

        <form className="ohf-keys-form" onSubmit={(event) => void onSubmit(event)}>
          <fieldset className="ohf-keys-provider">
            <legend className="ohf-field-label">Provider</legend>
            <label>
              <input
                type="radio"
                name="provider"
                checked={provider === "openrouter"}
                onChange={() => setProvider("openrouter")}
              />
              OpenRouter
            </label>
            <label>
              <input
                type="radio"
                name="provider"
                checked={provider === "higgsfield"}
                onChange={() => setProvider("higgsfield")}
              />
              Higgsfield
            </label>
          </fieldset>
          <label className="ohf-field">
            <div className="ohf-field-label">API key</div>
            <input
              className="ohf-input ohf-input--mono"
              name="api_key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={provider === "higgsfield" ? "id:secret" : "sk-or-..."}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>

          {error && (
            <div className="ohf-alert" role="alert">
              <span className="ohf-alert-text">{error}</span>
            </div>
          )}

          <div className="ohf-keys-actions">
            {configured && (
              <button type="button" className="ohf-btn-quiet" disabled={busy} onClick={() => void onClear()}>
                Remove key
              </button>
            )}
            <button type="submit" className="ohf-keys-save" disabled={busy || !apiKey.trim()}>
              {busy ? "Saving…" : configured ? "Replace key" : "Save key"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}