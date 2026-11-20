/**
 * Offline checks for @ mention tokens.
 *
 *   pnpm exec tsx scripts/mentions-selftest.ts
 */
import { mentionToken, parseMentionTokens, resolvePromptMentions, type PromptMention } from "@/generation/mentions";

let checks = 0;
let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  checks += 1;
  if (ok) {
    console.log(`ok  ${name}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

const portrait: PromptMention = {
  id: "up-1",
  kind: "image",
  label: "a]b portrait",
  url: "https://cdn.example/portrait.png",
};
const clip: PromptMention = {
  id: "run:abc:0",
  kind: "video",
  label: "dock at dusk",
  url: "https://cdn.example/dock.mp4",
};
const tone: PromptMention = {
  id: "up-audio",
  kind: "audio",
  label: "room tone",
  url: "https://cdn.example/tone.wav",
};

const token = mentionToken(portrait);
check("label with ] round-trips", parseMentionTokens(`see ${token}`)[0]?.label === "a]b portrait", token);
check("broken token stays text", parseMentionTokens("hello @[image:nope").length === 0);

const resolved = resolvePromptMentions({
  text: `Use ${token} and ${token} plus ${mentionToken(clip)} and ${mentionToken(tone)} and @[image:nope`,
  catalog: [portrait, clip, tone],
  roles: { reference: 1, video: 1 },
  existing: [],
});

check("id never reaches the model", !resolved.text.includes("up-1") && !resolved.text.includes("run:abc"));
check("sent mention keeps its label", resolved.text.includes("a]b portrait"));
check("duplicate is not a second file", resolved.additions.filter((item) => item.url === portrait.url).length === 1);
check("video fills the video role", resolved.additions.some((item) => item.role === "video" && item.url === clip.url));
check("unsupported audio is dropped from the prompt", !resolved.text.includes("room tone"));
check("half-typed token is left alone", resolved.text.includes("@[image:nope"));

const other: PromptMention = { ...portrait, id: "up-2", url: "https://cdn.example/other.png", label: "other" };
const full = resolvePromptMentions({
  text: `${mentionToken(portrait)} ${mentionToken(other)}`,
  catalog: [portrait, other],
  roles: { start: 1 },
  existing: [{ id: "tray", url: "https://cdn.example/held.png", role: "start" }],
});
check("a full role sends nothing more", full.additions.length === 0);
check("overflow stays visible as a label", full.chips.some((chip) => chip.status === "full" && chip.label === "other"));
check("a file already on the tray is a duplicate", full.chips.every((chip) => chip.status !== "sent"));

const held = resolvePromptMentions({
  text: mentionToken(portrait),
  catalog: [portrait],
  roles: { reference: 2 },
  existing: [{ id: "tray", url: portrait.url, role: "reference" }],
});
check("same url is not attached twice", held.additions.length === 0 && held.chips[0]?.status === "duplicate");

const named = resolvePromptMentions({
  text: "a rainy alley",
  catalog: [
    { ...portrait, label: "image1" },
    { id: "up-2", kind: "image", label: "image2", url: "https://cdn.example/other.png" },
  ],
  roles: { reference: 4 },
  existing: [{ id: "tray", url: portrait.url, role: "reference" }],
});
check("a stored mention is named for the model", named.text.startsWith("@image1 @image2"));
check("a stored mention does not leak its id", !named.text.includes("up-1") && !named.text.includes("up-2"));
check("a tray file named in the prompt is not attached again", named.additions.length === 1 && named.additions[0]?.url.endsWith("other.png"));

console.log(`\n${checks - failures}/${checks} passed`);
if (failures > 0) process.exit(1);
