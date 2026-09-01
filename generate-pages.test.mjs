import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  compareVersions,
  generatePages,
  markChanges,
  parseBrowsersTable,
} from './generate-pages.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const FIXTURE = `<table>
  <thead>
    <tr>
      <th>version</th>
      <th>property</th>
      <th>chromium</th>
      <th>firefox</th>
      <th>webkit</th>
      <th>ffmpeg</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="5"><strong>v1.0.0</strong></td>
      <td>revision</td>
      <td>100</td><td>200</td><td>300</td><td>9</td>
    </tr>
    <tr>
      <td>browserVersion</td>
      <td>-</td><td>-</td><td>-</td><td>-</td>
    </tr>
    <tr>
      <td>installByDefault</td>
      <td>true</td><td>true</td><td>true</td><td>false</td>
    </tr>
    <tr>
      <td>title</td>
      <td>-</td><td>-</td><td>-</td><td>-</td>
    </tr>
    <tr>
      <td>revisionOverrides</td>
      <td>-</td><td>-</td><td>-</td><td>-</td>
    </tr>
    <tr>
      <td rowspan="5"><strong>v1.2.0</strong></td>
      <td>revision</td>
      <td>110</td><td>200</td><td>310</td><td>9</td>
    </tr>
    <tr>
      <td>browserVersion</td>
      <td>120.0.1</td><td>99.0</td><td>16.0</td><td>-</td>
    </tr>
    <tr>
      <td>installByDefault</td>
      <td>true</td><td>true</td><td>true</td><td>false</td>
    </tr>
    <tr>
      <td>title</td>
      <td>Chrome for Testing</td><td>Firefox</td><td>WebKit</td><td>-</td>
    </tr>
    <tr>
      <td>revisionOverrides</td>
      <td>-</td><td>-</td><td><ul><li>mac12: 300</li><li>ubuntu20.04-x64: 301</li></ul></td><td>-</td>
    </tr>
  </tbody>
</table>
`;

test('compareVersions orders prereleases before the matching release', () => {
  assert.ok(compareVersions('v1.2.0-beta.1', 'v1.2.0') < 0);
  assert.ok(compareVersions('v1.10.0', 'v1.2.0') > 0);
});

test('parseBrowsersTable reads one release per rowspan group', () => {
  const releases = parseBrowsersTable(FIXTURE);
  assert.equal(releases.length, 2);
  assert.equal(releases[0].version, 'v1.0.0');
  assert.equal(releases[1].browsers.chromium.browserVersion, '120.0.1');
  assert.equal(releases[1].browsers.chromium.revision, '110');
  assert.equal(releases[1].browsers.chromium.title, 'Chrome for Testing');
  assert.equal(releases[0].browsers.ffmpeg.installByDefault, false);
  assert.deepEqual(releases[1].browsers.webkit.revisionOverrides, [
    { platform: 'mac12', revision: '300' },
    { platform: 'ubuntu20.04-x64', revision: '301' },
  ]);
});

test('markChanges compares each release to the next older one', () => {
  const releases = markChanges([...parseBrowsersTable(FIXTURE)].reverse());
  assert.equal(releases[0].version, 'v1.2.0');
  assert.equal(releases[0].browsers.chromium.changed, true);
  assert.equal(releases[0].browsers.firefox.changed, true);
  assert.equal(releases[0].browsers.ffmpeg.changed, false);
  assert.equal(releases[1].browsers.chromium.changed, false);
});

test('writes a models.dev-style index from the browsers table', () => {
  const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-'));
  const output = generatePages({
    tableFile: path.join(ROOT, 'playwright-browsers-list.md'),
    siteDir,
  });

  assert.equal(path.basename(output), 'index.html');
  const html = fs.readFileSync(output, 'utf-8');
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<title>Playwright browsers list<\/title>/);
  assert.match(html, /<h1>Playwright browsers<\/h1>/);
  assert.match(html, /class="top-nav"/);
  assert.match(html, /github.com\/microsoft\/playwright/);
  assert.match(html, /playwright.dev\/docs\/browsers/);
  assert.match(html, /github.com\/barremian\/playwright-browsers-list/);
  assert.match(html, /class="icon-link"/);
  assert.match(html, /aria-label="GitHub repository"/);
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/simple-icons@16\.24\.1\/icons\/github\.svg/);
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/lucide-static@1\.39\.0\/icons\/sun\.svg/);
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/lucide-static@1\.39\.0\/icons\/moon\.svg/);
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/lucide-static@1\.39\.0\/icons\/monitor\.svg/);
  assert.match(html, /id="filter"/);
  assert.match(html, /id="extras"/);
  assert.match(html, /InterVariable/);
  assert.match(html, /--accent: #fd9527/);
  assert.match(html, /--bg: #fff;/);
  assert.match(html, /--bg: #1e1e1e;/);
  assert.doesNotMatch(html, /#f4f1ea|#fffdf8|#2f6f4e|#161412/);
  assert.match(html, /:root\[data-theme="dark"\]/);
  assert.match(html, /data-theme-value="light"/);
  assert.match(html, /data-theme-value="dark"/);
  assert.match(html, /data-theme-value="system"/);
  assert.doesNotMatch(html, />GitHub</);
  assert.doesNotMatch(html, />Light</);
  assert.doesNotMatch(html, />Dark</);
  assert.match(html, /class="page-scroll"/);
  assert.ok(html.indexOf('id="empty"') < html.indexOf('class="table-wrap"'));
  assert.match(html, /<strong>v1\.62\.1<\/strong>/);
  assert.match(html, /151\.0\.7922\.34/);
  assert.doesNotMatch(html, /<td rowspan=/);
  assert.equal(html.indexOf('v1.62.1') < html.indexOf('v0.16.0'), true);
  assert.match(html, /class="[^"]*\bextra\b/);
  assert.equal((html.match(/<tr class="release"/g) ?? []).length, 157);
  assert.equal(fs.readFileSync(path.join(siteDir, '.nojekyll'), 'utf-8'), '');
});

test('renders one row per fixture release, newest first, with extras hidden by class', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-fixture-'));
  const tableFile = path.join(dir, 'table.md');
  fs.writeFileSync(tableFile, FIXTURE);
  const siteDir = path.join(dir, '_site');
  const html = fs.readFileSync(generatePages({ tableFile, siteDir }), 'utf-8');

  assert.match(html, /2 releases · latest v1\.2\.0/);
  assert.equal((html.match(/<tr class="release"/g) ?? []).length, 2);
  assert.ok(html.indexOf('v1.2.0') < html.indexOf('v1.0.0'));
  assert.match(html, /120\.0\.1/);
  assert.match(html, /r110/);
  assert.match(html, /class="[^"]*\bextra\b/);
  assert.match(html, /optional/);
  assert.match(html, /mac12: 300/);
  assert.match(html, /td class="browser-cell changed"/);
});

test('rejects a source file that is not an HTML table', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-bad-'));
  const tableFile = path.join(dir, 'not-a-table.md');
  fs.writeFileSync(tableFile, '# hello\n');
  assert.throws(
    () => generatePages({ tableFile, siteDir: path.join(dir, '_site') }),
    /does not contain an HTML table/,
  );
});
