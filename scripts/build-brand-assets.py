#!/usr/bin/env python3
"""Notary logosundan tüm marka varlıklarını üretir: favicon seti, dokunma ikonu, manifest ikonları, logo, sosyal kart ve
PDF sertifikaya gömülen küçük logo (frontend/src/lib/logoData.js).

    python3 scripts/build-brand-assets.py

Kaynak: docs/brand/notary-logo.webp (saydam arka planlı, parıltılı halka + N). Gereksinim: Pillow, numpy.
"""
import base64
import io
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "brand" / "notary-logo.webp"
PUB = ROOT / "frontend" / "public"
PAPER = (245, 246, 248)  # tailwind `paper`


def ring_logo() -> Image.Image:
    """Halkaya sıkı kırpar ve parıltıyı kırpma kenarına varmadan yumuşakça sıfırlar (kare kenar görünmesin)."""
    im = Image.open(SRC).convert("RGBA")
    alpha = np.array(im)[:, :, 3]
    ys, xs = np.where(alpha > 200)
    cx, cy, r = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2, (xs.max() - xs.min()) / 2
    half = r * 1.08
    crop = im.crop((int(cx - half), int(cy - half), int(cx + half), int(cy + half)))
    n = crop.size[0]
    yy, xx = np.mgrid[0:n, 0:n]
    dist = np.hypot(xx - n / 2, yy - n / 2)
    fade = np.clip((n / 2 - dist) / (n / 2 - r * 1.0), 0, 1)  # halka yarıçapından kırpma kenarına kadar 1 -> 0
    fade = fade * fade * (3 - 2 * fade)
    out = np.array(crop)
    out[:, :, 3] = (out[:, :, 3] * fade).astype(np.uint8)
    return Image.fromarray(out)


def font(size, bold=False):
    for p in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/HelveticaNeue.ttc", "/Library/Fonts/Arial.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size, index=1 if bold and p.endswith(".ttc") else 0)
            except Exception:
                return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def main():
    ring = ring_logo()
    sized = lambda n: ring.resize((n, n), Image.LANCZOS)  # noqa: E731
    PUB.mkdir(parents=True, exist_ok=True)
    sized(256).save(PUB / "logo.png", optimize=True)
    sized(512).save(PUB / "favicon-512.png", optimize=True)
    sized(192).save(PUB / "favicon-192.png", optimize=True)
    sized(32).save(PUB / "favicon-32.png", optimize=True)
    ring.resize((256, 256), Image.LANCZOS).save(PUB / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    touch = Image.new("RGBA", (180, 180), (255, 255, 255, 255))  # iOS saydamlığı siyaha boyar: opak beyaz zemin
    touch.alpha_composite(sized(164), (8, 8))
    touch.convert("RGB").save(PUB / "apple-touch-icon.png", optimize=True)

    card = Image.new("RGBA", (1200, 630), PAPER + (255,))
    card.alpha_composite(sized(380), (110, 125))
    d = ImageDraw.Draw(card)
    d.text((540, 215), "Notary", font=font(104, True), fill=(17, 24, 39, 255))
    d.text((544, 345), "Verifiable documents and", font=font(40), fill=(75, 85, 99, 255))
    d.text((544, 397), "agent provenance on Solana", font=font(40), fill=(75, 85, 99, 255))
    d.text((544, 470), "Check a file against its on-chain record.", font=font(30), fill=(107, 114, 128, 255))
    card.convert("RGB").save(PUB / "og-image.png", optimize=True)

    buf = io.BytesIO()
    sized(160).save(buf, "PNG", optimize=True)
    (ROOT / "frontend" / "src" / "lib" / "logoData.js").write_text(
        "// Notary logosu (160 px PNG), PDF sertifikaya gömülür. Üreten: scripts/build-brand-assets.py\n"
        "export const LOGO_PNG_DATA_URL =\n  'data:image/png;base64," + base64.b64encode(buf.getvalue()).decode() + "';\n"
    )
    print("marka varlıkları yazıldı:", ", ".join(sorted(p.name for p in PUB.iterdir() if p.suffix in (".png", ".ico"))))


if __name__ == "__main__":
    main()
