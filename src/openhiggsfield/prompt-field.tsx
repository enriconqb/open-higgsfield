"use client";

import { forwardRef, useLayoutEffect, useRef, type KeyboardEvent } from "react";

import { mentionToken, parseMentionTokens, type PromptMention } from "@/generation/mentions";

/** The prompt as one editable line of words and atomic mention badges. */
export const PromptField = forwardRef<HTMLDivElement, {
  text: string;
  mentions: PromptMention[];
  placeholder: string;
  caretPin: { offset: number; nonce: number } | null;
  expanded: boolean;
  onPointerDown?: () => void;
  onText: (text: string) => void;
  onForget: (id: string) => void;
  onCaret: (text: string, caret: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}>(function PromptField({ text, mentions, placeholder, caretPin, expanded, onPointerDown, onText, onForget, onCaret, onKeyDown }, ref) {
  const localRef = useRef<HTMLDivElement>(null);
  const painted = useRef<string | null>(null);
  const placed = useRef<number | null>(null);
  const mentionsRef = useRef(mentions);
  mentionsRef.current = mentions;
  const ignoreDom = useRef(false);

  function root(): HTMLDivElement | null {
    return localRef.current;
  }

  function publish() {
    const el = root();
    if (!el || ignoreDom.current) return;
    const next = serialize(el, mentionsRef.current);
    const keep = new Set(parseMentionTokens(next).map((token) => token.id));
    for (const mention of mentionsRef.current) {
      if (!keep.has(mention.id)) onForget(mention.id);
    }
    painted.current = next;
    if (next !== text) onText(next);
    const caret = caretOffset(el, next);
    onCaret(next, caret);
  }

  useLayoutEffect(() => {
    const el = root();
    if (!el) return;
    if (painted.current !== text) {
      paint(el, text, mentions, () => publish());
      painted.current = text;
    }
    if (caretPin && placed.current !== caretPin.nonce) {
      placeCaret(el, text, caretPin.offset);
      placed.current = caretPin.nonce;
      el.focus();
    }
  }, [caretPin, mentions, text]);

  return (
    <div className="ohf-prompt-wrap">
    {text.length === 0 ? (
      <span className="ohf-prompt-placeholder" aria-hidden>
        {placeholder}
      </span>
    ) : null}
    <div
      ref={(node) => {
        localRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      className="ohf-prompt"
      role="textbox"
      aria-label="Prompt"
      aria-multiline="true"
      aria-expanded={expanded}
      aria-autocomplete="list"
      contentEditable
      suppressContentEditableWarning
      onPointerDown={onPointerDown}
      onClick={() => {
        const el = root();
        if (!el) return;
        onCaret(serialize(el, mentionsRef.current), caretOffset(el, painted.current ?? text));
      }}
      onKeyUp={() => {
        if (ignoreDom.current) {
          ignoreDom.current = false;
          return;
        }
        const el = root();
        if (!el) return;
        onCaret(serialize(el, mentionsRef.current), caretOffset(el, painted.current ?? text));
      }}
      onBeforeInput={(event) => {
        const native = event.nativeEvent as InputEvent;
        if (expanded && native.inputType === "insertParagraph") event.preventDefault();
      }}
      onInput={publish}
      onKeyDown={(event) => {
        const el = root();
        if (!el) return;
        if (expanded && event.key === "Enter" && !event.metaKey && !event.ctrlKey) ignoreDom.current = true;
        if (event.key === "Backspace" || event.key === "Delete") {
          const chip = chipBeside(el, event.key === "Backspace" ? -1 : 1);
          if (chip) {
            event.preventDefault();
            chip.remove();
            publish();
            return;
          }
        }
        onKeyDown(event);
      }}
    />
    </div>
  );
});

/** Spaces at the edge of a text run collapse in the editor, so they are drawn as non-breaking spaces. */
function visibleSpaces(value: string): string {
  return value.replace(/^ +| +$/g, (spaces) => "\u00a0".repeat(spaces.length));
}

function paint(root: HTMLDivElement, text: string, mentions: PromptMention[], onDrop: () => void) {
  const byId = new Map(mentions.map((mention) => [mention.id, mention]));
  const tokens = parseMentionTokens(text);
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const token of tokens) {
    fragment.append(document.createTextNode(visibleSpaces(text.slice(cursor, token.start))));
    cursor = token.end;
    const mention = byId.get(token.id);
    const badge = document.createElement("span");
    badge.className = "ohf-mention";
    badge.contentEditable = "false";
    badge.dataset.mentionId = token.id;
    const preview = document.createElement(token.kind === "video" ? "video" : "img");
    preview.className = "ohf-mention-preview";
    if (mention?.url) preview.setAttribute("src", mention.url);
    if (preview instanceof HTMLVideoElement) {
      preview.muted = true;
      preview.playsInline = true;
      preview.preload = "metadata";
    } else {
      preview.alt = "";
    }
    const labelText = `@${mention?.label ?? token.label}`;
    const thumb = document.createElement("span");
    thumb.className = "ohf-mention-thumb";
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "ohf-mention-x";
    dismiss.setAttribute("aria-label", `Remove ${labelText}`);
    dismiss.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
    let dropped = false;
    const drop = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (dropped) return;
      dropped = true;
      badge.remove();
      onDrop();
    };
    dismiss.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    dismiss.addEventListener("pointerup", drop);
    dismiss.addEventListener("click", drop);
    thumb.append(preview, dismiss);
    const label = document.createElement("span");
    label.className = "ohf-mention-label";
    label.textContent = labelText;
    badge.append(thumb, label);
    fragment.append(badge);
  }
  fragment.append(document.createTextNode(visibleSpaces(text.slice(cursor))));
  root.replaceChildren(fragment);
}

function serialize(root: HTMLElement, mentions: PromptMention[]): string {
  const byId = new Map(mentions.map((mention) => [mention.id, mention]));
  let out = "";
  for (const node of root.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? "").replace(/\u00a0/g, " ");
      continue;
    }
    if (node instanceof HTMLElement && node.dataset.mentionId) {
      const mention = byId.get(node.dataset.mentionId);
      if (mention) out += mentionToken(mention);
    }
  }
  return out;
}

