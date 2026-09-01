#!/usr/bin/env node
// Scans microsoft/playwright for release tags that are not yet recorded in
// playwright-releases.json, fetches browsers.json for each new tag, and appends
// the release to the catalog.
//
// Usage: node update-browsers-list.mjs [--dry-run]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  browsersFromPlaywright,
  compareVersions,
  readReleasesJson,
  toStoredRelease,
  writeReleasesJson,
} from './releases.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const RELEASES_FILE = path.join(ROOT, 'playwright-releases.json');

const PLAYWRIGHT_REPO = 'https://github.com/microsoft/playwright.git';
const BROWSERS_JSON_URL = tag =>
  `https://raw.githubusercontent.com/microsoft/playwright/${tag}/packages/playwright-core/browsers.json`;

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

async function fetchBrowsersJson(tag) {
  const response = await fetch(BROWSERS_JSON_URL(tag));
  if (!response.ok)
    throw new Error(`HTTP ${response.status} for ${tag}`);
  return response.json();
}

async function main() {
  console.log(`Reading ${path.basename(RELEASES_FILE)}...`);
  const known = readReleasesJson(RELEASES_FILE);
  const knownTagNames = new Set(known.map(entry => entry.tag.trim()));

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

  const added = [];
  for (const [index, entry] of newTags.entries()) {
    try {
      console.log(`[${index + 1}/${newTags.length}] Fetching browsers.json for ${entry.tag}...`);
      const json = await fetchBrowsersJson(entry.tag);
      added.push(toStoredRelease({
        tag: entry.tag,
        createdAt: entry.createdAt,
        browsers: browsersFromPlaywright(json.browsers),
      }));
    } catch (error) {
      console.warn(`skip ${entry.tag}: ${error.message}`);
    }
  }

  if (!added.length) {
    console.log('No browsers.json could be fetched for the new tags.');
    return;
  }

  if (DRY_RUN) {
    console.log(`[dry-run] would add ${added.length} tag(s) to ${path.basename(RELEASES_FILE)}`);
    return;
  }

  console.log('Writing files...');
  writeReleasesJson(RELEASES_FILE, [...known, ...added]);
  console.log(`Added ${added.length} tag(s) to ${path.basename(RELEASES_FILE)}.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
