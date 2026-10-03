# Uçtan uca demo: A -> notarize -> B -> verify -> VERIFIED; sonra PDF'e 1 byte ekle -> INVALID.
# Kullanım: python demo.py --mock        (yerel mock sunucuyla)
#           python demo.py               (API_URL'deki gerçek backend ile)
#           python demo.py --llm         (LLM function calling ile; ANTHROPIC_API_KEY gerekir)
import argparse
import shutil
import socket
import sys
import threading
import time
from pathlib import Path

from rich.console import Console
from rich.markup import escape
from rich.panel import Panel
from rich.rule import Rule
from rich.table import Table

import chain
import client
import receiver_agent
import sender_agent

console = Console()


def start_mock_server():
    import uvicorn

    import mock_server

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(mock_server.app, port=port, log_level="error"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.02)
    return f"http://127.0.0.1:{port}", server


def step(n, title, delay):
    time.sleep(delay)
    console.print(Rule(f"[bold cyan]Adım {n}[/] · {title}", style="cyan"))


def short(s, n=18):
    return s if len(s) <= n * 2 + 1 else f"{s[:n]}…{s[-n:]}"


def result_panel(res, filename, expected):
    ok = res["status"] == "VERIFIED"
    color, mark = ("green", "✓ VERIFIED") if ok else ("red", "✗ INVALID")
    body = (
        f"[bold]{filename}[/]\n"
        f"original : {short(res['original_hash'] or '—')}\n"
        f"received : {short(res['received_hash'])}"
    )
    if res.get("summary"):
        body += f"\n\n[italic]{res['summary']}[/]"
    console.print(Panel(body, title=f"[bold {color}]{mark}[/]", border_style=color, expand=False))
    return res["status"] == expected


def lineage_table(rows):
    t = Table(title="Bu karar hangi dosyalara dayandı?", title_style="bold")
    for col in ("rol", "gönderen → alıcı", "proof_id", "dosya bütünlüğü"):
        t.add_column(col)
    for r in rows:
        color = "green" if r["status"] == "VERIFIED" else "red"
        t.add_row(r["role"], f"{r['sender']} → {r['receiver']}", short(r["proof_id"], 14),
                  f"[{color}]{r['status']}[/]")
    console.print(t)


def run_chain_section(a, api_url, log):
    ledger = chain.Ledger(chain.LEDGER_PATH)
    ledger.data = {"artifacts": {}}  # demo her çalıştırmada temiz ledger ile başlar
    if chain.CHAIN_DIR.exists():
        shutil.rmtree(chain.CHAIN_DIR)

    step(7, "Zincir: Research → Analysis → Decision", a.delay)
    out = chain.run_chain("Should we adopt notarized agent handoffs?", ledger=ledger, use_llm=a.llm,
                          api_url=api_url, log=log)
    step(8, "Provenance sorgusu", a.delay)
    rows = chain.explain(out["decision"], ledger, api_url=api_url)
    lineage_table(rows)
    ok_a = all(r["status"] == "VERIFIED" for r in rows)

    step(9, "Kaynak dosyalardan biri sonradan değiştirilirse", a.delay)
    research = Path(ledger.get(rows[0]["proof_id"])["file"])
    with open(research, "ab") as f:
        f.write(b"\x00")
    rows2 = chain.explain(out["decision"], ledger, api_url=api_url)
    lineage_table(rows2)
    ok_b = [r["status"] for r in rows2] == ["INVALID", "VERIFIED"]
    return ok_a and ok_b


def main():
    ap = argparse.ArgumentParser(description="Notary uçtan uca demo: VERIFIED ve INVALID senaryosu")
    ap.add_argument("--mock", action="store_true", help="yerel mock sunucu başlat")
    ap.add_argument("--api-url", default=None, help="varsayılan: API_URL env / http://localhost:8000")
    ap.add_argument("--llm", action="store_true", help="agent'lar Anthropic function calling kullansın")
    ap.add_argument("--topic", default="Q3 delivery integrity report")
    ap.add_argument("--chain", action="store_true", help="Research -> Analysis -> Decision zinciri ve provenance sorgusu ekle")
    ap.add_argument("--delay", type=float, default=0.5, help="adımlar arası bekleme (sn)")
    a = ap.parse_args()

    server = None
    api_url = a.api_url
    if a.mock:
        api_url, server = start_mock_server()
    api_url = api_url or client.API_URL

    console.print(Panel.fit("[bold]Notary[/] · AI agent'lar arası dosya güveni", subtitle=api_url, border_style="blue"))
    box = sender_agent.SHARED_DIR
    if box.exists():
        shutil.rmtree(box)
    log = lambda msg: console.print(f"  [dim]{escape(msg)}[/]")  # noqa: E731

    try:
        step(1, "Backend kontrolü", a.delay)
        console.print(f"  health → {client.health(api_url)}")

        step(2, "agent_a: rapor üret ve notarize et", a.delay)
        out = sender_agent.run(a.topic, outbox=box, use_llm=a.llm, api_url=api_url, log=log)
        client.ensure_agent(receiver_agent.RECEIVER_ID, api_url=api_url)
        proof = out["proof"]
        t = Table(show_header=False, box=None, padding=(0, 1))
        for k in ("proof_id", "document_hash", "timestamp", "tx_signature", "explorer_url"):
            t.add_row(f"[cyan]{k}[/]", short(proof[k], 28) if k != "explorer_url" else proof[k])
        console.print(t)

        step(3, "agent_a → agent_b: dosya + proof_id iletildi", a.delay)
        console.print(f"  {out['file'].name}  +  {proof['proof_id']}")

        step(4, "agent_b: orijinal dosyayı doğrula", a.delay)
        res = receiver_agent.receive_from_inbox(box, use_llm=a.llm, api_url=api_url, log=log)
        ok1 = result_panel(res, out["file"].name, "VERIFIED")

        step(5, "Saldırı: PDF'e tek byte ekleniyor", a.delay)
        tampered = box / "report_tampered.pdf"
        shutil.copyfile(out["file"], tampered)
        with open(tampered, "ab") as f:
            f.write(b"\x00")
        console.print(f"  {out['file'].stat().st_size} → {tampered.stat().st_size} byte")

        step(6, "agent_b: değiştirilmiş dosyayı doğrula", a.delay)
        res2 = receiver_agent.receive(tampered, proof["proof_id"], use_llm=a.llm, api_url=api_url, log=log)
        ok2 = result_panel(res2, tampered.name, "INVALID")
        ok3 = run_chain_section(a, api_url, log) if a.chain else True
    finally:
        if server:
            server.should_exit = True

    passed = ok1 and ok2 and ok3
    console.print(Rule(style="green" if passed else "red"))
    console.print(
        "[bold green]Demo başarılı:[/] orijinal VERIFIED, 1 byte değişiklik INVALID." if passed
        else "[bold red]Demo beklenmeyen sonuç verdi.[/]"
    )
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
