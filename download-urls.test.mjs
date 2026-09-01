import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadDownloadRegistry } from './download-registry.mjs';
import {
  downloadLinks,
  formatDownloadPath,
  representativeDownloadUrls,
  usesChromeForTesting,
} from './download-urls.mjs';

const registry = loadDownloadRegistry();

const cftChromium = {
  name: 'chromium',
  title: 'Chrome for Testing',
  browserVersion: '120.0.1',
  revision: '110',
  revisionOverrides: [],
};

test('usesChromeForTesting is driven by the browsers.json title', () => {
  assert.equal(usesChromeForTesting(cftChromium), true);
  assert.equal(usesChromeForTesting({
    name: 'chromium-headless-shell',
    title: 'Chrome Headless Shell',
  }), true);
  assert.equal(usesChromeForTesting({ name: 'chromium', title: null, revision: '100' }), false);
  assert.equal(usesChromeForTesting({ name: 'firefox', title: 'Firefox' }), false);
});

test('CFT chromium links use browserVersion and the Chromium CDN host', () => {
  const links = downloadLinks(cftChromium, registry);
  const mac = links.find(link => link.platform === 'mac15-arm64');
  assert.ok(mac);
  assert.equal(mac.href, 'https://cdn.playwright.dev/builds/cft/120.0.1/mac-arm64/chrome-mac-arm64.zip');
  assert.deepEqual(mac.fallbacks, []);
  assert.equal(mac.group, 'macOS');
});

test('classic tool links use the revision and the full mirror list', () => {
  const links = downloadLinks({
    name: 'ffmpeg',
    revision: '9',
    revisionOverrides: [],
  }, registry);
  const linux = links.find(link => link.platform === 'ubuntu24.04-x64');
  assert.equal(
    linux.href,
    'https://cdn.playwright.dev/dbazure/download/playwright/builds/ffmpeg/9/ffmpeg-linux.zip',
  );
  assert.deepEqual(linux.fallbacks, [
    'https://playwright.download.prss.microsoft.com/dbazure/download/playwright/builds/ffmpeg/9/ffmpeg-linux.zip',
    'https://cdn.playwright.dev/builds/ffmpeg/9/ffmpeg-linux.zip',
  ]);
});

test('revision overrides replace the revision for that platform only', () => {
  const links = downloadLinks({
    name: 'webkit',
    revision: '2336',
    revisionOverrides: [{ platform: 'mac14', revision: '2251' }],
  }, registry);
  const mac14 = links.find(link => link.platform === 'mac14');
  const mac15 = links.find(link => link.platform === 'mac15');
  assert.equal(mac14.href.endsWith('/builds/webkit/2251/webkit-mac-14.zip'), true);
  assert.equal(mac15.href.endsWith('/builds/webkit/2336/webkit-mac-15.zip'), true);
});

test('classic chromium links use the revision and the full mirror list', () => {
  const links = downloadLinks({
    name: 'chromium',
    revision: '1200',
    title: null,
  }, registry);
  const mac = links.find(link => link.platform === 'mac15-arm64');
  assert.equal(
    mac.href,
    'https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/1200/chromium-mac-arm64.zip',
  );
  assert.deepEqual(mac.fallbacks, [
    'https://playwright.download.prss.microsoft.com/dbazure/download/playwright/builds/chromium/1200/chromium-mac-arm64.zip',
    'https://cdn.playwright.dev/builds/chromium/1200/chromium-mac-arm64.zip',
  ]);
  assert.equal(links.some(link => link.href.includes('/builds/cft/')), false);
});

test('classic headless-shell links use the chromium revision path', () => {
  const links = downloadLinks({
    name: 'chromium-headless-shell',
    revision: '1148',
  }, registry);
  const linux = links.find(link => link.platform === 'ubuntu24.04-x64');
  assert.equal(linux.href.endsWith('/builds/chromium/1148/chromium-headless-shell-linux.zip'), true);
});

test('skips links that would require inventing a path', () => {
  assert.deepEqual(downloadLinks({ name: 'chromium', title: null }, registry), []);
  assert.deepEqual(downloadLinks({ name: 'chromium', title: 'Chrome for Testing' }, registry), []);
  assert.deepEqual(downloadLinks({ name: 'firefox' }, registry), []);
  assert.deepEqual(downloadLinks({ name: 'unknown', revision: '1' }, registry), []);
});

test('android collapses to a single zip and skips the unknown host-platform key', () => {
  const links = downloadLinks({ name: 'android', revision: '1001' }, registry);
  assert.equal(links.length, 1);
  assert.equal(links[0].platform, 'android');
  assert.equal(links[0].href.endsWith('/builds/android/1001/android.zip'), true);
  assert.equal(links.some(link => link.platform === '<unknown>' || link.platform === ' '), false);
});

test('formatDownloadPath fills CFT and revision placeholders', () => {
  assert.equal(
    formatDownloadPath('builds/cft/%v/mac-arm64/chrome-mac-arm64.zip', { browserVersion: '1.2.3' }),
    'builds/cft/1.2.3/mac-arm64/chrome-mac-arm64.zip',
  );
  assert.equal(formatDownloadPath('builds/firefox/%s/firefox-mac.zip', { revision: '1538' }), 'builds/firefox/1538/firefox-mac.zip');
  assert.equal(formatDownloadPath('builds/cft/%v/win64/chrome-win64.zip', { revision: '1' }), null);
});

test('representativeDownloadUrls picks one URL per browser', () => {
  const urls = representativeDownloadUrls({
    browsers: {
      chromium: cftChromium,
      ffmpeg: { name: 'ffmpeg', revision: '1011' },
    },
  }, registry);
  assert.equal(urls.length, 2);
  assert.ok(urls.some(url => url.includes('/builds/cft/120.0.1/linux64/chrome-linux64.zip')));
  assert.ok(urls.some(url => url.includes('/builds/ffmpeg/1011/ffmpeg-linux.zip')));
});
