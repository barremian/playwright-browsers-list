import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { generatePages } from './generate-pages.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

test('writes index.html as the site root from the browsers table', () => {
  const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-'));
  const output = generatePages({
    tableFile: path.join(ROOT, 'playwright-browsers-list.md'),
    siteDir,
  });

  assert.equal(path.basename(output), 'index.html');
  const html = fs.readFileSync(output, 'utf-8');
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<title>Playwright browsers list<\/title>/);
  assert.match(html, /<table>/);
  assert.match(html, /<strong>v1\.62\.1<\/strong>/);
  assert.match(html, /id="filter"/);
  assert.ok(html.indexOf('id="empty"') < html.indexOf('class="table-wrap"'));
  assert.equal(fs.readFileSync(path.join(siteDir, '.nojekyll'), 'utf-8'), '');
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
