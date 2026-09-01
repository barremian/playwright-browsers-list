#!/usr/bin/env node
// Parses playwright-browsers-list.md (an HTML property matrix) and writes a
// standalone index.html: one row per Playwright release, models.dev-style chrome.
//
// Usage: node generate-pages.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TABLE_FILE = path.join(ROOT, 'playwright-browsers-list.md');
const SITE_DIR = path.join(ROOT, '_site');

const REPO_URL = 'https://github.com/barremian/playwright-browsers-list';
const PLAYWRIGHT_URL = 'https://github.com/microsoft/playwright';
const DOCS_URL = 'https://playwright.dev/docs/browsers';
const LUCIDE_ICON = name => `https://cdn.jsdelivr.net/npm/lucide-static@1.39.0/icons/${name}.svg`;
const GITHUB_ICON = 'https://cdn.jsdelivr.net/npm/simple-icons@16.24.1/icons/github.svg';

export const EXTRA_BROWSERS = new Set(['ffmpeg', 'winldd', 'android']);

const BROWSER_LABELS = {
  chromium: 'Chromium',
  'chromium-headless-shell': 'Headless shell',
  firefox: 'Firefox',
  webkit: 'WebKit',
  ffmpeg: 'ffmpeg',
  winldd: 'winldd',
  android: 'android',
};

export function generatePages({ tableFile = TABLE_FILE, siteDir = SITE_DIR } = {}) {
  const source = fs.readFileSync(tableFile, 'utf-8');
  if (!source.includes('<table>') || !source.includes('</table>'))
    throw new Error(`${tableFile} does not contain an HTML table`);

  const releases = parseBrowsersTable(source);
  if (!releases.length)
    throw new Error(`${tableFile} does not contain any Playwright releases`);

  const newestFirst = [...releases].sort((a, b) => compareVersions(b.version, a.version));
  markChanges(newestFirst);

  const html = renderHtml({
    releases: newestFirst,
    versionCount: newestFirst.length,
    latest: newestFirst[0].version,
  });

  fs.mkdirSync(siteDir, { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'index.html'), html);
  fs.writeFileSync(path.join(siteDir, '.nojekyll'), '');
  return path.join(siteDir, 'index.html');
}

export function parseVersion(tag) {
  const match = String(tag).match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match)
    return null;
  const [, major, minor, patch, prerelease] = match;
  return { major: +major, minor: +minor, patch: +patch, prerelease: prerelease ?? null };
}

