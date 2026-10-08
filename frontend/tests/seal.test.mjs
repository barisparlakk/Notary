// Mühür: deterministik, hash'e duyarlı, sınırlı ve geçerli.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { sealSpec, curvePath, tickPath, sealSvg, SEAL_INK } from '../src/lib/seal.js';

const H1 = createHash('sha256').update('contract v1').digest('hex');
const H2 = createHash('sha256').update('contract v2').digest('hex');

test('aynı hash her zaman aynı mührü verir', () => {
  assert.deepEqual(sealSpec(H1), sealSpec(H1));
  assert.equal(sealSvg(H1), sealSvg(H1));
  assert.equal(sealSvg(H1.toUpperCase()), sealSvg(H1)); // büyük/küçük harf fark etmez
});

test('farklı hash farklı mühür verir; tek karakter değişimi bile', () => {
  assert.notEqual(sealSvg(H1), sealSvg(H2));
  const flipped = (H1[0] === 'a' ? 'b' : 'a') + H1.slice(1);
  assert.notEqual(sealSvg(flipped), sealSvg(H1));
});

test('hash\'teki HER karakter desene yansır: 64 konum x 15 alternatif', () => {
  const base = sealSvg(H1);
  let checked = 0;
  for (let i = 0; i < 64; i++) {
    for (const h of '0123456789abcdef') {
      if (h === H1[i]) continue;
      const other = H1.slice(0, i) + h + H1.slice(i + 1);
      assert.notEqual(sealSvg(other), base, `konum ${i} -> ${h} mührü değiştirmedi`);
      checked++;
    }
  }
  assert.equal(checked, 64 * 15);
});

test('300 rastgele hash için 300 ayrı mühür (çakışma yok)', () => {
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(sealSvg(randomBytes(32).toString('hex'), { size: 10 }));
  assert.equal(seen.size, 300);
});

test('eğriler çerçevenin içinde kalır, sayılar sonlu, nokta sayısı sınırlı', () => {
  for (let i = 0; i < 100; i++) {
    const spec = sealSpec(randomBytes(32).toString('hex'));
    assert.equal(spec.ticks.length, 64);
    assert.ok(spec.ticks.every((t) => Number.isInteger(t) && t >= 0 && t <= 15));
    for (const c of spec.curves) {
      const path = curvePath(c);
      const nums = path.match(/-?\d+\.\d/g).map(Number);
      assert.ok(nums.every(Number.isFinite));
      assert.ok(Math.max(...nums.map(Math.abs)) <= 90, 'iç çemberin dışına taşmaz');
      assert.ok(nums.length / 2 <= 1801, 'nokta sayısı sınırlı');
    }
  }
  assert.ok(tickPath([0, 15, 7]).startsWith('M'));
});

test('geçersiz hash reddedilir', () => {
  for (const bad of ['', 'abc', 'z'.repeat(64), H1 + 'a', null]) assert.throws(() => sealSpec(bad), /seal/);
});

test('SVG geçerli bir belge: durum rengi ve DEMO işareti', () => {
  const svg = sealSvg(H1, { state: 'altered', demo: true });
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert.ok(svg.includes(SEAL_INK.altered));
  assert.ok(svg.includes('DEMO') && svg.includes('stroke-dasharray'));
  assert.ok(!sealSvg(H1).includes('DEMO'));
});
