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
} from './generate-pages.mjs';
import { normalizeRelease } from './releases.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const FIXTURE = [
  {
    tag: 'v1.0.0',
    createdAt: '2020-05-05',
    browsers: {
      chromium: { revision: '100', installByDefault: true },
      firefox: { revision: '200', installByDefault: true },
      webkit: { revision: '300', installByDefault: true },
      ffmpeg: { revision: '9', installByDefault: false },
    },
  },
  {
    tag: 'v1.2.0',
    createdAt: '2020-07-06',
    browsers: {
      chromium: {
        revision: '110',
        browserVersion: '120.0.1',
        installByDefault: true,
        title: 'Chrome for Testing',
      },
      firefox: {
        revision: '200',
        browserVersion: '99.0',
        installByDefault: true,
        title: 'Firefox',
      },
      webkit: {
        revision: '310',
        browserVersion: '16.0',
        installByDefault: true,
        title: 'WebKit',
        revisionOverrides: {
          mac12: '300',
          'ubuntu20.04-x64': '301',
        },
      },
      ffmpeg: { revision: '9', installByDefault: false },
    },
  },
];

function fixtureReleases() {
  return FIXTURE.map(normalizeRelease);
}

test('compareVersions orders prereleases before the matching release', () => {
  assert.ok(compareVersions('v1.2.0-beta.1', 'v1.2.0') < 0);
  assert.ok(compareVersions('v1.10.0', 'v1.2.0') > 0);
});

test('normalizeRelease reads object overrides and omits empty browsers', () => {
  const releases = fixtureReleases();
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
  const releases = markChanges(
    [...fixtureReleases()].sort((a, b) => compareVersions(b.version, a.version)),
  );
  assert.equal(releases[0].version, 'v1.2.0');
  assert.equal(releases[0].browsers.chromium.changed, true);
  assert.equal(releases[0].browsers.firefox.changed, true);
  assert.equal(releases[0].browsers.ffmpeg.changed, false);
  assert.equal(releases[1].browsers.chromium.changed, false);
});

