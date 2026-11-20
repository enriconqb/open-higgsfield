/**
 * Offline checks for @ mention tokens.
 *
 *   pnpm exec tsx scripts/mentions-selftest.ts
 */
import { mentionToken, parseMentionTokens, rebindPromptMentions, resolvePromptMentions, reuseAttachments, type PromptMention } from "@/generation/mentions";

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

const image1 = mentionToken({ id: "old-image", kind: "image", label: "image1" });
const video1 = mentionToken({ id: "old-video", kind: "video", label: "video1" });
const rebound = rebindPromptMentions(`gambar ini adalah ${image1} tapi sesuai dengan ${video1}`, [
  { id: "old-image", kind: "image", label: "image1", url: "https://cdn.example/old.png" },
  { id: "old-video", kind: "video", label: "video1", url: "https://cdn.example/old.mp4" },
], [
  { id: "new-image", url: "https://cdn.example/new.png", role: "reference" },
  { id: "new-video", url: "https://cdn.example/new.mp4", role: "video" },
]);
const reboundResolved = resolvePromptMentions({
  text: rebound.text,
  catalog: rebound.mentions,
  roles: { reference: 2, video: 1 },
  existing: [
    { id: "new-image", url: "https://cdn.example/new.png", role: "reference" },
    { id: "new-video", url: "https://cdn.example/new.mp4", role: "video" },
  ],
});
check("a replaced slot keeps the image1 label", rebound.text.includes(mentionToken({ id: "new-image", kind: "image", label: "image1" })));
check("a replaced slot keeps the video1 label", rebound.text.includes(mentionToken({ id: "new-video", kind: "video", label: "video1" })));
check("a replaced slot does not keep the old file id", !rebound.text.includes("old-image") && !rebound.text.includes("old-video"));
check("a file already on the tray is not attached a second time", reboundResolved.additions.length === 0);
check("rebound chips are not missing", reboundResolved.chips.every((chip) => chip.status !== "missing"));

const dropped = rebindPromptMentions(`ikuti ${video1}`, [
  { id: "old-video", kind: "video", label: "video1", url: "https://cdn.example/old.mp4" },
], [{ id: "new-image", url: "https://cdn.example/new.png", role: "reference" }]);
const droppedResolved = resolvePromptMentions({
  text: dropped.text,
  catalog: dropped.mentions,
  roles: { reference: 2, video: 1 },
  existing: [{ id: "new-image", url: "https://cdn.example/new.png", role: "reference" }],
});
check("a removed video slot stays written as video1", dropped.text.includes("video1"));
check("a removed video slot is missing", droppedResolved.chips.some((chip) => chip.status === "missing" && chip.label === "video1"));
check("a missing video adds no media", droppedResolved.additions.length === 0);

const reused = reuseAttachments(
  { reference: 3 },
  [
    { id: "other", url: "https://cdn.example/other.png", role: "reference" },
    { id: "extra", url: "https://cdn.example/extra.png", role: "reference" },
  ],
  [{ id: "portrait", kind: "image", label: "image1", url: "https://cdn.example/portrait.png" }],
);
check("reuse puts the tagged file in the image1 slot", reused[0]?.url === "https://cdn.example/portrait.png");
check("reuse keeps an untagged saved file", reused.some((item) => item.url.endsWith("extra.png")));
check("reuse does not keep the file the tag replaced", !reused.some((item) => item.url.endsWith("other.png")));

const onlyMention = reuseAttachments(
  { reference: 2 },
  [],
  [{ id: "portrait", kind: "image", label: "image1", url: "https://cdn.example/portrait.png" }],
);
check("a mention with no saved media is the first attachment", onlyMention.length === 1 && onlyMention[0]?.url.endsWith("portrait.png") && onlyMention[0]?.role === "reference");
check("a run with nothing attached clears the tray", reuseAttachments({ reference: 2 }, [], []).length === 0);

console.log(`\n${checks - failures}/${checks} passed`);
if (failures > 0) process.exit(1);
