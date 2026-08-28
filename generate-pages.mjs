#!/usr/bin/env node
// Wraps playwright-browsers-list.md (an HTML table) in a standalone
// index.html for GitHub Pages.
//
// Usage: node generate-pages.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TABLE_FILE = path.join(ROOT, 'playwright-browsers-list.md');
const SITE_DIR = path.join(ROOT, '_site');

export function generatePages({ tableFile = TABLE_FILE, siteDir = SITE_DIR } = {}) {
  const table = fs.readFileSync(tableFile, 'utf-8').trim();
  if (!table.includes('<table>') || !table.includes('</table>'))
    throw new Error(`${tableFile} does not contain an HTML table`);

  const versions = [...table.matchAll(/<strong>(v[^<]+)<\/strong>/g)].map(match => match[1]);
  const html = renderHtml({
    table,
    versionCount: versions.length,
    latest: versions.at(-1) ?? '',
  });

  fs.mkdirSync(siteDir, { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'index.html'), html);
  fs.writeFileSync(path.join(siteDir, '.nojekyll'), '');
  return path.join(siteDir, 'index.html');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderHtml({ table, versionCount, latest }) {
  const latestLabel = latest ? escapeHtml(latest) : 'n/a';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Playwright browsers list</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f4f1ea;
      --surface: #fffdf8;
      --ink: #1c1916;
      --muted: #5c564e;
      --line: #d8d0c4;
      --accent: #2f6f4e;
      --head: #2b2621;
      --stripe: #f7f1e7;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #161412;
        --surface: #201c18;
        --ink: #f3eee6;
        --muted: #b7aea2;
        --line: #3b342c;
        --accent: #8fceaa;
        --head: #f3eee6;
        --stripe: #1a1714;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
      background: var(--bg);
      color: var(--ink);
      line-height: 1.5;
    }
    header, footer, main { padding: 1.25rem 1.5rem; }
    header, footer {
      background: var(--surface);
      border-bottom: 1px solid var(--line);
    }
    footer { border-bottom: 0; border-top: 1px solid var(--line); color: var(--muted); }
    h1 {
      margin: 0 0 0.35rem;
      font-size: clamp(1.6rem, 3vw, 2.2rem);
      letter-spacing: -0.02em;
    }
    .lede, footer p { margin: 0; }
    .meta { color: var(--muted); margin: 0 0 1rem; }
    label { display: block; max-width: 28rem; }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    input[type="search"] {
      width: 100%;
      padding: 0.65rem 0.75rem;
      border: 1px solid var(--line);
      border-radius: 0.4rem;
      background: var(--bg);
      color: var(--ink);
      font: inherit;
    }
    .table-wrap {
      overflow: auto;
      max-height: calc(100vh - 8rem);
      border: 1px solid var(--line);
      border-radius: 0.5rem;
      background: var(--surface);
    }
    table {
      border-collapse: separate;
      border-spacing: 0;
      width: max-content;
      min-width: 100%;
      font-family: "Source Sans 3", "Segoe UI", sans-serif;
      font-size: 0.92rem;
    }
    th, td {
      padding: 0.45rem 0.7rem;
      border-bottom: 1px solid var(--line);
      border-right: 1px solid var(--line);
      vertical-align: top;
      white-space: nowrap;
    }
    th:last-child, td:last-child { border-right: 0; }
    thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--head);
      color: var(--bg);
      text-align: left;
    }
    tbody tr:nth-child(10n + 1),
    tbody tr:nth-child(10n + 2),
    tbody tr:nth-child(10n + 3),
    tbody tr:nth-child(10n + 4),
    tbody tr:nth-child(10n + 5) { background: var(--stripe); }
    td ul { margin: 0; padding-left: 1.1rem; white-space: normal; }
    #empty { color: var(--muted); }
    a { color: var(--accent); }
  </style>
</head>
<body>
  <header>
    <h1>Playwright browsers list</h1>
    <p class="lede">Browser versions bundled with each Playwright release.</p>
    <p class="meta">${versionCount} recorded release${versionCount === 1 ? '' : 's'}, latest <strong>${latestLabel}</strong>.</p>
    <label>
      <span class="visually-hidden">Filter releases</span>
      <input type="search" id="filter" placeholder="Filter by version or browser…" autocomplete="off">
    </label>
  </header>
  <main>
    <p id="empty" hidden>No releases match that filter.</p>
    <div class="table-wrap">
${table}
    </div>
  </main>
  <footer>
    <p>Generated from <code>playwright-browsers-list.md</code> on the <code>develop</code> branch.</p>
  </footer>
  <script>
    const input = document.getElementById('filter');
    const empty = document.getElementById('empty');
    const tableWrap = document.querySelector('.table-wrap');
    const groups = [];
    let current = null;
    for (const row of document.querySelectorAll('tbody tr')) {
      const version = row.querySelector('td[rowspan] strong');
      if (version) {
        current = { rows: [], text: version.textContent.toLowerCase() };
        groups.push(current);
      }
      if (!current) continue;
      current.rows.push(row);
      current.text += ' ' + row.textContent.toLowerCase();
    }
    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      let visible = 0;
      for (const group of groups) {
        const show = !query || group.text.includes(query);
        for (const row of group.rows) row.hidden = !show;
        if (show) visible += 1;
      }
      empty.hidden = visible !== 0;
      tableWrap.hidden = visible === 0;
    });
  </script>
</body>
</html>
`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const output = generatePages();
  console.log(`Wrote ${path.relative(ROOT, output)}`);
}
