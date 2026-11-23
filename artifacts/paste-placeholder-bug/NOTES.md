# Paste placeholder bug

## Goal
Rich paste into `.ohf-prompt` must hide placeholder and enable Generate.

## Repro (before)
1. Sign in, Image tab, focus Prompt.
2. insertHTML with nested `<b>` / `<div>` (chat-style rich paste).
3. Measured: placeholderVisible=true, serializedDirectChildren="", generateDisabled=true, childNodeTypes=["B","DIV","TEXT"].

## Root cause
`serialize()` in `src/openhiggsfield/prompt-field.tsx` only reads direct-child text nodes; nested paste HTML is ignored so React `text` stays empty.

## Evidence
- repro-before.png
