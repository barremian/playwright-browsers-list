// Load, normalize, and persist playwright-releases.json.

import fs from 'node:fs';

export const EXTRA_BROWSERS = new Set(['ffmpeg', 'winldd', 'android']);

const BROWSER_ORDER = [
  'chromium',
  'chromium-headless-shell',
  'firefox',
  'webkit',
  'ffmpeg',
  'winldd',
  'android',
];

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

export function readReleasesJson(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!Array.isArray(data))
    throw new Error(`${file} is not a JSON array`);
  return data;
}

export function loadReleases(file) {
  return readReleasesJson(file).map(normalizeRelease);
}

export function writeReleasesJson(file, releases) {
  const stored = releases
    .map(toStoredRelease)
    .sort((a, b) => compareVersions(a.tag, b.tag));
  fs.writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`);
  return stored;
}

export function normalizeRelease(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry))
    throw new Error('release entry must be an object');
  const tag = String(entry.tag ?? entry.version ?? '').trim();
  if (!tag)
    throw new Error('release entry is missing tag');
  const browsersIn = entry.browsers && typeof entry.browsers === 'object' && !Array.isArray(entry.browsers)
    ? entry.browsers
    : {};
  return {
    version: tag,
    createdAt: entry.createdAt ?? null,
    browsers: Object.fromEntries(
      Object.entries(browsersIn).map(([name, raw]) => [name, normalizeBrowser(name, raw)]),
    ),
  };
}

export function releaseHasBrowsers(release) {
  return Object.values(release.browsers).some(browserHasData);
}

export function toStoredRelease(entry) {
  const tag = String(entry.tag ?? entry.version ?? '').trim();
  if (!tag)
    throw new Error('release entry is missing tag');
  const browsersIn = entry.browsers && typeof entry.browsers === 'object' && !Array.isArray(entry.browsers)
    ? entry.browsers
    : {};
  const names = [
    ...BROWSER_ORDER.filter(name => name in browsersIn),
    ...Object.keys(browsersIn).filter(name => !BROWSER_ORDER.includes(name)).sort(),
  ];
  const browsers = {};
  for (const name of names) {
    const compact = compactBrowser(browsersIn[name]);
    if (Object.keys(compact).length)
      browsers[name] = compact;
  }
  const record = { tag };
  if (entry.createdAt)
    record.createdAt = entry.createdAt;
  record.browsers = browsers;
  return record;
}

export function browsersFromPlaywright(browsers) {
  if (!Array.isArray(browsers))
    throw new Error('browsers.json has no "browsers" array');
  return Object.fromEntries(browsers.filter(browser => browser?.name).map(browser => {
    const item = {};
    if (browser.revision != null)
      item.revision = browser.revision;
    if (browser.browserVersion != null)
      item.browserVersion = browser.browserVersion;
    if (browser.installByDefault != null)
      item.installByDefault = browser.installByDefault;
    if (browser.title != null)
      item.title = browser.title;
    if (browser.revisionOverrides != null)
      item.revisionOverrides = browser.revisionOverrides;
    return [browser.name, item];
  }));
}

function normalizeBrowser(name, raw = {}) {
  return {
    name,
    extra: EXTRA_BROWSERS.has(name),
    revision: asString(raw.revision),
    browserVersion: asString(raw.browserVersion),
    installByDefault: typeof raw.installByDefault === 'boolean' ? raw.installByDefault : null,
    title: asString(raw.title),
    revisionOverrides: normalizeOverrides(raw.revisionOverrides),
  };
}

function compactBrowser(raw = {}) {
  const item = {};
  const revision = asString(raw.revision);
  const browserVersion = asString(raw.browserVersion);
  const title = asString(raw.title);
  if (revision)
    item.revision = revision;
  if (browserVersion)
    item.browserVersion = browserVersion;
  if (typeof raw.installByDefault === 'boolean')
    item.installByDefault = raw.installByDefault;
  if (title)
    item.title = title;
  const overrides = compactOverrides(raw.revisionOverrides);
  if (overrides)
    item.revisionOverrides = overrides;
  return item;
}

function normalizeOverrides(value) {
  if (!value)
    return [];
  if (Array.isArray(value)) {
    return value
      .map(item => ({
        platform: asString(item?.platform) ?? '',
        revision: asString(item?.revision) ?? '',
      }))
      .filter(item => item.platform);
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([platform, revision]) => ({
        platform,
        revision: asString(revision) ?? '',
      }))
      .filter(item => item.platform);
  }
  return [];
}

function compactOverrides(value) {
  const items = normalizeOverrides(value);
  if (!items.length)
    return null;
  return Object.fromEntries(items.map(item => [item.platform, item.revision]));
}

function browserHasData(browser) {
  return Boolean(
    browser.revision
    || browser.browserVersion
    || browser.title
    || browser.installByDefault != null
    || browser.revisionOverrides.length,
  );
}

function asString(value) {
  if (value == null)
    return null;
  const text = String(value).trim();
  return !text || text === '-' ? null : text;
}
