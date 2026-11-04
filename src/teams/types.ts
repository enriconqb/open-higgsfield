export type TeamRole = "team_admin" | "member";
export type BillingMode = "global" | "member";
export type InviteStatus = "pending" | "accepted" | "declined" | "revoked" | "expired";

export type TeamSummary = {
  id: number;
  name: string;
  role: TeamRole;
  status: "active" | "disabled";
  billingMode: BillingMode;
};

export type TeamInviteView = {
  id: number;
  teamId: number;
  teamName: string;
  invitedBy: string;
  expiresAt: string;
};

export type TeamMemberView = {
  userId: number;
  username: string;
  role: TeamRole;
  hasOwnKey: boolean;
  hasTeamKey: boolean;
  limitCredits: number;
  spentCredits: number;
};

export type CreditSnapshot = {
  mode: BillingMode;
  funded: number;
  remaining: number;
  held: number;
  globalCap: number;
  mine: { limit: number; spent: number; held: number } | null;
  usesTeamBalance: boolean;
  low: boolean;
};

export type LedgerRow = {
  id: number;
  kind: string;
  credits: number;
  beforeCredits: number;
  afterCredits: number;
  username: string;
  note: string;
  createdAt: string;
};

export type AuditRow = {
  id: number;
  action: string;
  detail: string;
  actor: string;
  createdAt: string;
};
