#!/usr/bin/env node
// Contract for Playwright browser/tool download hosts and path templates.
// The canary extracts the same fields from microsoft/playwright so CDN or
// path-template drift fails CI instead of shipping dead links.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REGISTRY_FILE = path.join(ROOT, 'playwright-download-registry.json');
export const PLAYWRIGHT_REGISTRY_SOURCE =
  'https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/server/registry/index.ts';

export function loadDownloadRegistry(file = REGISTRY_FILE) {
  const registry = JSON.parse(fs.readFileSync(file, 'utf-8'));
  assertContract(registry, file);
  return registry;
}

export const LEGACY_CHROMIUM_NAMES = ['chromium', 'chromium-headless-shell'];

export function extractDownloadContract(source) {
  const mirrors = extractQuotedUrls(requireBlock(source, /const PLAYWRIGHT_CDN_MIRRORS\s*=\s*\[([\s\S]*?)\];/, 'PLAYWRIGHT_CDN_MIRRORS'));
  const chromiumMirrors = extractQuotedUrls(requireBlock(source, /function cftUrl\([\s\S]*?mirrors:\s*\[([\s\S]*?)\]/, 'cftUrl mirrors'));
  const pathTemplates = extractPathTemplates(source);
  if (!mirrors.length)
    throw new Error('PLAYWRIGHT_CDN_MIRRORS did not contain any https URLs');
  if (!chromiumMirrors.length)
    throw new Error('cftUrl mirrors did not contain any https URLs');
  if (!Object.keys(pathTemplates).length)
    throw new Error('DOWNLOAD_PATHS did not contain any path templates');
  return { source: PLAYWRIGHT_REGISTRY_SOURCE, mirrors, chromiumMirrors, pathTemplates };
}

export function extractLegacyChromiumTemplates(source) {
  const all = extractPathTemplates(source);
  const templates = {};
  for (const name of LEGACY_CHROMIUM_NAMES) {
    if (!all[name] || !Object.keys(all[name]).length)
      throw new Error(`legacy DOWNLOAD_PATHS is missing templates for ${name}`);
    templates[name] = all[name];
  }
  return templates;
}

export function contractSnapshot(registry) {
  const pathTemplates = Object.fromEntries(
    Object.keys(registry.pathTemplates).sort().map(name => [
      name,
      Object.fromEntries(
        Object.keys(registry.pathTemplates[name]).sort().map(platform => [
          platform,
          registry.pathTemplates[name][platform],
        ]),
      ),
    ]),
  );
  return {
    mirrors: [...registry.mirrors],
    chromiumMirrors: [...registry.chromiumMirrors],
    pathTemplates,
  };
}

export function diffDownloadContracts(expected, actual) {
  const left = JSON.stringify(contractSnapshot(expected), null, 2);
  const right = JSON.stringify(contractSnapshot(actual), null, 2);
  if (left === right)
    return null;
  return { expected: contractSnapshot(expected), actual: contractSnapshot(actual) };
}

function assertContract(registry, file) {
  for (const key of ['source', 'mirrors', 'chromiumMirrors', 'pathTemplates', 'legacyPathTemplates']) {
    if (registry[key] == null)
      throw new Error(`${file} is missing "${key}"`);
  }
  if (!Array.isArray(registry.mirrors) || !registry.mirrors.length)
    throw new Error(`${file} must list at least one CDN mirror`);
  if (!Array.isArray(registry.chromiumMirrors) || !registry.chromiumMirrors.length)
    throw new Error(`${file} must list at least one Chromium CDN mirror`);
  if (!registry.pathTemplates || typeof registry.pathTemplates !== 'object')
    throw new Error(`${file} must contain pathTemplates`);
  for (const name of LEGACY_CHROMIUM_NAMES) {
    if (!registry.legacyPathTemplates[name] || !Object.keys(registry.legacyPathTemplates[name]).length)
      throw new Error(`${file} must contain legacyPathTemplates.${name}`);
  }
}

function requireBlock(source, pattern, label) {
  const match = source.match(pattern);
  if (!match)
    throw new Error(`could not find ${label} in Playwright registry source`);
  return match[1];
}

function extractQuotedUrls(block) {
  return [...block.matchAll(/'(https:\/\/[^']+)'/g)].map(match => match[1]);
}

function extractDownloadPathsBlock(source) {
  const start = source.indexOf('const DOWNLOAD_PATHS');
  if (start === -1)
    throw new Error('could not find DOWNLOAD_PATHS in Playwright registry source');
  const brace = source.indexOf('{', start);
  if (brace === -1)
    throw new Error('DOWNLOAD_PATHS is missing an object literal');
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{')
      depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0)
        return source.slice(brace, index + 1);
    }
  }
  throw new Error('DOWNLOAD_PATHS object is not closed');
}

export function extractPathTemplates(source) {
  const block = extractDownloadPathsBlock(source);
  const templates = {};
  const browserPattern = /'([^']+)':\s*\{([\s\S]*?)\n\s*\},?/g;
  let browserMatch;
  while ((browserMatch = browserPattern.exec(block))) {
    const [, name, body] = browserMatch;
    if (name === ' ' || name === '<unknown>')
      continue;
    const platforms = {};
    const entryPattern = /'([^']+)':\s*(undefined|cftUrl\('([^']+)'\)|'([^']+)')/g;
    let entryMatch;
    while ((entryMatch = entryPattern.exec(body))) {
      const [, platform, kind, cftSuffix, literal] = entryMatch;
      if (kind === 'undefined')
        continue;
      platforms[platform] = cftSuffix != null
        ? `builds/cft/%v/${cftSuffix}`
        : literal;
    }
    if (Object.keys(platforms).length)
      templates[name] = platforms;
  }
  return templates;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const source = fs.readFileSync(process.argv[2] || 0, 'utf-8');
  process.stdout.write(`${JSON.stringify(extractDownloadContract(source), null, 2)}\n`);
}
