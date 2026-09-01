import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PLAYWRIGHT_REGISTRY_SOURCE,
  diffDownloadContracts,
  extractDownloadContract,
  extractLegacyChromiumTemplates,
  loadDownloadRegistry,
} from './download-registry.mjs';
import { representativeDownloadUrls } from './download-urls.mjs';
import { compareVersions } from './generate-pages.mjs';
import { loadReleases, releaseHasBrowsers } from './releases.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const registry = loadDownloadRegistry();

const FIXTURE_SOURCE = `
const PLAYWRIGHT_CDN_MIRRORS = [
  'https://cdn.playwright.dev/dbazure/download/playwright',
  'https://playwright.download.prss.microsoft.com/dbazure/download/playwright',
  'https://cdn.playwright.dev',
];

function cftUrl(suffix) {
  return ({ browserVersion }) => {
    return {
      path: \`builds/cft/\${browserVersion}/\${suffix}\`,
      mirrors: [
        'https://cdn.playwright.dev',
      ],
    };
  };
}

const DOWNLOAD_PATHS = {
  'chromium': {
    'ubuntu24.04-x64': cftUrl('linux64/chrome-linux64.zip'),
    'mac15-arm64': cftUrl('mac-arm64/chrome-mac-arm64.zip'),
    'ubuntu20.04-x64': undefined,
  },
  'ffmpeg': {
    'ubuntu24.04-x64': 'builds/ffmpeg/%s/ffmpeg-linux.zip',
    'win64': 'builds/ffmpeg/%s/ffmpeg-win64.zip',
  },
};

function computeDefaultCacheDirectory() {}
`;

function shouldRunLiveCanary(env = process.env) {
  if (env.DOWNLOAD_CANARY === '0')
    return false;
  return env.CI === 'true' || env.CI === '1' || env.DOWNLOAD_CANARY === '1';
}

test('extractDownloadContract reads mirrors and path templates', () => {
  const extracted = extractDownloadContract(FIXTURE_SOURCE);
  assert.deepEqual(extracted.mirrors, [
    'https://cdn.playwright.dev/dbazure/download/playwright',
    'https://playwright.download.prss.microsoft.com/dbazure/download/playwright',
    'https://cdn.playwright.dev',
  ]);
  assert.deepEqual(extracted.chromiumMirrors, ['https://cdn.playwright.dev']);
  assert.deepEqual(extracted.pathTemplates, {
    chromium: {
      'ubuntu24.04-x64': 'builds/cft/%v/linux64/chrome-linux64.zip',
      'mac15-arm64': 'builds/cft/%v/mac-arm64/chrome-mac-arm64.zip',
    },
    ffmpeg: {
      'ubuntu24.04-x64': 'builds/ffmpeg/%s/ffmpeg-linux.zip',
      win64: 'builds/ffmpeg/%s/ffmpeg-win64.zip',
    },
  });
});

test('extractDownloadContract fails closed when the source shape changes', () => {
  assert.throws(() => extractDownloadContract('export const nope = true;'), /PLAYWRIGHT_CDN_MIRRORS/);
  assert.throws(() => extractDownloadContract('const PLAYWRIGHT_CDN_MIRRORS = [];'), /cftUrl mirrors/);
});

test('pinned registry matches the extractor snapshot of itself', () => {
  assert.equal(registry.source, PLAYWRIGHT_REGISTRY_SOURCE);
  assert.ok(registry.mirrors.length);
  assert.ok(registry.pathTemplates.firefox['ubuntu24.04-x64'].includes('builds/firefox/%s/'));
});

test('legacy Chromium templates stay pinned to the v1.57.0 snapshot', () => {
  const fixture = fs.readFileSync(path.join(ROOT, 'download-registry-v1.57-chromium.fixture.ts'), 'utf-8');
  assert.deepEqual(registry.legacyPathTemplates, extractLegacyChromiumTemplates(fixture));
  assert.match(registry.legacySource, /v1\.57\.0/);
  assert.match(registry.legacyPathTemplates.chromium['mac15-arm64'], /builds\/chromium\/%s\/chromium-mac-arm64\.zip/);
  assert.match(
    registry.legacyPathTemplates['chromium-headless-shell']['ubuntu24.04-x64'],
    /builds\/chromium\/%s\/chromium-headless-shell-linux\.zip/,
  );
});

test('Playwright download contract still matches microsoft/playwright', async t => {
  if (!shouldRunLiveCanary()) {
    t.skip('set CI=1 or DOWNLOAD_CANARY=1 to run the live CDN canary');
    return;
  }

  const response = await fetch(PLAYWRIGHT_REGISTRY_SOURCE);
  assert.equal(response.ok, true, `failed to fetch ${PLAYWRIGHT_REGISTRY_SOURCE}: ${response.status}`);
  const source = await response.text();
  const actual = extractDownloadContract(source);
  const diff = diffDownloadContracts(registry, actual);
  assert.equal(
    diff,
    null,
    diff
      ? `Playwright CDN contract drifted. Update playwright-download-registry.json.\n${JSON.stringify(diff, null, 2)}`
      : '',
  );

  const latest = loadReleases(path.join(ROOT, 'playwright-releases.json'))
    .filter(releaseHasBrowsers)
    .sort((a, b) => compareVersions(b.version, a.version))[0];
  const urls = representativeDownloadUrls(latest, registry);
  assert.ok(urls.length, `no representative download URLs for ${latest.version}`);

  for (const url of urls) {
    const probe = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    assert.equal(probe.ok, true, `HEAD ${probe.status} ${url}`);
  }

  const legacyProbes = [
    `${registry.mirrors[0]}/builds/chromium/1200/chromium-linux.zip`,
    `${registry.mirrors[0]}/builds/chromium/1148/chromium-headless-shell-linux.zip`,
  ];
  for (const url of legacyProbes) {
    const probe = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    assert.equal(probe.ok, true, `HEAD ${probe.status} ${url}`);
  }
});
