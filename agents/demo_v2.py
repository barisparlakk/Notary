# v2 demo: API YOK. Agent'lar Solana PDA'sına kayıt atar, doğrulama yalnızca RPC'den okunur.
#   python demo_v2.py --mock                       (sahte RPC; program kurulumu gerekmez)
#   python demo_v2.py --rpc <url> --program <id>   (gerçek devnet + deploy edilmiş program)
import argparse
import json
import shutil
import sys
import time
from pathlib import Path

from rich.console import Console
from rich.markup import escape
from rich.panel import Panel
from rich.rule import Rule
from rich.table import Table

import mock_rpc
import onchain
from sender_agent import SHARED_DIR, write_pdf

console = Console()
VECTORS = Path(__file__).resolve().parent.parent / "docs" / "test_vectors_v2.json"


def step(n, title, delay):
    time.sleep(delay)
    console.print(Rule(f"[bold cyan]Adım {n}[/] · {title}", style="cyan"))


def short(s, n=14):
    s = str(s)
    return s if len(s) <= 2 * n + 1 else f"{s[:n]}…{s[-n:]}"


def panel(res, name, expected):
    ok = res["status"] == "VERIFIED"
    color, mark = ("green", "✓ VERIFIED") if ok else (("red", "✗ INVALID") if res["status"] == "INVALID" else ("yellow", "? NOT_FOUND"))
    body = f"[bold]{name}[/]\nkayıtlı : {short(res['original_hash'] or '—')}\nalınan  : {short(res['received_hash'])}"
    console.print(Panel(body, title=f"[bold {color}]{mark}[/]", border_style=color, expand=False))
    return res["status"] == expected


def main():
    ap = argparse.ArgumentParser(description="Notary v2 demo (zincir üstü, API'siz)")
    ap.add_argument("--mock", action="store_true", help="sahte RPC başlat")
    ap.add_argument("--rpc", default=None)
    ap.add_argument("--program", default=None)
    ap.add_argument("--funder", default=None, help="fon cüzdanı (Solana CLI JSON); airdrop yerine SOL aktarır")
    ap.add_argument("--delay", type=float, default=0.5)
    a = ap.parse_args()

    server = None
    program = a.program or onchain.PROGRAM_ID
    if a.mock:
        program = program or json.loads(VECTORS.read_text())["program_id"]
        url, _, server = mock_rpc.start(program)
    else:
        url = a.rpc or onchain.RPC_URL
    if not program:
        console.print("[red]--program ya da PROGRAM_ID gerekli[/]")
        return 2
    rpc = onchain.Rpc(url)
    box = SHARED_DIR / "v2"
    shutil.rmtree(box, ignore_errors=True)
    log = lambda m: console.print(f"  [dim]{escape(m)}[/]")  # noqa: E731

    console.print(Panel.fit("[bold]Notary v2[/] · zincir üstü kayıt, API'siz doğrulama", subtitle=f"{url} · {short(program, 6)}", border_style="blue"))
    try:
        step(1, "Agent kimlikleri = Solana anahtarları", a.delay)
        a_kp, b_kp = onchain.agent_keypair("agent_a"), onchain.agent_keypair("agent_b")
        for name, k in (("agent_a", a_kp), ("agent_b", b_kp)):
            if a.mock or rpc.balance(k.pubkey()) < 5_000_000:
                if a.funder:
                    onchain.fund_from(rpc, onchain.load_keypair(a.funder), k.pubkey(), 20_000_000)
                else:
                    rpc.airdrop(k.pubkey(), 1)
            console.print(f"  {name} → {k.pubkey()}")

        step(2, "agent_a: rapor üret, hash'i zincire kaydet", a.delay)
        pdf = write_pdf("Q3 delivery integrity report\nAll artifacts are anchored on-chain.", box / "report.pdf")
        h = onchain.sha256_bytes(pdf.read_bytes())
        out = onchain.notarize(rpc, a_kp, h, receiver=b_kp.pubkey(), program_id=program)
        proof = onchain.get_proof(rpc, out["proof_pda"])
        cert = onchain.build_certificate(out["proof_pda"], proof, out["tx_signature"], program)
        (box / "certificate.json").write_text(json.dumps(cert, indent=2))
        t = Table(show_header=False, box=None, padding=(0, 1))
        for k in ("proof_pda", "signer", "document_hash", "created_at", "tx_signature"):
            t.add_row(f"[cyan]{k}[/]", short(cert[k], 22))
        console.print(t)

        step(3, "agent_b: dosya + sertifika alındı, API'ye hiç dokunmadan doğrula", a.delay)
        ok1 = panel(onchain.verify(rpc, pdf.read_bytes(), pda=cert["proof_pda"], program_id=program), pdf.name, "VERIFIED")

        step(4, "Saldırı: PDF'e tek byte ekleniyor", a.delay)
        bad = box / "report_tampered.pdf"
        shutil.copyfile(pdf, bad)
        with open(bad, "ab") as f:
            f.write(b"\x00")
        ok2 = panel(onchain.verify(rpc, bad.read_bytes(), pda=cert["proof_pda"], program_id=program), bad.name, "INVALID")

        step(5, "Zincir provenance: Research → Analysis → Decision (parents zincirde)", a.delay)
        docs = {r: onchain.sha256_bytes(f"{r} document".encode()) for r in ("research", "analysis", "decision")}
        onchain.notarize(rpc, a_kp, docs["research"], program_id=program)
        onchain.notarize(rpc, b_kp, docs["analysis"], parents=[docs["research"]], program_id=program)
        dec = onchain.notarize(rpc, a_kp, docs["decision"], parents=[docs["analysis"]], program_id=program)
        tbl = Table(title="Bu karar hangi belgelere dayandı? (zincirden okundu)", title_style="bold")
        for c in ("belge hash", "imzalayan", "zaman"):
            tbl.add_column(c)
        nodes = onchain.lineage(rpc, dec["proof_pda"], program)
        for n in nodes:
            tbl.add_row(short(n["document_hash"]), short(n.get("signer", "—"), 8), n.get("created_at_iso", "—"))
        console.print(tbl)
        ok3 = len(nodes) == 2 and not any(n.get("missing") for n in nodes)
    finally:
        if server:
            server.shutdown()

    passed = ok1 and ok2 and ok3
    console.print(Rule(style="green" if passed else "red"))
    console.print("[bold green]Demo başarılı:[/] VERIFIED, 1 byte → INVALID, provenance zincirden okundu. Backend kullanılmadı."
                  if passed else "[bold red]Demo beklenmeyen sonuç verdi.[/]")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
