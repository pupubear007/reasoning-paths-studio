// Unit tests for the expression engine embedded in index.html.
//
// index.html is a single self-contained page, so these tests pull the
// engine's source out of it by marker comments and evaluate it in isolation.
// The engine is pure JS (no DOM / three.js), so this is safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function slice(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  const b = html.indexOf(endMarker, a);
  assert.ok(a >= 0 && b > a, `markers not found: ${startMarker} … ${endMarker}`);
  return html.slice(a, b);
}

const src = [
  slice('const EXPR_FUNCS = {', '// ---------- Seeded RNG'),
  slice('function encodeChaosDefs(', 'const INT_CSV_KEYS'),
  slice('function buildComplexChaoticExpressions(', '// ==================== v8/v9 Surprise support'),
].join('\n');

const E = new Function(`${src}
  return { parseExpr, evalNode, compileExpr, tryEvalExpr, chaoticCompile,
           chaosVarNameError, chaosDefs, chaosDefsFromLegacy,
           encodeChaosDefs, decodeChaosDefs, buildComplexChaoticExpressions };`)();

const ev = (s, vars = {}) => E.evalNode(E.parseExpr(s), vars);

test('arithmetic precedence and associativity', () => {
  assert.equal(ev('1 + 2 * 3'), 7);
  assert.equal(ev('-2^2'), -4);             // unary binds looser than power
  assert.equal(ev('2^3^2'), 512);           // right-associative
  assert.equal(ev('2**3'), 8);              // ** alias
  assert.equal(ev('(1 + 2) * 3'), 9);
  assert.equal(ev('1e-3 * 1000'), 1);
});

test('variables, constants and functions', () => {
  assert.equal(ev('l * 2 + m', { l: 3, m: 1 }), 7);
  assert.ok(Math.abs(ev('sin(pi / 2)') - 1) < 1e-12);
  assert.equal(ev('hypot(3, 4)'), 5);
  assert.equal(ev('atan2(0, -1)'), Math.PI);
  assert.equal(ev('ln(e)'), 1);
  assert.equal(ev('log(1000)'), 3);
});

test('rejects unknown identifiers and junk input', () => {
  assert.throws(() => ev('foo + 1'), /unknown identifier/);
  assert.throws(() => ev('bogus(1)'), /unknown function/);
  assert.throws(() => E.parseExpr('1 +'), /unexpected token/);
  assert.throws(() => E.parseExpr('alert`1`'), /unexpected character/);
  assert.deepEqual(E.tryEvalExpr('1/0', {}), { ok: false, error: 'not finite' });
});

test('chaotic codegen matches the interpreter', () => {
  const defs = [{ name: 'k', expr: '9*cos(i/61)' }, { name: 'radius', expr: 'k*k/89 + 1 + t' }];
  const fn = E.chaoticCompile(defs, { x_expr: 'radius*sin(m)', y_expr: 'k', z_expr: 'sec(i)' });
  const [x, y, z] = fn(10, 0.5, 2);
  const k = 9 * Math.cos(10 / 61);
  const radius = k * k / 89 + 1 + 0.5;
  assert.ok(Math.abs(x - radius * Math.sin(2)) < 1e-12);
  assert.ok(Math.abs(y - k) < 1e-12);
  assert.ok(Math.abs(z - 1 / Math.cos(10)) < 1e-12);
});

test('chaotic variable names are validated', () => {
  for (const bad of ['m', 't', 'i', 'x', 'pi', 'sin', '1abc', '']) {
    assert.notEqual(E.chaosVarNameError(bad, new Set()), null, `"${bad}" should be rejected`);
  }
  assert.equal(E.chaosVarNameError('theta1', new Set()), null);
  assert.match(E.chaosVarNameError('k', new Set(['k'])), /already defined/);
  // Names that aren't JS-safe identifiers can't reach `new Function`.
  assert.throws(() => E.chaoticCompile([{ name: 'a;alert(1)', expr: '1' }],
                                       { x_expr: '0', y_expr: '0', z_expr: '0' }));
});

test('defs CSV cell encoding round-trips special characters', () => {
  const defs = [{ name: 'a', expr: 'hypot(i, t) ~ 1' }, { name: 'b', expr: 'a|b:c' }];
  assert.deepEqual(E.decodeChaosDefs(E.encodeChaosDefs(defs)), defs);
});

test('every Surprise scene compiles', () => {
  for (const scene of ['wave_field', 'attractor_garden', 'crystal_ritual',
                       'interference_veil', 'spiral_bloom']) {
    for (let n = 0; n < 5; n++) {               // randomized coefficients
      const g = E.buildComplexChaoticExpressions(scene);
      const fn = E.chaoticCompile(g.defs, { x_expr: g.x, y_expr: g.y, z_expr: g.z });
      const out = fn(100, 0.3, 0);
      assert.ok(out.every(Number.isFinite), `${scene} produced non-finite output`);
    }
  }
});
