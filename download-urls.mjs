// Builds Playwright browser/tool download URLs from the pinned CDN contract.

import { loadDownloadRegistry } from './download-registry.mjs';

const CFT_TITLE = /chrome for testing|headless shell/i;

export function usesChromeForTesting(browser) {
  return Boolean(browser?.name?.startsWith('chromium') && CFT_TITLE.test(browser.title ?? ''));
}

export function representativeDownloadUrls(release, registry = loadDownloadRegistry()) {
  const urls = [];
  for (const browser of Object.values(release?.browsers ?? {})) {
    const links = downloadLinks(browser, registry);
    const preferred = links.find(link => link.platform === 'ubuntu24.04-x64')
      ?? links.find(link => link.platform === 'win64')
      ?? links[0];
    if (preferred)
      urls.push(preferred.href);
  }
  return [...new Set(urls)];
}

function templatesFor(browser, registry) {
  if (usesChromeForTesting(browser))
    return registry.pathTemplates?.[browser.name];
  if (browser.name.startsWith('chromium'))
    return registry.legacyPathTemplates?.[browser.name];
  return registry.pathTemplates?.[browser.name];
}

export function downloadLinks(browser, registry = loadDownloadRegistry()) {
  if (!browser?.name)
    return [];
  const cft = usesChromeForTesting(browser);
  const templates = templatesFor(browser, registry);
  if (!templates)
    return [];
  if (cft && !browser.browserVersion)
    return [];
  if (!cft && !browser.revision)
    return [];

  const overrides = new Map(
    (browser.revisionOverrides ?? [])
      .filter(item => item.platform && item.revision)
      .map(item => [item.platform, item.revision]),
  );
  const mirrors = cft ? registry.chromiumMirrors : registry.mirrors;
  const links = [];
  const seen = new Set();

  for (const [platform, template] of Object.entries(templates)) {
    if (platform === ' ' || platform === '<unknown>')
      continue;
    const path = formatDownloadPath(template, {
      revision: overrides.get(platform) ?? browser.revision,
      browserVersion: browser.browserVersion,
    });
    if (!path)
      continue;
    const hrefs = mirrors.map(mirror => `${stripTrailingSlash(mirror)}/${path}`);
    const key = `${platform}\0${hrefs[0]}`;
    if (seen.has(key))
      continue;
    seen.add(key);
    links.push({
      platform,
      group: platformGroup(platform),
      href: hrefs[0],
      fallbacks: hrefs.slice(1),
    });
  }

  return uniqueAndroidLinks(browser.name, links);
}

export function formatDownloadPath(template, { revision, browserVersion } = {}) {
  if (!template)
    return null;
  if (template.includes('%v')) {
    if (!browserVersion)
      return null;
    return template.replaceAll('%v', browserVersion);
  }
  if (template.includes('%s')) {
    if (!revision)
      return null;
    return template.replaceAll('%s', revision);
  }
  return template;
}

function uniqueAndroidLinks(name, links) {
  if (name !== 'android')
    return links;
  const first = links[0];
  if (!first)
    return [];
  return [{ ...first, platform: 'android', group: 'android' }];
}

function platformGroup(platform) {
  if (platform.startsWith('mac'))
    return 'macOS';
  if (platform === 'win64' || platform.startsWith('win'))
    return 'Windows';
  if (platform.startsWith('ubuntu') || platform.startsWith('debian'))
    return 'Linux';
  return 'Other';
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, '');
}
