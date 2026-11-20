import type { MediaItem, MediaRole } from "./catalog/types";

/** Coarser than a media role: one asset kind can fill several roles. */
export type MentionKind = "image" | "video" | "audio";

export type PromptMention = {
  id: string;
  kind: MentionKind;
  label: string;
  url: string;
};

export type MentionToken = {
  start: number;
  end: number;
  id: string;
  kind: MentionKind;
  label: string;
};

export type MentionStatus = "sent" | "full" | "unsupported" | "missing" | "duplicate";

export type MentionChip = MentionToken & { status: MentionStatus; url?: string };

const TOKEN = /@\[(image|video|audio):([^|\]]+)\|([^\]]*)\]/g;

const ROLE_PREFERENCE: Record<MentionKind, readonly MediaRole[]> = {
  image: ["reference", "start", "end"],
  video: ["video"],
  audio: ["audio"],
};

export function mentionToken(mention: Pick<PromptMention, "id" | "kind" | "label">): string {
  return `@[${mention.kind}:${mention.id}|${encodeURIComponent(mention.label)}]`;
}

/** Complete tokens only. A half-typed `@[image:` stays ordinary text. */
export function parseMentionTokens(text: string): MentionToken[] {
  const found: MentionToken[] = [];
  TOKEN.lastIndex = 0;
  let match = TOKEN.exec(text);
  while (match) {
    let label = match[3] ?? "";
    try {
      label = decodeURIComponent(label);
    } catch {
      /* keep the raw label when the escape is broken */
    }
    found.push({
      start: match.index,
      end: match.index + match[0].length,
      kind: match[1] as MentionKind,
      id: match[2] ?? "",
      label,
    });
    match = TOKEN.exec(text);
  }
  return found;
}

/** Where an `@` query is open, if the caret is inside one. */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && /[\w.]/.test(before[at - 1] ?? "")) return null;
  const slice = before.slice(at);
  if (slice.startsWith("@[")) return null;
  if (/\s/.test(slice.slice(1))) return null;
  return { start: at, query: slice.slice(1) };
}

export function resolvePromptMentions(input: {
  text: string;
  catalog: PromptMention[];
  roles: Partial<Record<MediaRole, number>>;
  existing: MediaItem[];
}): { text: string; additions: MediaItem[]; chips: MentionChip[] } {
  const tokens = parseMentionTokens(input.text);
  if (tokens.length === 0) return resolveCatalog(input);
  const byId = new Map(input.catalog.map((mention) => [mention.id, mention]));
  const used: Partial<Record<MediaRole, number>> = {};
  const seenUrl = new Set<string>();
  for (const item of input.existing) {
    used[item.role] = (used[item.role] ?? 0) + 1;
    seenUrl.add(item.url);
  }
  const seenId = new Set<string>();
  const additions: MediaItem[] = [];
  const chips: MentionChip[] = [];
  let cursor = 0;
  let text = "";

  for (const token of tokens) {
    text += input.text.slice(cursor, token.start);
    cursor = token.end;
    const mention = byId.get(token.id);
    const status = statusOf(token, mention, input.roles, used, seenId, seenUrl);
    chips.push({ ...token, status });
    if (status === "unsupported" || status === "missing") continue;
    text += token.label;
    if (status !== "sent" || !mention) continue;
    const role = pickRole(token.kind, input.roles, used);
    if (!role) continue;
    used[role] = (used[role] ?? 0) + 1;
    seenId.add(token.id);
    seenUrl.add(mention.url);
    additions.push({ id: `mention:${token.id}`, url: mention.url, role });
  }
  text += input.text.slice(cursor);
  return { text, additions, chips };
}

/** Mentions kept beside the words, with no token left in the sentence. */
function resolveCatalog(input: {
  text: string;
  catalog: PromptMention[];
  roles: Partial<Record<MediaRole, number>>;
  existing: MediaItem[];
}): { text: string; additions: MediaItem[]; chips: MentionChip[] } {
  const used: Partial<Record<MediaRole, number>> = {};
  const seenUrl = new Set<string>();
  for (const item of input.existing) {
    used[item.role] = (used[item.role] ?? 0) + 1;
    seenUrl.add(item.url);
  }
  const seenId = new Set<string>();
  const additions: MediaItem[] = [];
  const chips: MentionChip[] = [];
  const labels: string[] = [];
  for (const mention of input.catalog) {
    const token: MentionToken = { start: 0, end: 0, id: mention.id, kind: mention.kind, label: mention.label };
    const status = statusOf(token, mention, input.roles, used, seenId, seenUrl);
    chips.push({ ...token, status, url: mention.url });
    if (status === "unsupported" || status === "missing") continue;
    labels.push(`@${mention.label}`);
    if (status !== "sent") continue;
    const role = pickRole(mention.kind, input.roles, used);
    if (!role) continue;
    used[role] = (used[role] ?? 0) + 1;
    seenId.add(mention.id);
    seenUrl.add(mention.url);
    additions.push({ id: `mention:${mention.id}`, url: mention.url, role });
  }
  const prefix = labels.join(" ");
  const text = prefix && input.text.trim() ? `${prefix} ${input.text}` : prefix || input.text;
  return { text, additions, chips };
}

function statusOf(
  token: MentionToken,
  mention: PromptMention | undefined,
  roles: Partial<Record<MediaRole, number>>,
  used: Partial<Record<MediaRole, number>>,
  seenId: Set<string>,
  seenUrl: Set<string>,
): MentionStatus {
  if (!mention || mention.kind !== token.kind || !mention.url) return "missing";
  const supported = ROLE_PREFERENCE[token.kind].some((role) => (roles[role] ?? 0) > 0);
  if (!supported) return "unsupported";
  if (seenId.has(token.id) || seenUrl.has(mention.url)) return "duplicate";
  if (!pickRole(token.kind, roles, used)) return "full";
  return "sent";
}

