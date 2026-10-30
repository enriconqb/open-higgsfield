"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PublicUser } from "@/auth/types";

import { VIEWS, VIEW_LABELS, type GalleryView } from "./data";
import { AssetsIcon, CompareIcon, HeartIcon, ImageIcon, KeyIcon, TimelineIcon, UserIcon, VideoIcon } from "./icons";

const VIEW_ICONS: Record<GalleryView, () => React.ReactNode> = {
  image: () => <ImageIcon />,
  video: () => <VideoIcon />,
  assets: () => <AssetsIcon />,
  favorites: () => <HeartIcon size={15} />,
  timeline: () => <TimelineIcon />,
  compare: () => <CompareIcon />,
};

export function Topbar({
  view,
  onView,
  busy,
  keyConfigured,
  onKeys,
  user,
  onLogout,
}: {
  view: GalleryView;
  onView: (next: GalleryView) => void;
  busy: boolean;
  keyConfigured: boolean;
  onKeys: () => void;
  user: PublicUser | null;
  onLogout: () => void;
}) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  /* The indicator is measured rather than derived from equal columns, so it
     morphs to each label's real width instead of padding the short ones. */
  useEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return;
    let live = true;
    const measure = () => {
      const active = tabs.querySelector<HTMLElement>('[aria-selected="true"]');
      if (live && active) setThumb({ x: active.offsetLeft, w: active.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tabs);
    // Inter swaps in after first paint and the labels resize under it.
    void document.fonts.ready.then(measure);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [view]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const from = VIEWS.indexOf(view);
      const to =
        event.key === "ArrowRight"
          ? (from + 1) % VIEWS.length
          : event.key === "ArrowLeft"
            ? (from - 1 + VIEWS.length) % VIEWS.length
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? VIEWS.length - 1
                : -1;
      if (to < 0) return;
      event.preventDefault();
      onView(VIEWS[to]!);
      tabsRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
    },
    [onView, view],
  );

  return (
    <div className="ohf-topbar">
      <h1 className="ohf-sr">Vicend VTA AI — Open source AI studio</h1>

      <div className="ohf-bar ohf-enter-1">
        <div
          className="ohf-tabs"
          role="tablist"
          aria-label="Gallery scope"
          ref={tabsRef}
          onKeyDown={onKeyDown}
        >
          <span
            className="ohf-thumb"
            data-ready={thumb !== null}
            aria-hidden
            style={
              {
                "--thumb-x": `${thumb?.x ?? 0}px`,
                "--thumb-w": `${thumb?.w ?? 0}px`,
              } as React.CSSProperties
            }
          />
          {VIEWS.map((id) => {
            const selected = view === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`ohf-tab-${id}`}
                aria-selected={selected}
                aria-controls="ohf-panel"
                tabIndex={selected ? 0 : -1}
                className="ohf-tab"
                data-view={id}
                /* Favorites is the one scope that goes icon-only on a narrow
                   pill, so its name is stated rather than left to the mark. */
                aria-label={VIEW_LABELS[id]}
                title={id === "favorites" ? VIEW_LABELS[id] : undefined}
                onClick={() => onView(id)}
              >
                {VIEW_ICONS[id]()}
                <span className="ohf-tab-label">{VIEW_LABELS[id]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="ohf-bar ohf-enter-1 ohf-topbar-actions">
        {user ? (
          <>
            <button
              type="button"
              className="ohf-key"
              data-busy={busy}
              data-ready={keyConfigured}
              onClick={onKeys}
              aria-label={keyConfigured ? "Edit platform key" : "Add platform key"}
              title={keyConfigured ? "Edit platform key" : "Add platform key"}
            >
              <KeyIcon />
              <span className="ohf-key-text">{keyConfigured ? "Your key" : "Add key"}</span>
              <span className="ohf-lamp" />
            </button>
            <div className="ohf-user-menu" ref={menuRef}>
              <button
                type="button"
                className="ohf-key"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                onClick={() => setMenuOpen((open) => !open)}
              >
                <UserIcon />
                <span className="ohf-key-text">{user.username}</span>
              </button>
              {menuOpen && (
                <div className="ohf-user-panel" role="menu">
                  <Link href="/profile" role="menuitem" className="ohf-user-item" onClick={() => setMenuOpen(false)}>
                    Profile
                  </Link>
                  <Link href="/tokens" role="menuitem" className="ohf-user-item" onClick={() => setMenuOpen(false)}>
                    API tokens
                  </Link>
                  <Link href="/account" role="menuitem" className="ohf-user-item" onClick={() => setMenuOpen(false)}>
                    Change password
                  </Link>
                  <Link href="/usage" role="menuitem" className="ohf-user-item" onClick={() => setMenuOpen(false)}>
                    Usage
                  </Link>
                  <Link href="/templates" role="menuitem" className="ohf-user-item" onClick={() => setMenuOpen(false)}>
                    Prompt templates
                  </Link>
                  {user.role === "superadmin" && (
                    <Link href="/admin" role="menuitem" className="ohf-user-item" onClick={() => setMenuOpen(false)}>
                      Users management
                    </Link>
                  )}
                  {user.role === "superadmin" && (
                    <Link href="/admin/models" role="menuitem" className="ohf-user-item" onClick={() => setMenuOpen(false)}>
                      Model management
                    </Link>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="ohf-user-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout();
                    }}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <Link href="/login" className="ohf-key ohf-key-link" title="Sign in to generate">
            <UserIcon />
            <span className="ohf-key-text">Sign in</span>
          </Link>
        )}
      </div>
    </div>
  );
}