test('writes a models.dev-style index from the releases catalog', () => {
  const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-'));
  const output = generatePages({
    releasesFile: path.join(ROOT, 'playwright-releases.json'),
    siteDir,
  });

  assert.equal(path.basename(output), 'index.html');
  const html = fs.readFileSync(output, 'utf-8');
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<title>Playwright Browsers<\/title>/);
  assert.match(html, /<h1>Playwright Browsers<\/h1>/);
  assert.match(html, /rel="icon"[^>]*lucide-static@1\.39\.0\/icons\/drama\.svg/);
  assert.doesNotMatch(html, /Playwright browsers list/);
  assert.doesNotMatch(html, /<h1>Playwright browsers<\/h1>/);
  assert.doesNotMatch(html, /class="top-nav"/);
  assert.doesNotMatch(html, /github.com\/microsoft\/playwright/);
  assert.doesNotMatch(html, /playwright.dev\/docs\/browsers/);
  assert.match(html, /github.com\/barremian\/playwright-browsers-list/);
  assert.match(html, /header h1 \{[\s\S]*text-overflow: ellipsis;/);
  assert.match(html, /class="icon-link"/);
  assert.match(html, /aria-label="GitHub repository"/);
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/simple-icons@16\.24\.1\/icons\/github\.svg/);
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/lucide-static@1\.39\.0\/icons\/toolbox\.svg/);
  assert.match(html, /id="extras"[\s\S]*icon-toolbox[\s\S]*>\s*Tools\s*<\/button>/);
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/lucide-static@1\.39\.0\/icons\/sun\.svg/);
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/lucide-static@1\.39\.0\/icons\/moon\.svg/);
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/lucide-static@1\.39\.0\/icons\/monitor\.svg/);
  assert.match(html, /id="filter"/);
  assert.match(html, /class="search"/);
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/lucide-static@1\.39\.0\/icons\/search\.svg/);
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/lucide-static@1\.39\.0\/icons\/command\.svg/);
  assert.match(html, /class="search-keys-pc">Ctrl F</);
  assert.match(html, /class="search-keys-mac"/);
  assert.match(html, /icon-command/);
  assert.match(html, /aria-keyshortcuts="Control\+F Meta\+F"/);
  assert.match(html, /placeholder="Search"/);
  assert.match(html, /class="search-clear"/);
  assert.match(html, /aria-label="Clear search"/);
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/lucide-static@1\.39\.0\/icons\/x\.svg/);
  assert.match(html, /::-webkit-search-cancel-button/);
  assert.match(html, /\.search-clear \{[\s\S]*right: 0\.25rem;/);
  assert.match(html, /#filter::-webkit-search-cancel-button[\s\S]*display: none;/);
  assert.match(html, /event\.key\.toLowerCase\(\) === 'f'/);
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
  assert.match(html, /\.table-wrap \{[\s\S]*overflow: auto;/);
  assert.match(html, /thead th \{[\s\S]*position: sticky;[\s\S]*top: 0;/);
  assert.ok(html.indexOf('id="empty"') < html.indexOf('class="table-wrap"'));
  assert.match(html, /<strong>v1\.62\.1<\/strong>/);
  assert.match(html, /151\.0\.7922\.34/);
  assert.match(html, /Downloads/);
  assert.match(html, /cdn\.playwright\.dev\/builds\/cft\/151\.0\.7922\.34\//);
  assert.match(html, /builds\/chromium\/1200\/chromium-linux\.zip/);
  assert.match(html, /builds\/firefox\/1538\//);
  assert.doesNotMatch(html, /<td rowspan=/);
  assert.equal(html.indexOf('v1.62.1') < html.indexOf('v0.16.0'), true);
  assert.doesNotMatch(html, /v0\.10\.0/);
  assert.match(html, /class="[^"]*\bextra\b/);
  assert.equal((html.match(/<tr class="release"/g) ?? []).length, 157);
  assert.equal(fs.readFileSync(path.join(siteDir, '.nojekyll'), 'utf-8'), '');
});

test('renders one row per fixture release, newest first, with extras hidden by class', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-fixture-'));
  const releasesFile = path.join(dir, 'releases.json');
  fs.writeFileSync(releasesFile, `${JSON.stringify(FIXTURE, null, 2)}\n`);
  const siteDir = path.join(dir, '_site');
  const html = fs.readFileSync(generatePages({ releasesFile, siteDir }), 'utf-8');

  assert.match(html, /2 releases · latest v1\.2\.0/);
  assert.equal((html.match(/<tr class="release"/g) ?? []).length, 2);
  assert.ok(html.indexOf('v1.2.0') < html.indexOf('v1.0.0'));
  assert.match(html, /120\.0\.1/);
  assert.match(html, /r110/);
  assert.match(html, /class="[^"]*\bextra\b/);
  assert.match(html, /optional/);
  assert.match(html, /mac12: 300/);
  assert.match(html, /Downloads/);
  assert.match(html, /builds\/cft\/120\.0\.1\/mac-arm64\/chrome-mac-arm64\.zip/);
  assert.match(html, /builds\/chromium\/100\/chromium-linux\.zip/);
  assert.match(html, /builds\/ffmpeg\/9\/ffmpeg-linux\.zip/);
  assert.doesNotMatch(html, /builds\/cft\/.*v1\.0\.0/);
  assert.match(html, /td class="browser-cell changed"/);
  assert.match(html, /\.ver \{ display: block; font-weight: 500; padding-left: 0\.4rem; \}/);
  assert.match(html, /\.rev \{ padding-left: 0\.4rem; \}/);
});

test('rejects a source file that is not a releases array', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-bad-'));
  const releasesFile = path.join(dir, 'not-releases.json');
  fs.writeFileSync(releasesFile, '{"hello":true}\n');
  assert.throws(
    () => generatePages({ releasesFile, siteDir: path.join(dir, '_site') }),
    /is not a JSON array/,
  );
});
