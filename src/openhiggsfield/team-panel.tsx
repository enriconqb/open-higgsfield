"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

import type { KeyProvider } from "@/generation/credentials";
import { formatUsd } from "@/generation/estimate";
import { unwrap } from "@/lib/action-result";
import {
  addTeamBalance,
  removeTeamBalance,
  createTeam,
  dissolveTeam,
  inviteMember,
  loadTeamDesk,
  readBalanceAlerts,
  clearMemberTeamKey,
  removeMember,
  respondInvite,
  saveMemberLimit,
  saveMemberTeamKey,
  selectTeamApi,
  setBillingMode,
  setMemberRole,
  switchTeam,
  type TeamDesk,
} from "@/teams/actions";

import { CloseIcon, GemIcon, KeyIcon, TrashIcon, UserIcon } from "./icons";

/** Portaled dialogs sit outside the studio root, so they must copy its font variable class. */
function themeClass(): string {
  if (typeof document === "undefined") return "ohf";
  const extra = document.querySelector(".ohf")?.className.split(/\s+/).filter((name) => name && name !== "ohf") ?? [];
  return ["ohf", ...extra].join(" ");
}

export function TeamPanel({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [desk, setDesk] = useState<TeamDesk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [amount, setAmount] = useState("");
  const [keyMember, setKeyMember] = useState<TeamDesk["members"][number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [dissolveOpen, setDissolveOpen] = useState(false);
  const [apiQuery, setApiQuery] = useState("");
  const [apiOpen, setApiOpen] = useState(false);

  async function reload() {
    const next = unwrap(await loadTeamDesk());
    setDesk(next);
    if (next.activeTeamId && next.canAdmin) unwrap(await readBalanceAlerts(next.activeTeamId));
    onChanged();
  }

  useEffect(() => {
    void reload().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load teams"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(task: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await task();
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const active = desk?.activeTeamId ?? null;
  const activeTeam = desk?.teams.find((team) => team.id === active) ?? null;

  return (
    <>
    <dialog open className="ohf-dialog" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="ohf-dialog-panel ohf-team-panel">
        <div className="ohf-keys-head">
          <div>
            <div className="ohf-keys-title">Team</div>
            <p className="ohf-keys-copy">Choose a workspace. Assets, uploads, and balance stay with that team.</p>
          </div>
          <button type="button" className="ohf-icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>

        <div className="ohf-manage-body ohf-scroll ohf-team-body">
          {!desk && !error && <p className="ohf-keys-copy">Loading…</p>}
          {error && (
            <div className="ohf-alert" role="alert">
              <span className="ohf-alert-text">{error}</span>
            </div>
          )}

          {desk && (
            <>
              <section className="ohf-team-section">
                <div className="ohf-team-section-head">
                  <div className="ohf-field-label">Workspace</div>
                  <div className="ohf-team-head-actions">
                    {desk.canAdmin && activeTeam && (
                      <button type="button" className="ohf-team-activity-btn" disabled={busy} onClick={() => setActivityOpen(true)}>
                        Activity
                      </button>
                    )}
                    <button type="button" className="ohf-keys-save" disabled={busy} onClick={() => setCreateOpen(true)}>
                      Create team
                    </button>
                  </div>
                </div>
                <div className="ohf-team-switch" role="listbox" aria-label="Workspace">
                  <button
                    type="button"
                    className={`ohf-team-chip${active == null ? " is-on" : ""}`}
                    onClick={() => void run(() => switchTeam(null).then(unwrap))}
                    disabled={busy}
                  >
                    <span>Personal</span>
                    <small>Only you</small>
                  </button>
                  {desk.teams.map((team) => (
                    <button
                      key={team.id}
                      type="button"
                      className={`ohf-team-chip${team.id === active ? " is-on" : ""}`}
                      onClick={() => void run(() => switchTeam(team.id).then(unwrap))}
                      disabled={busy || team.status !== "active"}
                    >
                      <span>{team.name}</span>
                      <small>{team.role === "team_admin" ? "Team admin" : "Member"}</small>
                    </button>
                  ))}
                </div>
              </section>

              {desk.invites.length > 0 && (
                <section className="ohf-team-section">
                  <div className="ohf-field-label">Invitations</div>
                  <ul className="ohf-team-list">
                    {desk.invites.map((invite) => (
                      <li key={invite.id} className="ohf-team-row">
                        <div>
                          <strong>{invite.teamName}</strong>
                          <p className="ohf-keys-copy">From {invite.invitedBy}</p>
                        </div>
                        <div className="ohf-team-row-actions">
                          <button type="button" className="ohf-keys-save" disabled={busy} onClick={() => void run(() => respondInvite(invite.id, true).then(unwrap))}>
                            Accept
                          </button>
                          <button type="button" className="ohf-btn-quiet" disabled={busy} onClick={() => void run(() => respondInvite(invite.id, false).then(unwrap))}>
                            Decline
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {desk.credit && activeTeam && (
                <section className="ohf-team-section">
                  <div className="ohf-team-section-head">
                    <div className="ohf-field-label">Balance · {activeTeam.name}</div>
                    {desk.viewerId === desk.apiUserId && (
                      <div className="ohf-team-mode">
                        <button
                          type="button"
                          className={desk.credit.mode === "global" ? "is-on" : ""}
                          disabled={busy}
                          onClick={() => void run(() => setBillingMode(activeTeam.id, "global").then(unwrap))}
                        >
                          Global
                        </button>
                        <button
                          type="button"
                          className={desk.credit.mode === "member" ? "is-on" : ""}
                          disabled={busy}
                          onClick={() => void run(() => setBillingMode(activeTeam.id, "member").then(unwrap))}
                        >
                          Per member
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="ohf-team-stats">
                    <div>
                      <span>Balance</span>
                      <strong>{formatUsd(desk.credit.remaining)}</strong>
                    </div>
                  </div>
                  <p className="ohf-keys-copy">
                    {desk.credit.usesTeamBalance
                      ? "This account spends the team balance."
                      : "Your own API key is used. Generations are recorded on the team, and the balance is not charged."}
                    {desk.credit.low ? " Remaining balance is under 20%." : ""}
                  </p>
                  {desk.viewerId === desk.apiUserId && (
                    <form
                      className="ohf-team-inline"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
                        const removing = submitter?.value === "remove";
                        void run(async () => {
                          const dollars = Number(amount);
                          unwrap(await (removing ? removeTeamBalance(activeTeam.id, dollars) : addTeamBalance(activeTeam.id, dollars)));
                          setAmount("");
                        });
                      }}
                    >
                      <input className="ohf-input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Dollars" />
                      <button type="submit" className="ohf-keys-save" value="add" disabled={busy || !amount.trim()}>
                        Add balance
                      </button>
                      <button type="submit" className="ohf-btn-quiet" value="remove" disabled={busy || !amount.trim()}>
                        Remove balance
                      </button>
                    </form>
                  )}
                </section>
              )}

              {desk.canAdmin && activeTeam && (
                <section className="ohf-team-section">
                  <div className="ohf-field-label">Team API</div>
                  <p className="ohf-keys-copy">Search a team admin. Members without their own key use that admin’s key, even before it is saved.</p>
                  <div className="ohf-field ohf-role-field">
                    <input
                      className="ohf-input"
                      role="combobox"
                      aria-expanded={apiOpen}
                      aria-controls="ohf-team-api-list"
                      placeholder="Search a team admin"
                      autoComplete="off"
                      value={apiOpen ? apiQuery : (desk.members.find((member) => member.userId === desk.apiUserId)?.username ?? "")}
                      onFocus={() => {
                        setApiQuery("");
                        setApiOpen(true);
                      }}
                      onChange={(event) => {
                        setApiQuery(event.target.value);
                        setApiOpen(true);
                      }}
                      onBlur={() => window.setTimeout(() => setApiOpen(false), 120)}
                    />
                    {apiOpen && (
                      <div id="ohf-team-api-list" className="ohf-role-list" role="listbox">
                        {desk.members
                          .filter((member) => member.role === "team_admin" && member.username.includes(apiQuery.trim().toLowerCase()))
                          .map((member) => (
                            <button
                              key={member.userId}
                              type="button"
                              role="option"
                              aria-selected={desk.apiUserId === member.userId}
                              className="ohf-role-option"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                setApiOpen(false);
                                void run(() => selectTeamApi(activeTeam.id, member.userId).then(unwrap));
                              }}
                            >
                              {member.username}
                              {desk.apiUserId === member.userId ? " · in use" : ""}
                              {member.hasTeamKey ? "" : " · no key yet"}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                  <ul className="ohf-team-list">
                    {desk.members
                      .filter((member) => member.userId === desk.apiUserId)
                      .map((member) => (
                        <li key={member.userId} className={`ohf-team-row${desk.apiUserId === member.userId ? " is-api" : ""}`}>
                          <div className="ohf-team-person">
                            <span className="ohf-team-icon is-key" aria-hidden>
                              <KeyIcon size={14} />
                            </span>
                            <div>
                              <strong>{member.username}</strong>
                              <p className="ohf-keys-copy">{member.hasTeamKey ? "Team key saved" : "No team key yet"}</p>
                            </div>
                          </div>
                          <div className="ohf-team-row-actions">
                            {desk.apiUserId === member.userId && <span className="ohf-team-pill">In use</span>}
                            {member.userId === desk.viewerId && (
                              <button type="button" className="ohf-team-icon" title={member.hasTeamKey ? "Replace your team key" : "Add your team key"} disabled={busy} onClick={() => setKeyMember(member)}>
                                <KeyIcon size={14} />
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                  </ul>
                  <div className="ohf-field-label">Members</div>
                  <form
                    className="ohf-team-inline"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        unwrap(await inviteMember(activeTeam.id, username));
                        setUsername("");
                      });
                    }}
                  >
                    <input className="ohf-input" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username to invite" />
                    <button type="submit" className="ohf-keys-save" disabled={busy || username.trim().length < 2}>
                      Invite
                    </button>
                  </form>
                  <ul className="ohf-team-list">
                    {desk.members.map((member) => (
                      <li key={member.userId} className="ohf-team-row">
                        <div>
                          <strong>{member.username}</strong>
                          <p className="ohf-keys-copy">
                            {member.role === "team_admin" ? "Team admin" : "Member"}
                            {member.hasOwnKey ? " · own API key" : member.hasTeamKey ? " · team key" : " · no key"}
                            {desk.credit?.mode === "member" && !member.hasOwnKey
                              ? ` · Usage ${formatUsd(member.spentCredits)} / Limit ${formatUsd(member.limitCredits)}`
                              : ""}
                          </p>
                        </div>
                        <div className="ohf-team-row-actions">
                          {member.role === "team_admin" && member.userId === desk.viewerId && (
                            <button type="button" className="ohf-team-icon" title="Your team key" disabled={busy} onClick={() => setKeyMember(member)}>
                              <KeyIcon size={14} />
                            </button>
                          )}
                          {desk.credit?.mode === "member" && desk.viewerId === desk.apiUserId && !member.hasOwnKey && (
                            <button
                              type="button"
                              className="ohf-team-icon is-credit"
                              title="Change balance"
                              disabled={busy}
                              onClick={() => {
                                const next = window.prompt("New member limit in dollars", String(member.limitCredits));
                                if (next == null || !next.trim()) return;
                                const limit = Number(next);
                                if (!Number.isFinite(limit) || limit < 0) return;
                                void run(() => saveMemberLimit(activeTeam.id, member.userId, limit).then(unwrap));
                              }}
                            >
                              <GemIcon size={14} />
                            </button>
                          )}
                          {desk.canAdmin &&
                            member.userId !== desk.viewerId &&
                            (desk.isSuperadmin || member.userId !== desk.createdBy) && (
                            <button
                              type="button"
                              className="ohf-team-icon"
                              title={member.role === "team_admin" ? "Make member" : "Make team admin"}
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  setMemberRole(activeTeam.id, member.userId, member.role === "team_admin" ? "member" : "team_admin").then(unwrap),
                                )
                              }
                            >
                              <UserIcon size={14} />
                            </button>
                          )}
                          {member.userId !== desk.viewerId && (
                            <button type="button" className="ohf-team-icon is-danger" title="Remove from team" disabled={busy} onClick={() => void run(() => removeMember(activeTeam.id, member.userId).then(unwrap))}>
                              <TrashIcon size={14} />
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

            </>
          )}
        </div>
        {desk && activeTeam && (desk.createdBy === desk.viewerId || desk.isSuperadmin) && (
          <button type="button" className="ohf-team-dissolve" disabled={busy} onClick={() => setDissolveOpen(true)}>
            <TrashIcon size={13} />
            Dissolve
          </button>
        )}
      </div>
    </dialog>
      {keyMember && active &&
        createPortal(
          <div className={themeClass()}>
            <MemberKeyDialog
              member={keyMember}
              teamId={active}
              onClose={() => setKeyMember(null)}
              onSaved={async () => {
                setKeyMember(null);
                await reload();
              }}
            />
          </div>,
          document.body,
        )}
      {dissolveOpen && activeTeam &&
        createPortal(
          <div className={themeClass()}>
            <DissolveTeamDialog
              busy={busy}
              teamName={activeTeam.name}
              onClose={() => setDissolveOpen(false)}
              onConfirm={async (typed) => {
                unwrap(await dissolveTeam(activeTeam.id, typed));
                setDissolveOpen(false);
                await reload();
                onChanged();
              }}
            />
          </div>,
          document.body,
        )}
      {createOpen &&
        createPortal(
          <div className={themeClass()}>
            <CreateTeamDialog
              busy={busy}
              onClose={() => setCreateOpen(false)}
              onCreate={async (label) => {
                unwrap(await createTeam(label));
                setCreateOpen(false);
                await reload();
              }}
            />
          </div>,
          document.body,
        )}
      {activityOpen && desk && activeTeam &&
        createPortal(
          <div className={themeClass()}>
            <ActivityDialog
              teamName={activeTeam.name}
              members={desk.members}
              ledger={desk.ledger}
              audit={desk.audit}
              onClose={() => setActivityOpen(false)}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

function MemberKeyDialog({
  member,
  teamId,
  onClose,
  onSaved,
}: {
  member: TeamDesk["members"][number];
  teamId: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<KeyProvider>("openrouter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      unwrap(await saveMemberTeamKey(teamId, member.userId, provider, apiKey));
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the key");
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      unwrap(await clearMemberTeamKey(teamId, member.userId));
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove the key");
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} aria-labelledby="ohf-member-key-title" onClick={(event) => event.target === ref.current && onClose()} onClose={onClose}>
      <div className="ohf-dialog-panel ohf-keys-panel">
        <div className="ohf-keys-head">
          <div>
            <div id="ohf-member-key-title" className="ohf-keys-title">
              API key
            </div>
            <p className="ohf-keys-copy">
              {member.hasTeamKey
                ? `A team key is stored for ${member.username}. Enter a new one to replace it. The plaintext is not shown again.`
                : `Paste your key for this team. Other members use it only after a team admin selects it. Your own key, if you have one, still spends on its own.`}
            </p>
          </div>
          <button type="button" className="ohf-icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>
        <form className="ohf-keys-form" onSubmit={(event) => void save(event)}>
          <fieldset className="ohf-keys-provider">
            <legend className="ohf-field-label">Provider</legend>
            <label>
              <input type="radio" name="provider" checked={provider === "openrouter"} onChange={() => setProvider("openrouter")} />
              OpenRouter
            </label>
            <label>
              <input type="radio" name="provider" checked={provider === "higgsfield"} onChange={() => setProvider("higgsfield")} />
              Higgsfield
            </label>
          </fieldset>
          <label className="ohf-field">
            <div className="ohf-field-label">API key</div>
            <input
              className="ohf-input ohf-input--mono"
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
            {member.hasTeamKey && (
              <button type="button" className="ohf-btn-quiet" disabled={busy} onClick={() => void clear()}>
                Remove key
              </button>
            )}
            <button type="submit" className="ohf-keys-save" disabled={busy || !apiKey.trim()}>
              {busy ? "Saving…" : member.hasTeamKey ? "Replace key" : "Save key"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

function DissolveTeamDialog({
  busy,
  teamName,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  teamName: string;
  onClose: () => void;
  onConfirm: (name: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const matches = typed === teamName;

  return (
    <dialog ref={ref} className="ohf-team-activity-dialog" onClick={(event) => event.target === event.currentTarget && onClose()} onClose={onClose}>
      <div className="ohf-dialog-panel ohf-team-create">
        <div className="ohf-keys-head">
          <div>
            <div className="ohf-keys-title">Dissolve team</div>
            <p className="ohf-keys-copy">Type {teamName} exactly. The team leaves the workspace list. Its usage stays for a superadmin.</p>
          </div>
          <button type="button" className="ohf-icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>
        <form
          className="ohf-keys-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!matches) return;
            void onConfirm(typed).catch((caught) => setError(caught instanceof Error ? caught.message : "Request failed"));
          }}
        >
          {error && (
            <div className="ohf-alert" role="alert">
              <span className="ohf-alert-text">{error}</span>
            </div>
          )}
          <input className="ohf-input" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={teamName} autoComplete="off" />
          <button type="submit" className="ohf-keys-save" disabled={busy || !matches}>
            {busy ? "Dissolving…" : "Dissolve team"}
          </button>
        </form>
      </div>
    </dialog>
  );
}

function CreateTeamDialog({
  busy,
  onClose,
  onCreate,
}: {
  busy: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog ref={ref} className="ohf-team-activity-dialog" onClick={(event) => event.target === event.currentTarget && onClose()} onClose={onClose}>
      <div className="ohf-dialog-panel ohf-team-create">
        <div className="ohf-keys-head">
          <div>
            <div className="ohf-keys-title">Create team</div>
            <p className="ohf-keys-copy">The name is shown in the workspace switcher. You become its team admin.</p>
          </div>
          <button type="button" className="ohf-icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>
        <form
          className="ohf-keys-form"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            void onCreate(name.trim()).catch((caught) => {
              setError(caught instanceof Error ? caught.message : "Could not create the team");
            });
          }}
        >
          <label className="ohf-field">
            <div className="ohf-field-label">Team name</div>
            <input className="ohf-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Studio name" minLength={2} maxLength={64} autoFocus />
          </label>
          {error && (
            <div className="ohf-alert" role="alert">
              <span className="ohf-alert-text">{error}</span>
            </div>
          )}
          <div className="ohf-keys-actions">
            <button type="button" className="ohf-btn-quiet" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="ohf-keys-save" disabled={busy || name.trim().length < 2}>
              Create
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

function ActivityDialog({
  teamName,
  members,
  ledger,
  audit,
  onClose,
}: {
  teamName: string;
  members: TeamDesk["members"];
  ledger: TeamDesk["ledger"];
  audit: TeamDesk["audit"];
  onClose: () => void;
}) {
  const nameOf = (id: string) => members.find((member) => String(member.userId) === id)?.username ?? `user ${id}`;
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
  }, []);

  const lines = [
    ...ledger.map((row) => ({
      id: `l-${row.id}`,
      at: row.createdAt,
      title: ledgerTitle(row.kind),
      detail: ledgerDetail(row),
      who: row.username,
    })),
    ...audit
      .filter((row) => row.action !== "billing_mode" && row.action !== "fund" && row.action !== "add_balance" && row.action !== "remove_balance" && row.action !== "reset_balance" && row.action !== "member_limit")
      .map((row) => ({
        id: `a-${row.id}`,
        at: row.createdAt,
        title: auditTitle(row.action),
        detail: auditDetail(row.action, row.detail, nameOf),
        who: row.actor,
      })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <dialog ref={ref} className="ohf-team-activity-dialog" onClick={(event) => event.target === event.currentTarget && onClose()} onClose={onClose}>
      <div className="ohf-dialog-panel ohf-team-panel">
        <div className="ohf-keys-head">
          <div>
            <div className="ohf-keys-title">Activity</div>
            <p className="ohf-keys-copy">{teamName}</p>
          </div>
          <button type="button" className="ohf-icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>
        <div className="ohf-manage-body ohf-scroll ohf-team-body">
          {lines.length === 0 && <p className="ohf-keys-copy">No activity yet.</p>}
          <ul className="ohf-team-log">
            {lines.map((line) => (
              <li key={line.id}>
                <div>
                  <strong>{line.title}</strong>
                  <p>{line.detail}</p>
                </div>
                <div className="ohf-team-log-meta">
                  <span>{line.who || "System"}</span>
                  <time>{formatWhen(line.at)}</time>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </dialog>
  );
}

function ledgerTitle(kind: string): string {
  const titles: Record<string, string> = {
    fund: "Funds deposited",
    add: "Balance added",
    remove: "Balance removed",
    key_reset: "Balance cleared",
    usage: "Usage on own API key",
    reset: "Balance reset",
    hold: "Dollars reserved",
    spend: "Dollars spent",
    release: "Reservation released",
    mode: "Balance mode changed",
    limit: "Member limit updated",
  };
  return titles[kind] ?? "Balance update";
}

function ledgerDetail(row: TeamDesk["ledger"][number]): string {
  if (row.kind === "mode") return row.note === "member" ? "Switched to per-member balance" : "Switched to global team balance";
  if (row.kind === "limit") return `Limit set to ${formatUsd(row.afterCredits)}`;
  if (row.kind === "hold" || row.kind === "release") return formatUsd(row.credits);
  if (row.beforeCredits === row.afterCredits) return formatUsd(row.credits);
  return `${formatUsd(row.beforeCredits)} → ${formatUsd(row.afterCredits)}`;
}

function auditTitle(action: string): string {
  const titles: Record<string, string> = {
    create: "Team created",
    rename: "Team renamed",
    status: "Team status changed",
    invite: "Invitation sent",
    accept: "Invitation accepted",
    decline: "Invitation declined",
    revoke_invite: "Invitation revoked",
    remove: "Member removed",
    role: "Role changed",
    assign: "Member assigned",
    team_key_set: "Team key saved",
    team_key_clear: "Team key removed",
  };
  return titles[action] ?? "Team update";
}

function auditDetail(action: string, detail: string, nameOf: (id: string) => string): string {
  if (action === "role") {
    const [id, role] = detail.split(":");
    return `${nameOf(id ?? "")} is now ${role === "team_admin" ? "team admin" : "member"}`;
  }
  if (action === "assign") {
    const [username, role] = detail.split(":");
    return `${username} joined as ${role === "team_admin" ? "team admin" : "member"}`;
  }
  if (action === "remove" || action === "team_key_set" || action === "team_key_clear") return nameOf(detail);
  if (action === "status") return detail === "disabled" ? "Team disabled" : "Team active";
  return detail;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
