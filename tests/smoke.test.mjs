// Headless-browser smoke test: open index.html, exercise the main controls,
// and fail on any uncaught page error. three.js is served from node_modules
// instead of unpkg, and Google Fonts requests are dropped, so the test runs
// offline.
//
// Uses Playwright's bundled Chromium by default; set CHROMIUM_PATH to point
// at a different Chrome/Chromium binary.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = new URL('../', import.meta.url);
const pageUrl = new URL('index.html', root).href;
const threeDir = fileURLToPath(new URL('node_modules/three/', root));

let browser, page;
const errors = [];

before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.dismiss());
  await page.route('https://unpkg.com/three@0.160.0/**', (route) => {
    const rel = new URL(route.request().url()).pathname.replace('/three@0.160.0/', '');
    route.fulfill({ contentType: 'text/javascript', body: readFileSync(threeDir + rel) });
  });
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await page.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await page.goto(pageUrl);
  await page.waitForFunction(() => document.getElementById('st_seed')?.textContent === '0x42a1');
});

after(async () => { await browser?.close(); });

test('boots without errors and renders the readout', async () => {
  assert.equal(await page.textContent('#lg_ded_n'), '6');   // 5 steps + start
  assert.equal(await page.textContent('#lg_ind_n'), '11');  // 10 iterations + start
  assert.deepEqual(errors, []);
});

test('add / duplicate buttons create instances', async () => {
  await page.click('#btn_ded_add');
  await page.click('#btn_ind_clone');
  await page.click('#btn_chaos_add');
  assert.equal(await page.textContent('#ded_panel_tag'), '02');
  assert.equal(await page.textContent('#ind_panel_tag'), '02');
  assert.equal(await page.textContent('#chaos_panel_tag'), '01');
  assert.deepEqual(errors, []);
});

test('Surprise me produces chaotic instances that compile', async () => {
  // Click via the DOM: headless WebGL is software-rendered, and with several
  // animated 10k-point clouds on screen Playwright's actionability checks
  // (which wait on animation frames) get very slow.
  for (let n = 0; n < 6; n++) await page.$eval('#btn_surprise', b => b.click());
  await page.waitForTimeout(300);
  const eqn = await page.textContent('#eqn_panel_body');
  assert.ok(!eqn.includes('⚠'), 'a chaotic instance failed to compile:\n' +
    eqn.split('\n').filter(l => l.includes('⚠')).join('\n'));
  assert.deepEqual(errors, []);
});

test('project save keeps the movement-track fade expression', async () => {
  await page.$eval('#track_fade_var__d1', el => {
    el.value = 'l*0.5';
    el.dispatchEvent(new Event('input'));
  });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.$eval('#btn_project_save', b => b.click()),
  ]);
  const project = JSON.parse(readFileSync(await download.path(), 'utf8'));
  const primary = project.instances.ded.find(i => i.isPrimary);
  assert.equal(primary.track.fadeVarExpr, 'l*0.5');
});

test('walks run and reset cleanly', async () => {
  const click = (sel) => page.$eval(sel, b => b.click());
  await click('#btn_walk_all');
  await page.waitForTimeout(600);
  await click('#btn_walk_all');
  await click('#btn_walk_reset');
  assert.deepEqual(errors, []);
});

// ---------- Project save / load ----------

const click = (sel) => page.$eval(sel, b => b.click());
const countCards = () => page.$$eval('.inst-card', cs => ({
  ded: cs.filter(c => c.dataset.kind === 'ded').length,
  ind: cs.filter(c => c.dataset.kind === 'ind').length,
  chaos: cs.filter(c => c.dataset.kind === 'chaos').length,
}));

async function saveProject() {
  const [download] = await Promise.all([page.waitForEvent('download'), click('#btn_project_save')]);
  return readFileSync(await download.path(), 'utf8');
}
async function loadProject(file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), click('#btn_project_load')]);
  await chooser.setFiles(file);
  await page.waitForFunction(() => [...document.querySelectorAll('div')]
    .some(d => d.textContent === 'Project loaded ✓'));
}

test('loading a project replaces the scene instead of duplicating it', async () => {
  // Give the second deductive card a distinctive value and a label.
  await page.$eval('#start_x__d2', el => { el.value = '1.7'; el.dispatchEvent(new Event('input')); });
  const json = await saveProject();
  const saved = JSON.parse(json);
  const before = await countCards();
  assert.equal(before.ded, saved.instances.ded.length);

  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const file = join(mkdtempSync(join(tmpdir(), 'rp-')), 'project.json');
  writeFileSync(file, json);

  for (let n = 0; n < 2; n++) {            // loading twice must not stack cards
    await loadProject(file);
    assert.deepEqual(await countCards(), {
      ded: saved.instances.ded.length,
      ind: saved.instances.ind.length,
      chaos: saved.instances.chaos.length,
    });
  }
  assert.equal(await page.inputValue('#start_x__d2'), '1.7');
  // The former primary keeps its values (it now lives on its own card).
  assert.equal(await page.inputValue('#steps__d1'), String(saved.state.steps));
  const beyondCards = await page.$$eval('.beyond-card', cs => cs.length);
  const savedBeyond = Object.values(saved.beyond).reduce((n, l) => n + l.length, 0);
  assert.equal(beyondCards, savedBeyond);
  assert.deepEqual(errors, []);
});

test('Clear canvas, then Preset and + Add still work', async () => {
  await click('#btn_clear');
  assert.deepEqual(await countCards(), { ded: 0, ind: 0, chaos: 0 });
  await click('#btn_ded_add');
  await click('#btn_preset');
  assert.equal(await page.textContent('#ded_panel_tag'), '01');
  assert.deepEqual(errors, []);
});

test('autosave restores the session after a reload', async () => {
  await click('#autosave_status');                         // turn autosave on
  await click('#btn_ind_add');
  await page.waitForTimeout(1200);                         // autosave debounce
  const before = await countCards();
  await page.reload();
  await page.waitForFunction(() => document.getElementById('st_seed')?.textContent);
  assert.equal(await page.textContent('#autosave_status'), 'restored');
  assert.deepEqual(await countCards(), before);
  await click('#autosave_status');                         // leave it off
  assert.deepEqual(errors, []);
});
