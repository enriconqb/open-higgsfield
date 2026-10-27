import { readFileSync } from "node:fs";

const video = await (await fetch("https://openrouter.ai/api/v1/videos/models")).json();
const image = await (await fetch("https://openrouter.ai/api/v1/images/models")).json();
const text =
  readFileSync("src/generation/catalog/openrouter-slugs.ts", "utf8") +
  readFileSync("src/generation/catalog/openrouter-extra.ts", "utf8");
const set = new Set([...text.matchAll(/"([a-z0-9_.-]+\/[a-z0-9_.-]+)"/g)].map((match) => match[1]));
const all = [...video.data, ...image.data].map((model) => model.id);
console.log(all.filter((id) => !set.has(id)));