function caretOffset(root: HTMLElement, text: string): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.anchorNode || !root.contains(selection.anchorNode)) {
    return text.length;
  }
  const tokens = parseMentionTokens(text);
  let tokenIndex = 0;
  let seen = 0;
  if (selection.anchorNode === root) {
    for (let index = 0; index < selection.anchorOffset && index < root.childNodes.length; index += 1) {
      seen += childLength(root.childNodes[index]!, tokens, tokenIndex);
      if (root.childNodes[index] instanceof HTMLElement && (root.childNodes[index] as HTMLElement).dataset.mentionId) {
        tokenIndex += 1;
      }
    }
    return seen;
  }
  for (const child of root.childNodes) {
    if (child === selection.anchorNode) {
      if (child.nodeType === Node.TEXT_NODE) return seen + selection.anchorOffset;
      return seen + childLength(child, tokens, tokenIndex);
    }
    if (child.contains(selection.anchorNode)) return seen + childLength(child, tokens, tokenIndex);
    const len = childLength(child, tokens, tokenIndex);
    seen += len;
    if (child instanceof HTMLElement && child.dataset.mentionId) tokenIndex += 1;
  }
  return seen;
}

function childLength(node: Node, tokens: { start: number; end: number }[], tokenIndex: number): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\u00a0/g, " ").length;
  if (node instanceof HTMLElement && node.dataset.mentionId) {
    const token = tokens[tokenIndex];
    return token ? token.end - token.start : 0;
  }
  return 0;
}

function placeCaret(root: HTMLElement, text: string, offset: number) {
  const tokens = parseMentionTokens(text);
  let tokenIndex = 0;
  let seen = 0;
  const selection = window.getSelection();
  const range = document.createRange();
  for (const child of root.childNodes) {
    const len = childLength(child, tokens, tokenIndex);
    if (child.nodeType === Node.TEXT_NODE && seen + len >= offset) {
      range.setStart(child, Math.max(0, offset - seen));
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    if (seen + len >= offset) {
      range.setStartAfter(child);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    seen += len;
    if (child instanceof HTMLElement && child.dataset.mentionId) tokenIndex += 1;
  }
  range.selectNodeContents(root);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** The badge touching a collapsed caret, behind it or ahead of it. */
function chipBeside(root: HTMLElement, direction: -1 | 1): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed || !selection.anchorNode || !root.contains(selection.anchorNode)) return null;
  if (selection.anchorNode === root) {
    const index = direction === -1 ? selection.anchorOffset - 1 : selection.anchorOffset;
    const child = root.childNodes[index];
    return child instanceof HTMLElement && child.dataset.mentionId ? child : null;
  }
  const node = selection.anchorNode;
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    const edge = direction === -1 ? selection.anchorOffset === 0 : selection.anchorOffset === text.length;
    if (!edge) return null;
    const sibling = direction === -1 ? node.previousSibling : node.nextSibling;
    return sibling instanceof HTMLElement && sibling.dataset.mentionId ? sibling : null;
  }
  return null;
}