export function compareVersions(tagA, tagB) {
  const a = parseVersion(tagA);
  const b = parseVersion(tagB);
  if (!a || !b)
    return String(tagA).localeCompare(String(tagB));
  if (a.major !== b.major)
    return a.major - b.major;
  if (a.minor !== b.minor)
    return a.minor - b.minor;
  if (a.patch !== b.patch)
    return a.patch - b.patch;
  if (a.prerelease === b.prerelease)
    return 0;
  if (a.prerelease === null)
    return 1;
  if (b.prerelease === null)
    return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

export function parseBrowsersTable(html) {
  const tableMatch = html.match(/<table>[\s\S]*<\/table>/);
  if (!tableMatch)
    throw new Error('could not find an HTML table');

  const table = tableMatch[0];
  const head = table.match(/<thead>[\s\S]*?<\/thead>/);
  const body = table.match(/<tbody>[\s\S]*?<\/tbody>/);
  if (!head || !body)
    throw new Error('table is missing thead or tbody');

  const headers = [...head[0].matchAll(/<th>([^<]*)<\/th>/g)].map(match => match[1].trim());
  const browsers = headers.slice(2);
  if (!browsers.length)
    throw new Error('table has no browser columns');

  const rows = extractRows(body[0]);
  const releases = [];

  for (let index = 0; index < rows.length; ) {
    const first = rows[index];
    const versionCell = first.find(cell => cell.rowspan);
    if (!versionCell) {
      index += 1;
      continue;
    }

    const rowspan = versionCell.rowspan;
    const group = rows.slice(index, index + rowspan);
    index += rowspan;

    const properties = {};
    for (const cells of group) {
      const property = (cells[0].rowspan ? cells[1] : cells[0])?.text;
      if (!property)
        continue;
      const values = cells.slice(cells[0].rowspan ? 2 : 1);
      properties[property] = Object.fromEntries(browsers.map((name, i) => [name, values[i]?.text ?? '-']));
    }

    const version = stripTags(versionCell.text).trim();
    releases.push({
      version,
      browsers: Object.fromEntries(browsers.map(name => [name, {
        name,
        extra: EXTRA_BROWSERS.has(name),
        revision: blankToNull(properties.revision?.[name]),
        browserVersion: blankToNull(properties.browserVersion?.[name]),
        installByDefault: parseBoolean(properties.installByDefault?.[name]),
        title: blankToNull(properties.title?.[name]),
        revisionOverrides: parseOverrides(properties.revisionOverrides?.[name] ?? ''),
      }])),
    });
  }

  return releases;
}

export function markChanges(releasesNewestFirst) {
  for (let index = 0; index < releasesNewestFirst.length; index += 1) {
    const current = releasesNewestFirst[index];
    const older = releasesNewestFirst[index + 1];
    for (const browser of Object.values(current.browsers)) {
      const previous = older?.browsers[browser.name];
      browser.changed = Boolean(previous && browserFingerprint(browser) !== browserFingerprint(previous));
    }
  }
  return releasesNewestFirst;
}

function browserFingerprint(browser) {
  return `${browser.browserVersion ?? ''}\0${browser.revision ?? ''}`;
}

function extractRows(tbody) {
  return [...tbody.matchAll(/<tr>[\s\S]*?<\/tr>/g)].map(match => extractCells(match[0]));
}

function extractCells(rowHtml) {
  const cells = [];
  const td = /<td\b([^>]*)>([\s\S]*?)<\/td>/g;
  let match;
  while ((match = td.exec(rowHtml))) {
    const attrs = match[1];
    const rowspanMatch = attrs.match(/rowspan="(\d+)"/);
    cells.push({
      text: match[2].trim(),
      rowspan: rowspanMatch ? Number(rowspanMatch[1]) : 0,
    });
  }
  return cells;
}

function parseOverrides(html) {
  if (!html || html === '-')
    return [];
  return [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(match => {
    const text = stripTags(match[1]).trim();
    const separator = text.indexOf(':');
    if (separator === -1)
      return { platform: text, revision: '' };
    return {
      platform: text.slice(0, separator).trim(),
      revision: text.slice(separator + 1).trim(),
    };
  });
}

function parseBoolean(value) {
  if (value === 'true')
    return true;
  if (value === 'false')
    return false;
  return null;
}

function blankToNull(value) {
  if (value == null)
    return null;
  const text = stripTags(String(value)).trim();
  return !text || text === '-' ? null : text;
}

function stripTags(value) {
  return String(value).replace(/<[^>]+>/g, '');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function browserLabel(name) {
  return BROWSER_LABELS[name] ?? name;
}

function browserNames(releases) {
  const seen = [];
  for (const release of releases) {
    for (const name of Object.keys(release.browsers)) {
      if (!seen.includes(name))
        seen.push(name);
    }
  }
  return seen;
}

function sortValue(browser) {
  return browser.browserVersion ?? browser.revision ?? '';
}

function renderPrimaryCell(browser) {
  const version = browser.browserVersion;
  const revision = browser.revision;
  const extraClass = browser.extra ? ' extra' : '';
  const changedClass = browser.changed ? ' changed' : '';
  const sort = escapeHtml(sortValue(browser));
  const optional = browser.installByDefault === false
    ? '<span class="badge">optional</span>'
    : '';

  if (!version && !revision) {
    return `<td class="browser-cell${extraClass}" data-sort="" data-type="text">–</td>`;
  }

  if (!version) {
    return `<td class="browser-cell${extraClass}${changedClass}" data-sort="${sort}" data-type="text"><span class="ver">${escapeHtml(revision)}</span>${optional}</td>`;
  }

  const revisionLine = revision
    ? `<span class="rev">r${escapeHtml(revision)}</span>`
    : '';
  return `<td class="browser-cell${extraClass}${changedClass}" data-sort="${sort}" data-type="text"><span class="ver">${escapeHtml(version)}</span>${revisionLine}${optional}</td>`;
}

function renderDetailsCell(browser) {
  const extraClass = browser.extra ? ' extra' : '';
  const parts = [];
  if (browser.title)
    parts.push(`<div><span class="k">Title</span> ${escapeHtml(browser.title)}</div>`);
  if (browser.installByDefault !== null) {
    parts.push(`<div><span class="k">Install</span> ${browser.installByDefault ? 'default' : 'optional'}</div>`);
  }
  if (browser.revisionOverrides.length) {
    const items = browser.revisionOverrides
      .map(item => `<li>${escapeHtml(item.platform)}: ${escapeHtml(item.revision)}</li>`)
      .join('');
    parts.push(`<div><span class="k">Overrides</span><ul>${items}</ul></div>`);
  }
  const body = parts.length ? parts.join('') : '–';
  return `<td class="details-cell${extraClass}">${body}</td>`;
}

function searchText(release, columns) {
  const parts = [release.version];
  for (const name of columns) {
    const browser = release.browsers[name];
    if (!browser)
      continue;
    parts.push(
      name,
      browserLabel(name),
      browser.browserVersion ?? '',
      browser.revision ?? '',
      browser.title ?? '',
      ...browser.revisionOverrides.flatMap(item => [item.platform, item.revision]),
    );
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function renderTable(releases) {
  const columns = browserNames(releases);
  const headers = columns.map(name => {
    const extra = EXTRA_BROWSERS.has(name) ? ' extra' : '';
    return `<th class="sortable${extra}" data-type="text" scope="col">${escapeHtml(browserLabel(name))} <span class="sort-indicator"></span></th>`;
  }).join('');

  const body = releases.map(release => {
    const versionSort = escapeHtml(release.version);
    const search = escapeHtml(searchText(release, columns));
    const cells = columns.map(name => renderPrimaryCell(release.browsers[name] ?? { extra: EXTRA_BROWSERS.has(name) })).join('');
    const details = columns.map(name => renderDetailsCell(release.browsers[name] ?? { extra: EXTRA_BROWSERS.has(name), revisionOverrides: [], installByDefault: null })).join('');
    return `<tr class="release" data-search="${search}">
      <td class="version-cell" data-sort="${versionSort}" data-type="version"><button type="button" class="expand" aria-expanded="false"><span class="chevron" aria-hidden="true"></span><strong>${escapeHtml(release.version)}</strong></button></td>
      ${cells}
    </tr>
    <tr class="details" hidden>
      <td class="version-cell"><span class="details-label">Details</span></td>
      ${details}
    </tr>`;
  }).join('\n');

  return `<table data-enhanced-table="true">
  <thead>
    <tr>
      <th class="sortable version-col" data-type="version" scope="col" aria-sort="descending">Playwright <span class="sort-indicator">↓</span></th>
      ${headers}
    </tr>
  </thead>
  <tbody>
    ${body}
  </tbody>
</table>`;
}

function renderHtml({ releases, versionCount, latest }) {
  const latestLabel = latest ? escapeHtml(latest) : 'n/a';
  const table = renderTable(releases);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Playwright browsers list</title>
  <link rel="preconnect" href="https://rsms.me/">
  <link rel="stylesheet" href="https://rsms.me/inter/inter.css">
  <script>
    (() => {
      const stored = localStorage.getItem('theme');
      const preference = stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'system';
      const theme = preference === 'light' || preference === 'dark'
        ? preference
        : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.dataset.theme = theme;
      if (localStorage.getItem('extras') === 'on')
        document.documentElement.dataset.extras = 'on';
    })();
  </script>
  <style>
    :root {
      color-scheme: light;
      --header-height: 56px;
      --bg: #fff;
      --surface: #f5f5f5;
      --ink: #333;
      --invert: #fff;
      --muted: #666;
      --faint: #999;
      --line: #ddd;
      --accent: #fd9527;
      --head: rgba(255, 255, 255, 0.84);
      --font: Inter, system-ui, sans-serif;
      font-family: var(--font);
      font-feature-settings: "liga" 1, "calt" 1;
    }
    @supports (font-variation-settings: normal) {
      :root { --font: InterVariable, Inter, system-ui, sans-serif; }
    }
    :root[data-theme="dark"] {
      color-scheme: dark;
      --bg: #1e1e1e;
      --surface: #111;
      --ink: #fff;
      --invert: #333;
      --muted: #aaa;
      --faint: #666;
      --line: #333;
      --accent: #fd9527;
      --head: rgba(30, 30, 30, 0.84);
    }
    * { box-sizing: border-box; }
    html, body {
      height: 100%;
      overflow: hidden;
      margin: 0;
    }
    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--ink);
      line-height: 1.5;
    }
    a { color: var(--ink); text-decoration: none; }
    a:hover { color: var(--accent); }
    header {
      position: fixed;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      width: 100%;
      height: var(--header-height);
      padding: 0 0.75rem;
      background: var(--bg);
      border-bottom: 1px solid var(--line);
    }
    header .left, header .right {
      display: flex;
      align-items: center;
      min-width: 0;
    }
    header .left { flex: 1 1 auto; }
    header .right { flex: 0 0 auto; gap: 0.5rem; }
    .brand {
      flex: 0 0 auto;
      text-decoration: none;
    }
    header h1 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      letter-spacing: 0;
    }
    .slash {
      margin: 0 0.55rem 0 0.65rem;
      width: 0;
      height: 0.75rem;
      border-right: 2px solid var(--line);
      transform: rotate(20deg);
    }
    header .tagline {
      margin: 0;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--faint);
      font-size: 0.8125rem;
    }
    .top-nav {
      display: flex;
      align-items: center;
      gap: 0.125rem;
      font-size: 0.8125rem;
    }
    .top-nav a {
      padding: 0.375rem 0.5rem;
      border-radius: 0.25rem;
      color: var(--muted);
    }
    .top-nav a:hover {
      color: var(--ink);
      background: var(--surface);
    }
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
    #filter {
      width: 10.5rem;
      height: 2rem;
      padding: 0 0.625rem;
      border: 1px solid var(--line);
      border-radius: 0.25rem;
      background: transparent;
      color: var(--ink);
      font: inherit;
      font-size: 0.8125rem;
    }
    #filter:hover, #filter:focus {
      border-color: var(--accent);
      outline: none;
      background: var(--surface);
    }
    .extras, .icon-link {
      appearance: none;
      height: 2rem;
      padding: 0 0.75rem;
      border: 1px solid var(--line);
      border-radius: 0.25rem;
      background: transparent;
      color: var(--ink);
      font: inherit;
      font-size: 0.8125rem;
      cursor: pointer;
    }
    .extras { color: var(--muted); }
    .extras[aria-pressed="true"] {
      background: var(--accent);
      color: var(--invert);
      border-color: var(--accent);
    }
    .icon-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2rem;
      padding: 0;
    }
    .icon-link:hover { color: var(--accent); }
    .icon {
      display: block;
      width: 1rem;
      height: 1rem;
      background-color: currentColor;
      -webkit-mask: var(--icon) center / contain no-repeat;
      mask: var(--icon) center / contain no-repeat;
    }
    .icon-github { --icon: url("${GITHUB_ICON}"); }
    .icon-sun { --icon: url("${LUCIDE_ICON('sun')}"); }
    .icon-moon { --icon: url("${LUCIDE_ICON('moon')}"); }
    .icon-monitor { --icon: url("${LUCIDE_ICON('monitor')}"); }
    .theme-switch {
      display: inline-flex;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 0.25rem;
    }
    .theme-switch button {
      appearance: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2rem;
      height: 2rem;
      padding: 0;
      border: 0;
      border-right: 1px solid var(--line);
      border-radius: 0;
      background: transparent;
      color: var(--ink);
      cursor: pointer;
    }
    .theme-switch button:last-child { border-right: 0; }
    .theme-switch button:hover { background: var(--surface); }
    .theme-switch button[aria-pressed="true"] {
      background: var(--ink);
      color: var(--invert);
    }
    .theme-switch button[aria-pressed="true"]:hover { background: var(--ink); }
    .page-scroll {
      height: calc(100svh - var(--header-height));
      margin-top: var(--header-height);
      overflow: auto;
    }
    .table-section { width: 100%; }
    .table-wrap { overflow-x: auto; }
    #empty {
      display: none;
      padding: 1rem 0.75rem;
      color: var(--muted);
    }
    .table-section[data-empty] #empty { display: block; }
    .table-section[data-empty] .table-wrap { display: none; }
    table {
      border-collapse: separate;
      border-spacing: 0;
      table-layout: fixed;
      width: 100%;
      min-width: 56rem;
      font-size: 0.875rem;
    }
    html:not([data-extras="on"]) .extra { display: none; }
    html[data-extras="on"] table { min-width: 76rem; }
    .version-col, .version-cell { width: 10.5rem; }
    th, td {
      padding: 0.75rem;
      text-align: left;
      border-bottom: 1px solid var(--line);
      white-space: nowrap;
      height: 48px;
      vertical-align: middle;
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 4;
      background: var(--head);
      backdrop-filter: blur(6px);
      font-size: 0.75rem;
      font-weight: 400;
      text-transform: uppercase;
      color: var(--faint);
    }
    th.sortable { cursor: pointer; user-select: none; }
    .sort-indicator {
      display: inline-block;
      width: 1rem;
      text-align: center;
    }
    .version-col, .version-cell {
      position: sticky;
      left: 0;
      z-index: 3;
      background: var(--bg);
    }
    thead .version-col {
      z-index: 5;
      background: var(--head);
    }
    tbody td { color: var(--faint); }
    tbody td:first-child, tbody .ver { color: var(--ink); }
    tbody tr.release:hover td { background: var(--surface); }
    tbody tr.release:hover .version-cell { background: var(--surface); }
    .expand {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .chevron {
      width: 0.4rem;
      height: 0.4rem;
      border-right: 1.5px solid var(--muted);
      border-bottom: 1.5px solid var(--muted);
      transform: rotate(-45deg);
    }
    .expand[aria-expanded="true"] .chevron { transform: rotate(45deg); }
    .browser-cell { line-height: 1.2; }
    .ver { display: block; font-weight: 500; }
    .rev, .badge, .details-label {
      display: block;
      color: var(--faint);
      font-size: 0.75rem;
    }
    .badge { display: inline; margin-left: 0.35rem; text-transform: uppercase; }
    td.changed .ver { box-shadow: inset 2px 0 0 var(--accent); padding-left: 0.4rem; }
    tr.details td {
      height: auto;
      white-space: normal;
      vertical-align: top;
      background: var(--surface);
      font-size: 0.8125rem;
    }
    tr.details .version-cell { background: var(--surface); }
    .details-cell .k {
      display: block;
      margin-bottom: 0.15rem;
      color: var(--muted);
      font-size: 0.6875rem;
      text-transform: uppercase;
    }
    .details-cell ul { margin: 0.15rem 0 0; padding-left: 1.1rem; }
    @media (max-width: 52rem) {
      .top-nav, header .slash, header .tagline { display: none; }
      #filter { width: 8rem; }
    }
  </style>
</head>
<body>
  <header>
    <div class="left">
      <a class="brand" href="./"><h1>Playwright browsers</h1></a>
      <span class="slash" aria-hidden="true"></span>
      <p class="tagline">${versionCount} releases · latest ${latestLabel}</p>
    </div>
    <div class="right">
      <nav class="top-nav" aria-label="Primary">
        <a href="${PLAYWRIGHT_URL}" target="_blank" rel="noopener noreferrer">Playwright</a>
        <a href="${DOCS_URL}" target="_blank" rel="noopener noreferrer">Docs</a>
      </nav>
      <label>
        <span class="visually-hidden">Filter releases</span>
        <input type="search" id="filter" placeholder="Filter versions…" autocomplete="off">
      </label>
      <button type="button" class="extras" id="extras" aria-pressed="false">Tools</button>
      <a class="icon-link" href="${REPO_URL}" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository">
        <span class="icon icon-github" aria-hidden="true"></span>
      </a>
      <div class="theme-switch" role="group" aria-label="Color theme">
        <button type="button" data-theme-value="light" aria-label="Light">
          <span class="icon icon-sun" aria-hidden="true"></span>
        </button>
        <button type="button" data-theme-value="dark" aria-label="Dark">
          <span class="icon icon-moon" aria-hidden="true"></span>
        </button>
        <button type="button" data-theme-value="system" aria-label="System">
          <span class="icon icon-monitor" aria-hidden="true"></span>
        </button>
      </div>
    </div>
  </header>
  <div class="page-scroll">
    <section class="table-section">
      <p id="empty">No releases match that filter.</p>
      <div class="table-wrap">
${table}
      </div>
    </section>
  </div>
  <script>
    const root = document.documentElement;
    const themeButtons = document.querySelectorAll('[data-theme-value]');
    const extrasButton = document.getElementById('extras');
    const themeMedia = matchMedia('(prefers-color-scheme: dark)');
    const themePreference = () => {
      const stored = localStorage.getItem('theme');
      return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'system';
    };
    const resolveTheme = preference => (
      preference === 'light' || preference === 'dark'
        ? preference
        : (themeMedia.matches ? 'dark' : 'light')
    );
    const applyTheme = preference => {
      root.dataset.theme = resolveTheme(preference);
      for (const button of themeButtons) {
        button.setAttribute('aria-pressed', String(button.dataset.themeValue === preference));
      }
    };
    applyTheme(themePreference());
    themeMedia.addEventListener('change', () => {
      if (themePreference() === 'system') applyTheme('system');
    });
    for (const button of themeButtons) {
      button.addEventListener('click', () => {
        const preference = button.dataset.themeValue;
        localStorage.setItem('theme', preference);
        applyTheme(preference);
      });
    }

    const applyExtras = on => {
      if (on) root.dataset.extras = 'on';
      else delete root.dataset.extras;
      extrasButton.setAttribute('aria-pressed', String(on));
    };
    applyExtras(root.dataset.extras === 'on');
    extrasButton.addEventListener('click', () => {
      const on = root.dataset.extras !== 'on';
      localStorage.setItem('extras', on ? 'on' : 'off');
      applyExtras(on);
    });

    const input = document.getElementById('filter');
    const section = document.querySelector('.table-section');
    const table = document.querySelector('table[data-enhanced-table]');
    const tbody = table.tBodies[0];

    const groups = [];
    for (const row of tbody.querySelectorAll('tr.release')) {
      groups.push({ release: row, details: row.nextElementSibling });
    }

    const filterGroups = () => {
      const query = input.value.trim().toLowerCase();
      let visible = 0;
      for (const group of groups) {
        const show = !query || (group.release.dataset.search || '').includes(query);
        group.release.hidden = !show;
        if (!show)
          group.details.hidden = true;
        else if (group.release.querySelector('.expand')?.getAttribute('aria-expanded') !== 'true')
          group.details.hidden = true;
        if (show) visible += 1;
      }
      section.toggleAttribute('data-empty', visible === 0);
    };
    input.addEventListener('input', filterGroups);

    tbody.addEventListener('click', event => {
      const button = event.target.closest('.expand');
      if (!button) return;
      const release = button.closest('tr.release');
      const details = release?.nextElementSibling;
      if (!details?.classList.contains('details')) return;
      const open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(open));
      details.hidden = !open;
    });

    const parseVersion = tag => {
      const match = String(tag).match(/^v?(\\d+)\\.(\\d+)\\.(\\d+)(?:-(.+))?$/);
      if (!match) return null;
      return { major: +match[1], minor: +match[2], patch: +match[3], prerelease: match[4] ?? null };
    };
    const compareVersions = (tagA, tagB) => {
      const a = parseVersion(tagA);
      const b = parseVersion(tagB);
      if (!a || !b) return String(tagA).localeCompare(String(tagB));
      if (a.major !== b.major) return a.major - b.major;
      if (a.minor !== b.minor) return a.minor - b.minor;
      if (a.patch !== b.patch) return a.patch - b.patch;
      if (a.prerelease === b.prerelease) return 0;
      if (a.prerelease === null) return 1;
      if (b.prerelease === null) return -1;
      return a.prerelease.localeCompare(b.prerelease);
    };
    const compareValues = (a, b, type) => {
      if (a === '' && b === '') return 0;
      if (a === '') return 1;
      if (b === '') return -1;
      if (type === 'version') return compareVersions(a, b);
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    };

    for (const header of table.querySelectorAll('th.sortable')) {
      header.addEventListener('click', () => {
        const column = header.cellIndex;
        const type = header.getAttribute('data-type');
        const direction = header.getAttribute('aria-sort') === 'ascending' ? 'desc' : 'asc';
        groups.sort((left, right) => {
          const a = left.release.cells[column]?.getAttribute('data-sort') ?? '';
          const b = right.release.cells[column]?.getAttribute('data-sort') ?? '';
          const comparison = compareValues(a, b, type);
          return direction === 'asc' ? comparison : -comparison;
        });
        for (const group of groups)
          tbody.append(group.release, group.details);
        for (const sortable of table.querySelectorAll('th.sortable')) {
          sortable.removeAttribute('aria-sort');
          const indicator = sortable.querySelector('.sort-indicator');
          if (indicator) indicator.textContent = '';
        }
        header.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');
        const indicator = header.querySelector('.sort-indicator');
        if (indicator) indicator.textContent = direction === 'asc' ? '↑' : '↓';
      });
    }
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