function pickRole(
  kind: MentionKind,
  roles: Partial<Record<MediaRole, number>>,
  used: Partial<Record<MediaRole, number>>,
): MediaRole | null {
  for (const role of ROLE_PREFERENCE[kind]) {
    const max = roles[role] ?? 0;
    if (max > 0 && (used[role] ?? 0) < max) return role;
  }
  return null;
}

export function pruneMentions(text: string, mentions: PromptMention[], extra?: PromptMention): PromptMention[] {
  const ids = new Set(parseMentionTokens(text).map((token) => token.id));
  const next = extra ? [...mentions.filter((mention) => mention.id !== extra.id), extra] : mentions;
  return next.filter((mention) => ids.has(mention.id));
}

const KIND_OF_ROLE: Record<MediaRole, MentionKind> = {
  start: "image",
  end: "image",
  reference: "image",
  video: "video",
  audio: "audio",
};

/** Tray order, numbered per kind: the first image is image1, the first video is video1. */
export function mentionSlots(items: MediaItem[]): PromptMention[] {
  const counts: Partial<Record<MentionKind, number>> = {};
  return items.map((item) => {
    const kind = KIND_OF_ROLE[item.role];
    counts[kind] = (counts[kind] ?? 0) + 1;
    return { id: item.id, kind, label: `${kind}${counts[kind]}`, url: item.url };
  });
}

function slotIndex(label: string): number {
  const match = /(\d+)$/.exec(label);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function keepable(url: string): boolean {
  return url.length > 0 && !url.startsWith("blob:") && !url.startsWith("data:");
}

/**
 * Files for a reused run. A mention owns the slot in its label, so @image1 is the
 * first image even when the saved tray held a different file there. Untagged saved
 * files fill the slots still open. Nothing saved and nothing tagged yields an empty tray.
 */
export function reuseAttachments(
  roles: Partial<Record<MediaRole, number>>,
  media: MediaItem[],
  mentions: PromptMention[],
): MediaItem[] {
  const bySlot = new Map<string, PromptMention>();
  for (const mention of mentions) {
    if (!keepable(mention.url)) continue;
    const key = `${mention.kind}:${mention.label}`;
    if (!bySlot.has(key)) bySlot.set(key, mention);
  }

  const used: Partial<Record<MediaRole, number>> = {};
  const seenUrl = new Set<string>();
  const result: MediaItem[] = [];
  const placed = new Set<string>();

  const push = (item: MediaItem): boolean => {
    const max = roles[item.role] ?? 0;
    if (max <= 0 || (used[item.role] ?? 0) >= max) return false;
    if (!keepable(item.url) || seenUrl.has(item.url)) return false;
    used[item.role] = (used[item.role] ?? 0) + 1;
    seenUrl.add(item.url);
    result.push(item);
    return true;
  };

  const counts: Partial<Record<MentionKind, number>> = {};
  for (const item of media) {
    const kind = KIND_OF_ROLE[item.role];
    counts[kind] = (counts[kind] ?? 0) + 1;
    const label = `${kind}${counts[kind]}`;
    const key = `${kind}:${label}`;
    const mention = bySlot.get(key);
    if (mention) {
      if (push({ id: mention.id, url: mention.url, role: item.role })) placed.add(key);
      continue;
    }
    push(item);
  }

  const pending = [...bySlot.entries()]
    .filter(([key]) => !placed.has(key))
    .sort((left, right) => slotIndex(left[0]) - slotIndex(right[0]) || left[0].localeCompare(right[0]));
  for (const [, mention] of pending) {
    const role = pickRole(mention.kind, roles, used);
    if (!role) continue;
    push({ id: mention.id, url: mention.url, role });
  }
  return result;
}

/**
 * Point each @image1 / @video1 / @audio1 token at the file that currently owns that slot.
 * A token whose slot is empty keeps its text and loses its url, so resolve marks it missing.
 */
export function sameMentionList(left: PromptMention[], right: PromptMention[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((mention, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      mention.id === other.id &&
      mention.kind === other.kind &&
      mention.label === other.label &&
      mention.url === other.url
    );
  });
}

export function rebindPromptMentions(
  text: string,
  mentions: PromptMention[],
  items: MediaItem[],
): { text: string; mentions: PromptMention[] } {
  const tokens = parseMentionTokens(text);
  if (tokens.length === 0) return { text, mentions };
  const byLabel = new Map(mentionSlots(items).map((slot) => [`${slot.kind}:${slot.label}`, slot]));
  let next = "";
  let cursor = 0;
  const kept: PromptMention[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    next += text.slice(cursor, token.start);
    cursor = token.end;
    const slot = byLabel.get(`${token.kind}:${token.label}`);
    if (slot) {
      next += mentionToken(slot);
      if (!seen.has(slot.id)) {
        seen.add(slot.id);
        kept.push(slot);
      }
      continue;
    }
    next += text.slice(token.start, token.end);
    if (seen.has(token.id)) continue;
    seen.add(token.id);
    const prior = mentions.find((mention) => mention.id === token.id && mention.kind === token.kind);
    kept.push({
      id: token.id,
      kind: token.kind,
      label: prior?.label || token.label,
      url: "",
    });
  }
  next += text.slice(cursor);
  return { text: next, mentions: kept };
}
