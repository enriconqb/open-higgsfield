"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getAuthState } from "@/auth/actions";
import type { PublicUser } from "@/auth/types";
import { unwrap } from "@/lib/action-result";

export function ProfilePanel() {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);

  useEffect(() => {
    let live = true;
    void getAuthState().then(unwrap).then((state) => {
      if (!live) return;
      if (!state.user) {
        router.replace("/login");
        return;
      }
      setUser(state.user);
    });
    return () => {
      live = false;
    };
  }, [router]);

  if (!user) return <p className="ohf-keys-copy">Loading…</p>;

  return (
    <div className="ohf-auth-form">
      <dl className="ohf-profile">
        <div>
          <dt>Username</dt>
          <dd>{user.username}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{user.role}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{user.status}</dd>
        </div>
      </dl>
      <p className="ohf-auth-foot">
        <Link href="/tokens">API tokens</Link>
        {" · "}
        <Link href="/account">Change password</Link>
        {" · "}
        <Link href="/">Back to studio</Link>
      </p>
    </div>
  );
}
