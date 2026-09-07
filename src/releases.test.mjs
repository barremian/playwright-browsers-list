import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  browsersFromPlaywright,
  compareVersions,
  loadReleases,
  releaseHasBrowsers,
  toStoredRelease,
  writeReleasesJson,
} from './releases.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('loadReleases reads the catalog and keeps known tags without browsers', () => {
  const releases = loadReleases(path.join(ROOT, 'playwright-releases.json'));
  assert.ok(Array.isArray(releases));
  assert.ok(releases.length > 0);
  assert.equal(releases[0].version, 'v0.10.0');
  assert.deepEqual(releases[0].browsers, {});

  for (const [index, release] of releases.entries()) {
    assert.equal(typeof release.version, 'string');
    assert.ok(release.version);
    assert.equal(typeof release.browsers, 'object');
    assert.ok(release.browsers);
    assert.equal(Array.isArray(release.browsers), false);
    if (index > 0)
      assert.ok(compareVersions(releases[index - 1].version, release.version) <= 0);
  }

  const withBrowsers = releases.filter(releaseHasBrowsers);
  assert.ok(withBrowsers.length > 0);
  assert.ok(withBrowsers.length <= releases.length);

  const latest = releases.at(-1);
  assert.ok(releaseHasBrowsers(latest));
  assert.ok(latest.browsers.chromium);
  if (latest.browsers.webkit) {
    for (const item of latest.browsers.webkit.revisionOverrides) {
      assert.equal(typeof item.platform, 'string');
      assert.ok(item.platform);
      assert.equal(typeof item.revision, 'string');
    }
  }
});

test('catalog invariants still hold after a newer Playwright tag is added', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releases-new-tag-'));
  const file = path.join(dir, 'playwright-releases.json');
  const known = JSON.parse(fs.readFileSync(path.join(ROOT, 'playwright-releases.json'), 'utf-8'));
  writeReleasesJson(file, [
    ...known,
    {
      tag: 'v99.0.0',
      createdAt: '2099-01-01',
      browsers: {
        chromium: {
          revision: '9999',
          browserVersion: '999.0.0.1',
          installByDefault: true,
        },
      },
    },
  ]);

  const releases = loadReleases(file);
  assert.equal(releases[0].version, 'v0.10.0');
  assert.deepEqual(releases[0].browsers, {});
  assert.equal(releases.at(-1).version, 'v99.0.0');
  assert.ok(releaseHasBrowsers(releases.at(-1)));
  assert.equal(releases.at(-1).browsers.chromium.browserVersion, '999.0.0.1');
  for (let index = 1; index < releases.length; index += 1)
    assert.ok(compareVersions(releases[index - 1].version, releases[index].version) <= 0);
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
