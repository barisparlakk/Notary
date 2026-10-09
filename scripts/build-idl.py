#!/usr/bin/env python3
"""Anchor CLI olmadan IDL üretir: `idl-build` özelliğiyle programın kendi IDL çıktısını toplayıp program/idl/notary.json'a yazar.

    python3 scripts/build-idl.py          # yazar
    python3 scripts/build-idl.py --check  # dosya güncel değilse 1 ile çıkar (CI)

Gereksinim: Rust (cargo). Anchor CLI gerekmez.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROGRAM = ROOT / "program"
OUT = PROGRAM / "idl" / "notary.json"
SECTION = re.compile(r"--- IDL begin (\w+)[^\n]*---\n(.*?)--- IDL end \1[^\n]*---", re.S)


def build() -> dict:
    run = subprocess.run(
        ["cargo", "test", "--manifest-path", "programs/notary/Cargo.toml", "--features", "idl-build",
         "__anchor_private_print_idl", "--", "--show-output", "--test-threads=1"],
        cwd=PROGRAM, capture_output=True, text=True,
    )
    if run.returncode != 0:
        sys.exit(run.stderr[-2000:])
    idl, events, errors, types, address = None, [], [], {}, None
    for kind, body in SECTION.findall(run.stdout):
        data = json.loads(body)
        if kind == "program":
            idl = data
        elif kind == "address":
            address = data
        elif kind == "errors":
            errors = data
        elif kind == "event":
            events.append({"name": data["event"]["name"].split("::")[-1], "discriminator": data["event"]["discriminator"]})
            for t in data.get("types", []):
                types[t["name"]] = t
    if idl is None or address is None:
        sys.exit("IDL çıktısı bulunamadı (idl-build özelliği çalışmadı mı?)")
    idl["address"] = json.loads(address) if isinstance(address, str) and address.startswith('"') else address
    idl["errors"] = errors
    idl["events"] = sorted(events, key=lambda e: e["name"])
    have = {t["name"] for t in idl.get("types", [])}
    idl["types"] = idl.get("types", []) + [t for n, t in sorted(types.items()) if n not in have]
    return short_names(idl)


def short_names(node):
    """`notary::Proof` -> `Proof` (Anchor IDL'inde kısa adlar kullanılır)."""
    if isinstance(node, dict):
        return {k: (v.split("::")[-1] if k == "name" and isinstance(v, str) else short_names(v)) for k, v in node.items()}
    if isinstance(node, list):
        return [short_names(x) for x in node]
    return node


def main() -> int:
    text = json.dumps(build(), indent=2, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        return 0 if OUT.exists() and OUT.read_text() == text else 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text)
    print(f"yazıldı: {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
