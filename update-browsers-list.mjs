#!/usr/bin/env node
// Scans microsoft/playwright for release tags that are not yet recorded in
// playwright-tags.json, fetches browsers.json for each new tag and appends the
// data to the playwright-browsers-list.md table.
//
// Usage: node update-browsers-list.mjs [--dry-run]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TAGS_FILE = path.join(ROOT, 'playwright-tags.json');
const TABLE_FILE = path.join(ROOT, 'playwright-browsers-list.md');

const PLAYWRIGHT_REPO = 'https://github.com/microsoft/playwright.git';
const BROWSERS_JSON_URL = tag =>
  `https://raw.githubusercontent.com/microsoft/playwright/${tag}/packages/playwright-core/browsers.json`;

// Must match the <th> column order in playwright-browsers-list.md.
const COLUMNS = ['chromium', 'chromium-headless-shell', 'firefox', 'webkit', 'ffmpeg', 'winldd', 'android'];

const DRY_RUN = process.argv.includes('--dry-run');

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 });
}

// Tags are fetched into a throwaway repo so the local checkout stays untouched.
function listRemoteTags() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-tags-'));
  try {
    console.log('Fetching tags from microsoft/playwright...');
    run('git', ['init', '--quiet'], tmpDir);
    run('git', ['fetch', '--quiet', '--tags', '--depth=1', PLAYWRIGHT_REPO, 'refs/tags/*:refs/tags/*'], tmpDir);
    const output = run('git', ['tag', '--format=%(creatordate:short) %(refname:short)', '--sort=-creatordate'], tmpDir);
    return output
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const separator = line.indexOf(' ');
        return { createdAt: line.slice(0, separator), tag: line.slice(separator + 1).trim() };
      });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Prereleases sort before their matching release; unparsable tags fall back to string order.
function parseVersion(tag) {
  const match = tag.match(/^v(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match)
    return null;
  const [, major, minor, patch, prerelease] = match;
  return { major: +major, minor: +minor, patch: +patch, prerelease: prerelease ?? null };
}

function compareVersions(tagA, tagB) {
  const a = parseVersion(tagA);
  const b = parseVersion(tagB);
  if (!a || !b)
    return tagA.localeCompare(tagB);
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

async function fetchBrowsersJson(tag) {
  const response = await fetch(BROWSERS_JSON_URL(tag));
  if (!response.ok)
    throw new Error(`HTTP ${response.status} for ${tag}`);
  return response.json();
}

function formatRevisionOverrides(overrides) {
  if (!overrides)
    return '-';
  const items = Object.entries(overrides).map(([key, value]) => `<li>${key}: ${value}</li>`).join('');
  return `<ul>${items}</ul>`;
}

function renderTagBlock(tag, browsers) {
  const byName = new Map(browsers.map(browser => [browser.name, browser]));
  const cells = render => COLUMNS.map(name => {
    const browser = byName.get(name);
    return `<td>${browser ? render(browser) : '-'}</td>`;
  }).join('');

  return `    <tr>
      <td rowspan="5"><strong>${tag}</strong></td>
      <td>revision</td>
      ${cells(b => b.revision ?? '-')}
    </tr>
    <tr>
      <td>browserVersion</td>
      ${cells(b => b.browserVersion ?? '-')}
    </tr>
    <tr>
      <td>installByDefault</td>
      ${cells(b => b.installByDefault ?? '-')}
    </tr>
    <tr>
      <td>title</td>
      ${cells(b => b.title ?? '-')}
    </tr>
    <tr>
      <td>revisionOverrides</td>
      ${cells(b => formatRevisionOverrides(b.revisionOverrides))}
    </tr>
`;
}

// Splits the <tbody> into per-tag row groups so new tags can be spliced in by version order.
function splitTableBlocks(tableContent) {
  const bodyStart = tableContent.indexOf('<tbody>') + '<tbody>\n'.length;
  const bodyEnd = tableContent.lastIndexOf('</tbody>');
  if (bodyStart < '<tbody>\n'.length || bodyEnd === -1)
    throw new Error(`could not find <tbody> in ${TABLE_FILE}`);

  const body = tableContent.slice(bodyStart, bodyEnd);
  const blocks = body
    .split(/(?=    <tr>\n      <td rowspan="5">)/)
    .filter(block => block.trim())
    .map(block => ({ tag: block.match(/<strong>(.*?)<\/strong>/)?.[1] ?? '', html: block }));

  return { header: tableContent.slice(0, bodyStart), blocks, footer: tableContent.slice(bodyEnd) };
}

async function main() {
  console.log(`Reading ${path.basename(TAGS_FILE)}...`);
  const knownTags = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf-8'));
  const knownTagNames = new Set(knownTags.map(entry => entry.tag.trim()));

  const remoteTags = listRemoteTags();
  console.log(`Found ${remoteTags.length} remote tag(s), ${knownTagNames.size} already recorded.`);

  const newTags = remoteTags
    .filter(entry => !knownTagNames.has(entry.tag))
    .sort((a, b) => compareVersions(a.tag, b.tag));

  if (!newTags.length) {
    console.log('No new tags found.');
    return;
  }

  console.log(`Found ${newTags.length} new tag(s): ${newTags.map(entry => entry.tag).join(', ')}`);

  const rendered = [];
  const added = [];
  for (const [index, entry] of newTags.entries()) {
    try {
      console.log(`[${index + 1}/${newTags.length}] Fetching browsers.json for ${entry.tag}...`);
      const json = await fetchBrowsersJson(entry.tag);
      if (!Array.isArray(json?.browsers))
        throw new Error('browsers.json has no "browsers" array');
      rendered.push({ tag: entry.tag, html: renderTagBlock(entry.tag, json.browsers) });
      added.push(entry);
    } catch (error) {
      console.warn(`skip ${entry.tag}: ${error.message}`);
    }
  }

  if (!rendered.length) {
    console.log('No browsers.json could be fetched for the new tags.');
    return;
  }

  console.log(`Merging ${rendered.length} tag(s) into the table...`);
  const { header, blocks, footer } = splitTableBlocks(fs.readFileSync(TABLE_FILE, 'utf-8'));
  const merged = [...blocks, ...rendered].sort((a, b) => compareVersions(a.tag, b.tag));
  const table = header + merged.map(block => block.html).join('') + footer;

  const tags = [...knownTags, ...added].sort((a, b) => compareVersions(a.tag.trim(), b.tag.trim()));

  if (DRY_RUN) {
    console.log(`[dry-run] would add ${rendered.length} tag(s) to ${path.basename(TABLE_FILE)}`);
    return;
  }

  console.log('Writing files...');
  fs.writeFileSync(TABLE_FILE, table);
  fs.writeFileSync(TAGS_FILE, `${JSON.stringify(tags, null, 2)}\n`);
  console.log(`Added ${rendered.length} tag(s) to ${path.basename(TABLE_FILE)} and ${path.basename(TAGS_FILE)}.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
