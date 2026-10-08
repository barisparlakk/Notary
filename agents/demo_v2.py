# v2 demo: API YOK. Agent'lar Solana PDA'sına kayıt atar, doğrulama yalnızca RPC'den okunur.
#   python demo_v2.py --mock                       (sahte RPC; program kurulumu gerekmez)
#   python demo_v2.py --rpc <url> --program <id> [--funder fonlu.json] [--llm] [--chain]
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

import chain
import mock_rpc
import onchain
import receiver_agent
import sender_agent

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
    if res.get("summary"):
        body += f"\n\n[italic]{escape(res['summary'])}[/]"
    console.print(Panel(body, title=f"[bold {color}]{mark}[/]", border_style=color, expand=False))
    return res["status"] == expected


def lineage_table(rows):
    t = Table(title="Bu karar hangi belgelere dayandı? (zincirden okundu)", title_style="bold")
    for c in ("rol", "belge hash", "imzalayan", "zaman", "dosya bütünlüğü"):
        t.add_column(c)
    for r in rows:
        color = "green" if r["status"] == "VERIFIED" else "red"
        t.add_row(r["role"], short(r["document_hash"]), short(r.get("signer", "—"), 8), r.get("created_at_iso", "—"),
                  f"[{color}]{r['status']}[/]")
    console.print(t)


def main():
    ap = argparse.ArgumentParser(description="Notary v2 demo (zincir üstü, API'siz)")
    ap.add_argument("--mock", action="store_true", help="sahte RPC başlat")
    ap.add_argument("--rpc", default=None)
    ap.add_argument("--program", default=None)
    ap.add_argument("--funder", default=None, help="fon cüzdanı (Solana CLI JSON); airdrop yerine SOL aktarır")
    ap.add_argument("--llm", action="store_true", help="agent'lar LLM function calling kullansın (bkz. llm.py)")
    ap.add_argument("--chain", action="store_true", help="Research -> Analysis -> Decision zincirini de çalıştır")
    ap.add_argument("--agreement", action="store_true", help="iki agent'ın birlikte imzaladığı sözleşme akışını da çalıştır")
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
    funder = onchain.load_keypair(a.funder) if a.funder else None
    box = sender_agent.SHARED_DIR / "v2"
    shutil.rmtree(box, ignore_errors=True)
    log = lambda m: console.print(f"  [dim]{escape(m)}[/]")  # noqa: E731
    common = {"rpc": rpc, "program_id": program, "funder": funder, "log": log}

    console.print(Panel.fit("[bold]Notary v2[/] · zincir üstü kayıt, API'siz doğrulama", subtitle=f"{url} · {short(program, 6)}", border_style="blue"))
    ok3 = ok4 = True
    try:
        step(1, "agent_a: rapor üret ve zincire kaydet", a.delay)
        receiver_pk = onchain.agent_keypair(receiver_agent.RECEIVER_ID).pubkey()
        out = sender_agent.run("Q3 delivery integrity report", receiver=receiver_pk, outbox=box, use_llm=a.llm, **common)
        cert = out["certificate"]
        t = Table(show_header=False, box=None, padding=(0, 1))
        for k in ("proof_pda", "signer", "document_hash", "created_at", "tx_signature"):
            t.add_row(f"[cyan]{k}[/]", short(cert[k], 22))
        console.print(t)

        step(2, "agent_b: dosya + sertifika alındı, API'ye hiç dokunmadan doğrula", a.delay)
        ok1 = panel(receiver_agent.receive_from_inbox(box, use_llm=a.llm, rpc=rpc, program_id=program, log=log),
                    out["file"].name, "VERIFIED")

        step(3, "Saldırı: PDF'e tek byte ekleniyor", a.delay)
        bad = box / "report_tampered.pdf"
        shutil.copyfile(out["file"], bad)
        with open(bad, "ab") as f:
            f.write(b"\x00")
        ok2 = panel(receiver_agent.receive(bad, cert["proof_pda"], use_llm=a.llm, rpc=rpc, program_id=program, log=log),
                    bad.name, "INVALID")

        if a.chain:
            step(4, "Zincir provenance: Research → Analysis → Decision (parents zincirde)", a.delay)
            cdir = box / "chain"
            res = chain.run_chain("Should we adopt notarized agent handoffs?", workdir=cdir, use_llm=a.llm, **common)
            rows = chain.explain(rpc, res["decision"], cdir, program)
            lineage_table(rows)
            step(5, "Kaynak belgelerden biri sonradan değiştirilirse", a.delay)
            research = cdir / res["manifest"][0]["file"]
            research.write_bytes(research.read_bytes() + b"\x00")
            rows2 = chain.explain(rpc, res["decision"], cdir, program)
            lineage_table(rows2)
            ok3 = [r["status"] for r in rows] == ["VERIFIED", "VERIFIED"] and [r["status"] for r in rows2] == ["INVALID", "VERIFIED"]
        if a.agreement:
            step(6, "Çok imzalı sözleşme: agent_a açar, agent_b imzalar", a.delay)
            a_kp, b_kp = onchain.agent_keypair(sender_agent.SENDER_ID), onchain.agent_keypair(receiver_agent.RECEIVER_ID)
            for kp in (a_kp, b_kp):
                onchain.ensure_funded(rpc, kp, funder)
            contract = (box / "contract.txt")
            contract.write_text(f"Supply agreement between agent_a and agent_b\nRun: {time.strftime('%Y%m%dT%H%M%S')}\n")
            h = onchain.sha256_bytes(contract.read_bytes())
            ag = onchain.create_agreement(rpc, a_kp, h, [a_kp.pubkey(), b_kp.pubkey()], program_id=program)
            log(f"agent_a sözleşmeyi açtı: {ag['agreement_pda']}")
            pending = onchain.verify(rpc, contract.read_bytes(), pda=ag["agreement_pda"], program_id=program)
            console.print(f"  agent_b doğrulaması: [blue]{pending['status']}[/] ({pending['agreement']['signed_count']}/2 imza)")
            onchain.co_sign(rpc, b_kp, ag["agreement_pda"], program_id=program)
            done = onchain.verify(rpc, contract.read_bytes(), pda=ag["agreement_pda"], program_id=program)
            ok4 = panel(done, "contract.txt", "VERIFIED") and pending["status"] == "PENDING"
    finally:
        if server:
            server.shutdown()

    passed = ok1 and ok2 and ok3 and ok4
    console.print(Rule(style="green" if passed else "red"))
    console.print("[bold green]Demo başarılı:[/] VERIFIED, 1 byte → INVALID" + (", provenance zincirden okundu" if a.chain else "") + (", sözleşme PENDING → VERIFIED" if a.agreement else "")
                  + ". Backend kullanılmadı." if passed else "[bold red]Demo beklenmeyen sonuç verdi.[/]")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
