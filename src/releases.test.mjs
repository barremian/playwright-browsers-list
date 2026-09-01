import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  browsersFromPlaywright,
  loadReleases,
  releaseHasBrowsers,
  toStoredRelease,
  writeReleasesJson,
} from './releases.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('loadReleases reads the catalog and keeps known tags without browsers', () => {
  const releases = loadReleases(path.join(ROOT, 'playwright-releases.json'));
  assert.equal(releases.length, 165);
  assert.equal(releases.filter(releaseHasBrowsers).length, 157);
  assert.equal(releases[0].version, 'v0.10.0');
  assert.deepEqual(releases[0].browsers, {});
  const latest = releases.at(-1);
  assert.equal(latest.version, 'v1.62.1');
  assert.equal(latest.browsers.chromium.browserVersion, '151.0.7922.34');
  assert.deepEqual(latest.browsers.webkit.revisionOverrides, [
    { platform: 'mac14', revision: '2251' },
    { platform: 'mac14-arm64', revision: '2251' },
    { platform: 'ubuntu20.04-x64', revision: '2092' },
    { platform: 'ubuntu20.04-arm64', revision: '2092' },
  ]);
});

test('toStoredRelease omits empty fields and stores overrides as an object', () => {
  assert.deepEqual(toStoredRelease({
    tag: 'v1.2.0',
    createdAt: '2020-07-06',
    browsers: {
      chromium: {
        revision: '110',
        browserVersion: '120.0.1',
        installByDefault: true,
        title: 'Chrome for Testing',
        revisionOverrides: [],
      },
      webkit: {
        revision: '310',
        revisionOverrides: [
          { platform: 'mac12', revision: '300' },
        ],
      },
      ffmpeg: { revision: null, title: '-' },
    },
  }), {
    tag: 'v1.2.0',
    createdAt: '2020-07-06',
    browsers: {
      chromium: {
        revision: '110',
        browserVersion: '120.0.1',
        installByDefault: true,
        title: 'Chrome for Testing',
      },
      webkit: {
        revision: '310',
        revisionOverrides: { mac12: '300' },
      },
    },
  });
});

test('browsersFromPlaywright maps a browsers.json array', () => {
  assert.deepEqual(browsersFromPlaywright([
    {
      name: 'chromium',
      revision: '1234',
      browserVersion: '151.0.7922.34',
      installByDefault: true,
      title: 'Chrome for Testing',
    },
    {
      name: 'webkit',
      revision: '2336',
      revisionOverrides: { mac14: '2251' },
    },
  ]), {
    chromium: {
      revision: '1234',
      browserVersion: '151.0.7922.34',
      installByDefault: true,
      title: 'Chrome for Testing',
    },
    webkit: {
      revision: '2336',
      revisionOverrides: { mac14: '2251' },
    },
  });
});

test('writeReleasesJson sorts by version and round-trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releases-'));
  const file = path.join(dir, 'playwright-releases.json');
  writeReleasesJson(file, [
    { tag: 'v1.10.0', createdAt: '2021-03-23', browsers: { chromium: { revision: '2' } } },
    { tag: 'v1.2.0', createdAt: '2020-07-06', browsers: { chromium: { revision: '1' } } },
  ]);
  const loaded = loadReleases(file);
  assert.deepEqual(loaded.map(release => release.version), ['v1.2.0', 'v1.10.0']);
  assert.equal(loaded[0].browsers.chromium.revision, '1');
});
