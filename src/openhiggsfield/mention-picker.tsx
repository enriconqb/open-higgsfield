"use client";

import type { MediaItem } from "@/generation/catalog";
import type { MentionChip, PromptMention } from "@/generation/mentions";

import { ROLE_KINDS } from "./data";
import { CloseIcon } from "./icons";

const CHIP_REASON: Record<MentionChip["status"], string> = {
  sent: "Attached with this prompt",
  full: "This model has no free slot for another file of this kind",
  unsupported: "This model does not accept this kind of file",
  missing: "This mention no longer has a file",
  duplicate: "This file is already attached",
};

export function MentionChips({
  chips,
  onRemove,
}: {
  chips: MentionChip[];
  onRemove: (chip: MentionChip) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="ohf-mentions">
      {chips.map((chip) => (
        <span
          key={`${chip.id}:${chip.start}`}
          className="ohf-mention"
          data-off={chip.status !== "sent" || undefined}
          title={CHIP_REASON[chip.status]}
        >
          <MentionPreview kind={chip.kind} url={chip.url} label={chip.label} />
          <span className="ohf-mention-label">@{chip.label}</span>
          <button type="button" className="ohf-mention-x" aria-label={`Remove ${chip.label}`} onClick={() => onRemove(chip)}>
            <CloseIcon size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}

export function MentionMenu({
  choices,
  active,
  onPick,
}: {
  choices: PromptMention[];
  active: number;
  onPick: (choice: PromptMention) => void;
}) {
  if (choices.length === 0) {
    return <div className="ohf-mention-menu">No attached references</div>;
  }
  return (
    <div className="ohf-mention-menu" role="listbox">
      {choices.map((choice, index) => (
        <button
          key={choice.id}
          type="button"
          role="option"
          aria-selected={index === active}
          className="ohf-mention-option"
          data-on={index === active || undefined}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(choice);
          }}
        >
          <MentionPreview kind={choice.kind} url={choice.url} label={choice.label} />
          <span className="ohf-mention-label">@{choice.label}</span>
        </button>
      ))}
    </div>
  );
}

function MentionPreview({ kind, url, label }: { kind: PromptMention["kind"]; url?: string; label: string }) {
  if (!url) return null;
  if (kind === "video") {
    return <video className="ohf-mention-preview" src={url} muted playsInline preload="metadata" aria-label={label} />;
  }
  return <img className="ohf-mention-preview" src={url} alt="" />;
}

export function mentionChoices(items: MediaItem[], query: string): PromptMention[] {
  const needle = query.trim().toLowerCase().replace(/^@/, "");
  const counts: Partial<Record<PromptMention["kind"], number>> = {};
  return items
    .map((item) => {
      const kind = ROLE_KINDS[item.role];
      counts[kind] = (counts[kind] ?? 0) + 1;
      return { id: item.id, kind, label: `${kind}${counts[kind]}`, url: item.url };
    })
    .filter((choice) => needle.length === 0 || choice.label.toLowerCase().includes(needle))
    .slice(0, 8);
}

