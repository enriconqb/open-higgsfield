"use client";

import type { ReactNode } from "react";

import { GRAIN_URI } from "./artwork";

export function AuthShell({
  fontClassName = "",
  title,
  wide = false,
  children,
}: {
  fontClassName?: string;
  title: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`ohf ${fontClassName}`} style={{ "--ohf-grain": GRAIN_URI } as React.CSSProperties}>
      <div className="ohf-auth-page">
        <div className="ohf-auth-card" data-wide={wide ? "true" : undefined}>
          <h1 className="ohf-auth-title">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}
