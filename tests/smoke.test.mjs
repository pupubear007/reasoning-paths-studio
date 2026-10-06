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
  await page.waitForFunction(() => document.getElementById('st_seed')?.textContent === '0x42a1',
                             null, { polling: 100 });
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
  const loads = await page.evaluate(() => +document.body.dataset.projectLoads || 0);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), click('#btn_project_load')]);
  await chooser.setFiles(file);
  // Poll on a timer, not on animation frames: software-rendered frames can
  // be several hundred ms apart on CI runners.
  await page.waitForFunction(n => (+document.body.dataset.projectLoads || 0) > n, loads,
                             { polling: 100, timeout: 60000 });
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
  await page.waitForFunction(() => document.getElementById('st_seed')?.textContent,
                             null, { polling: 100 });
  assert.equal(await page.textContent('#autosave_status'), 'restored');
  assert.deepEqual(await countCards(), before);
  await click('#autosave_status');                         // leave it off
  assert.deepEqual(errors, []);
});

// ---------- Limits & live Chaotic updates ----------

test('huge Steps / Iterations values are capped instead of freezing the page', async () => {
  await click('#btn_ded_add');
  const sx = await page.$eval('#ded_instances_host .inst-card:last-child', c => 'd' + c.dataset.instId);
  await page.$eval(`#steps__${sx}`, el => { el.value = '10000000'; el.dispatchEvent(new Event('input')); });
  assert.equal(await page.textContent(`#steps_val__${sx}`), '5000');
  await click('#btn_chaos_add');
  const cx = await page.$eval('.inst-card.chaos:last-of-type', c => 'x' + c.dataset.instId);
  await page.$eval(`#iterations__${cx}`, el => { el.value = '1e9'; el.dispatchEvent(new Event('input')); });
  assert.equal(await page.textContent(`#iterations_val__${cx}`), '200000');
  assert.deepEqual(errors, []);
});

test('animating a Chaotic cloud with the line overlay updates in place', async () => {
  const cx = await page.$eval('.inst-card.chaos:last-of-type', c => 'x' + c.dataset.instId);
  await page.$eval(`#iterations__${cx}`, el => { el.value = '2000'; el.dispatchEvent(new Event('input')); });
  await click(`[data-param-btn="show_line"][data-param-val="on"][data-suffix="${cx}"]`);
  await click(`[data-chaotic-play="${cx}"]`);
  const t0 = Number(await page.inputValue(`#local_t__${cx}`));
  await page.waitForFunction(([id, t]) => Number(document.getElementById(id).value) > t,
                             [`local_t__${cx}`, t0], { polling: 100 });
  await click(`[data-chaotic-play="${cx}"]`);
  assert.deepEqual(errors, []);
});

// ---------- Undo / redo ----------

const settle = () => page.waitForTimeout(700);   // history captures 400 ms after edits

test('undo and redo step through scene edits', async () => {
  await settle();
  const start = await countCards();
  await click('#btn_ded_add');
  await settle();
  await click('#btn_ind_add');
  await settle();
  assert.deepEqual(await countCards(), { ...start, ded: start.ded + 1, ind: start.ind + 1 });

  await click('#btn_undo');
  assert.deepEqual(await countCards(), { ...start, ded: start.ded + 1 });
  await page.$eval('body', b => b.focus());
  await page.keyboard.press('Control+z');
  assert.deepEqual(await countCards(), start);
  await page.keyboard.press('Control+Shift+z');
  assert.deepEqual(await countCards(), { ...start, ded: start.ded + 1 });
  await click('#btn_redo');
  assert.deepEqual(await countCards(), { ...start, ded: start.ded + 1, ind: start.ind + 1 });
  assert.equal(await page.$eval('#btn_redo', b => b.disabled), true);

  // A new edit after undo drops the redo branch.
  await click('#btn_undo');
  await click('#btn_chaos_add');
  await settle();
  assert.equal(await page.$eval('#btn_redo', b => b.disabled), true);
  assert.deepEqual(errors, []);
});

// ---------- Shareable links ----------

test('a shared link reproduces the scene', async () => {
  const sx = await page.$eval('#ded_instances_host .inst-card:last-child', c => 'd' + c.dataset.instId);
  await page.$eval(`#start_x__${sx}`, el => { el.value = '-1.3'; el.dispatchEvent(new Event('input')); });
  const expected = await countCards();
  await click('#btn_share');
  await page.waitForSelector('#share_url');
  const url = await page.inputValue('#share_url');
  assert.match(url, /#scene=[A-Za-z0-9_-]+$/);

  // Fresh page load from the link.
  await page.goto('about:blank');
  await page.goto(url);
  await page.waitForFunction(() => (+document.body.dataset.projectLoads || 0) > 0, null, { polling: 100 });
  assert.deepEqual(await countCards(), expected);
  assert.equal(await page.inputValue(`#start_x__${sx}`), '-1.3');
  assert.equal(new URL(page.url()).hash, '');            // fragment consumed
  assert.deepEqual(errors, []);
});

test('a hostile shared link is sanitized', async () => {
  const { deflateRawSync } = await import('node:zlib');
  const evil = '"><img src=x onerror="window.__pwned=1">';
  const project = {
    format: 'reasoning-paths-project', version: 8,
    state: { x_inc: 'abc', steps: '9e99', showGrid: evil, vars: { l: evil, m: 2 } },
    instances: {
      ded: [{ id: 1, params: { start_x: evil, steps: 3, ded_polarity: evil },
              color: `red${evil}`, csvLabel: evil,
              expressions: { 'start_x"]': 'l', z_inc: 'm*0.1', bogus: 'l' },
              track: { on: true, max: evil, fadeVarExpr: evil } }],
      ind: [{ id: 'x', params: { sigma: {} }, color: '#abc' }],
      chaos: [{ id: 2, params: { defs: [{ name: evil, expr: evil }, null], x_expr: evil,
                                 iterations: evil, preset: evil }, color: '#00ff00' }],
    },
    beyond: { param: [{ params: { t_min: 'x', samples: evil, name: evil, color: evil } }],
              volume: [{ params: { center: [evil], grid: 8 } }] },
  };
  const enc = deflateRawSync(Buffer.from(JSON.stringify(project))).toString('base64url');
  const base = page.url().split('#')[0];
  const loads = await page.evaluate(() => +document.body.dataset.projectLoads || 0);
  await page.goto(base + '#scene=' + enc);              // same document: hashchange path
  await page.waitForFunction(n => (+document.body.dataset.projectLoads || 0) > n, loads, { polling: 100 });
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.$('img[onerror]'), null);
  assert.deepEqual(await countCards(), { ded: 1, ind: 1, chaos: 1 });
  assert.equal(await page.inputValue('#steps__d1'), '3');
  // A walk over a parameter whose saved value was junk must stay numeric.
  await click('#btn_walk_all');
  await page.waitForTimeout(500);
  await click('#btn_walk_all');
  const zinc = Number(await page.inputValue('#z_inc__d1'));
  assert.ok(Number.isFinite(zinc));
  assert.deepEqual(errors, []);
});
