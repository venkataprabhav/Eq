#!/usr/bin/env node
/**
 * Reads checkbox sections in PROGRESS.md and rewrites the generated
 * progress bars in README.md plus SVG badges in docs/progress/.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const progressPath = join(root, "PROGRESS.md");
const readmePath = join(root, "README.md");
const svgDir = join(root, "docs", "progress");

const PLATFORMS = [
  { id: "chrome", label: "Chrome extension", href: "PROGRESS.md#chrome-extension", color: "#E8A54B" },
  { id: "desktop", label: "Desktop app", href: "PROGRESS.md#desktop-app", color: "#6EA8FE" },
  { id: "android", label: "Android", href: "PROGRESS.md#android", color: "#3DDC84" },
  { id: "ios", label: "iOS", href: "PROGRESS.md#ios", color: "#A78BFA" },
];

const MARK_START = "<!-- progress-bars:start -->";
const MARK_END = "<!-- progress-bars:end -->";

function countChecks(markdown, id) {
  const start = `<!-- platform:${id} -->`;
  const end = `<!-- /platform:${id} -->`;
  const from = markdown.indexOf(start);
  const to = markdown.indexOf(end);
  if (from === -1 || to === -1 || to <= from) {
    throw new Error(`Missing platform markers for "${id}" in PROGRESS.md`);
  }
  const block = markdown.slice(from, to);
  const items = [...block.matchAll(/^\s*- \[([ xX])\]/gm)];
  if (items.length === 0) {
    throw new Error(`No checkbox items found for "${id}"`);
  }
  const done = items.filter((match) => match[1].toLowerCase() === "x").length;
  return { done, total: items.length, percent: Math.round((done / items.length) * 100) };
}

function bar(percent, width = 20) {
  const filled = Math.round((percent / 100) * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function svgBadge(percent, color) {
  const width = 240;
  const height = 18;
  const inner = Math.max(percent > 0 ? 8 : 0, Math.round((percent / 100) * width));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="${percent}%">
  <rect width="${width}" height="${height}" rx="9" fill="#2A2A2A"/>
  <rect width="${inner}" height="${height}" rx="9" fill="${color}"/>
  <text x="${width / 2}" y="13" text-anchor="middle" fill="#F4F1EA" font-size="11" font-family="ui-sans-serif, system-ui, sans-serif">${percent}%</text>
</svg>
`;
}

function renderTable(stats) {
  const rows = stats
    .map(
      ({ platform, done, total, percent }) =>
        `| [${platform.label}](${platform.href}) | ![](docs/progress/${platform.id}.svg) \`${bar(percent)}\` **${percent}%** (${done}/${total}) |`,
    )
    .join("\n");

  return `${MARK_START}
| Platform | Progress |
| --- | --- |
${rows}

Tick boxes in [PROGRESS.md](PROGRESS.md), then run \`npm run progress\` or push — CI updates these bars.
${MARK_END}`;
}

const progress = readFileSync(progressPath, "utf8");
const stats = PLATFORMS.map((platform) => ({
  platform,
  ...countChecks(progress, platform.id),
}));

mkdirSync(svgDir, { recursive: true });
for (const row of stats) {
  writeFileSync(join(svgDir, `${row.platform.id}.svg`), svgBadge(row.percent, row.platform.color));
}

const readme = readFileSync(readmePath, "utf8");
if (!readme.includes(MARK_START) || !readme.includes(MARK_END)) {
  throw new Error("README.md is missing <!-- progress-bars:start --> / <!-- progress-bars:end --> markers");
}

const nextReadme = readme.replace(
  new RegExp(`${MARK_START}[\\s\\S]*?${MARK_END}`),
  renderTable(stats),
);
writeFileSync(readmePath, nextReadme);

for (const row of stats) {
  console.log(
    `${row.platform.label.padEnd(20)} ${bar(row.percent)}  ${String(row.percent).padStart(3)}%  (${row.done}/${row.total})`,
  );
}
