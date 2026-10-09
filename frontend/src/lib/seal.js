// Mühür: bir dosyanın SHA-256 hash'inden deterministik olarak çizilen guilloche (hipotrokoid) deseni.
// Aynı hash her zaman aynı mührü verir; hash'te tek karakter değişirse desen bambaşka olur. Böylece "dosya değişti"
// ifadesi bir cümle değil, gözle görülen bir fark olur. Saf fonksiyonlar: React'e ya da tarayıcıya bağlı değil.

export const SEAL_VIEWBOX = '-120 -120 240 240';
export const SEAL_INK = {
  verified: '#0F7B5F',
  altered: '#C2362F',
  pending: '#3057D5',
  neutral: '#5F6678',
  revoked: '#A15C07',
};

const HEX64 = /^[0-9a-f]{64}$/i;
const R = 96; // sabit dış çember yarıçapı (hipotrokoid)
const FIT = 84; // çizimin sığdırıldığı yarıçap

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

function toBytes(hex) {
  if (!HEX64.test(hex)) throw new Error('seal: hash 64 karakterlik SHA-256 hex olmalı');
  return Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));
}

/** Hash'ten desen parametreleri (saf, hızlı). */
export function sealSpec(hashHex) {
  const b = toBytes(hashHex);
  const curves = [0, 1, 2].map((i) => {
    const r = 5 + (b[1 + i * 3] % 36); // 5..40
    const d = r * (0.55 + (b[2 + i * 3] / 255) * 0.9); // kalem mesafesi
    // ilk 10 bayt şekli, kalan baytlar açıyı belirler: hiçbir bayt desene katkısız değil
    const mix = b.reduce((acc, v, j) => (j >= 10 && (j - 10) % 3 === i ? (acc + v) % 256 : acc), 0);
    const rot = (((b[3 + i * 3] + mix) % 256) / 256) * 360;
    return { r, d: Math.round(d * 100) / 100, rot: Math.round(rot * 10) / 10 };
  });
  // Dış halka hash'in kendisini kodlar: 64 hex hanesi = 64 çizgi, boy = hanenin değeri (0..15).
  // Hash'teki herhangi bir karakter değişirse halka mutlaka değişir; desen yalnızca bu yüzden "tam" bir parmak izidir.
  const ticks = [...hashHex.toLowerCase()].map((h) => parseInt(h, 16));
  return { ticks, curves };
}

/** Bir hipotrokoid eğrisinin noktaları (merkezde, FIT yarıçapına ölçeklenmiş, döndürülmemiş). */
export function curvePoints({ r, d }) {
  const k = (R - r) / r;
  const loops = r / gcd(R, r); // eğrinin kapanması için gereken tur
  const steps = Math.min(loops * 48, 1800);
  const scale = FIT / (R - r + d);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2 * loops;
    pts.push([
      ((R - r) * Math.cos(t) + d * Math.cos(k * t)) * scale,
      ((R - r) * Math.sin(t) - d * Math.sin(k * t)) * scale,
    ]);
  }
  return pts;
}

/** Aynı eğrinin SVG yol verisi. */
export function curvePath(c) {
  return curvePoints(c).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
}

/** Dış halka çizgileri [[x1,y1,x2,y2],...] (PDF gibi vektör hedefler için). */
export function tickSegments(ticks) {
  const n = ticks.length;
  return ticks.map((t, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r1 = 107 - 1.5 - t * 0.55;
    return [Math.cos(a) * r1, Math.sin(a) * r1, Math.cos(a) * 108, Math.sin(a) * 108];
  });
}

/** Dış halkadaki çizgiler: i. çizginin boyu i. hex hanesine (0..15) bağlı. */
export function tickPath(ticks) {
  const n = ticks.length;
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2; // üstten başlar
    const r1 = 107 - 1.5 - ticks[i] * 0.55; // 0 -> kısa, 15 -> uzun
    out += `M${(Math.cos(a) * r1).toFixed(2)} ${(Math.sin(a) * r1).toFixed(2)}L${(Math.cos(a) * 108).toFixed(2)} ${(Math.sin(a) * 108).toFixed(2)}`;
  }
  return out;
}

/** Bağımsız SVG metni (PDF sertifikaya gömmek ve testler için). */
export function sealSvg(hashHex, { state = 'verified', size = 240, demo = false } = {}) {
  const spec = sealSpec(hashHex);
  const color = SEAL_INK[state] || SEAL_INK.neutral;
  const curves = spec.curves
    .map((c) => `<path d="${curvePath(c)}" transform="rotate(${c.rot})" fill="none" stroke="${color}" stroke-width="0.55" opacity="0.85"/>`)
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${SEAL_VIEWBOX}" width="${size}" height="${size}">`
    + `<circle r="116" fill="none" stroke="${color}" stroke-width="1.6"${demo ? ' stroke-dasharray="5 4"' : ''}/>`
    + `<circle r="111" fill="none" stroke="${color}" stroke-width="0.6"/>`
    + `<path d="${tickPath(spec.ticks)}" stroke="${color}" stroke-width="0.8" fill="none"/>`
    + curves
    + `<circle r="14" fill="#fff" stroke="${color}" stroke-width="0.8"/>`
    + (demo ? `<text y="5" text-anchor="middle" font-size="13" font-weight="700" fill="${color}" opacity="0.7" letter-spacing="2">DEMO</text>` : '')
    + '</svg>'
  );
}
