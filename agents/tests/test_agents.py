# Sender/Receiver agent'lar (v2): sahte zincire karşı, LLM'siz ve sahte LLM istemcisiyle. API yok.
import json

import pytest

import demo_v2
import llm
import onchain
import receiver_agent
import sender_agent

quiet = {"log": lambda *_: None}


def test_sender_receiver_no_llm(chain_rpc, tmp_path):
    rpc, program = chain_rpc
    out = sender_agent.run("Test", outbox=tmp_path / "box", rpc=rpc, program_id=program, keys_dir=tmp_path / "k", **quiet)
    assert out["file"].read_bytes().startswith(b"%PDF")
    assert (tmp_path / "box" / "handoff.json").exists() and (tmp_path / "box" / "certificate.json").exists()
    assert out["certificate"]["version"] == "notary.cert.v1"
    res = receiver_agent.receive_from_inbox(tmp_path / "box", rpc=rpc, program_id=program, **quiet)
    assert res["status"] == "VERIFIED"
    assert res["original_hash"] == out["proof"]["document_hash"]


def test_receiver_detects_tampering(chain_rpc, tmp_path):
    rpc, program = chain_rpc
    box = tmp_path / "box"
    out = sender_agent.run("Test", outbox=box, rpc=rpc, program_id=program, keys_dir=tmp_path / "k", **quiet)
    out["file"].write_bytes(out["file"].read_bytes() + b"\x00")
    assert receiver_agent.receive_from_inbox(box, rpc=rpc, program_id=program, **quiet)["status"] == "INVALID"


def test_sender_funds_itself_from_funder(chain_rpc, tmp_path):
    rpc, program = chain_rpc
    funder = onchain.Keypair()
    rpc.airdrop(funder.pubkey(), 1)
    out = sender_agent.run("T", outbox=tmp_path / "box", rpc=rpc, program_id=program, keys_dir=tmp_path / "k",
                           funder=funder, **quiet)
    assert rpc.balance(onchain.Pubkey.from_string(out["proof"]["signer"])) >= 20_000_000


# --- sahte Anthropic istemcisi: önce tool çağırır, sonra metinle bitirir ---
class _Block:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class _Resp:
    def __init__(self, content, stop_reason):
        self.content, self.stop_reason = content, stop_reason


class FakeAnthropic:
    def __init__(self, tool_name, tool_input):
        self.tool_name, self.tool_input, self.turn = tool_name, tool_input, 0
        self.messages = self

    def create(self, **kw):
        if "tools" not in kw:  # düz metin üretimi
            return _Resp([_Block(type="text", text="Generated report body")], "end_turn")
        self.turn += 1
        if self.turn == 1:
            blk = _Block(type="tool_use", id="t1", name=self.tool_name, input=self.tool_input)
            return _Resp([blk], "tool_use")
        return _Resp([_Block(type="text", text="done")], "end_turn")


def test_sender_llm_mode(chain_rpc, tmp_path, monkeypatch):
    rpc, program = chain_rpc
    monkeypatch.setattr(llm, "get_client", lambda: FakeAnthropic("notarize", {"file_name": "report.pdf"}))
    out = sender_agent.run("T", outbox=tmp_path / "box", use_llm=True, rpc=rpc, program_id=program,
                           keys_dir=tmp_path / "k", **quiet)
    assert onchain.get_proof(rpc, out["proof"]["proof_pda"])["signer"] == out["proof"]["signer"]


def test_receiver_llm_mode(chain_rpc, tmp_path, monkeypatch):
    rpc, program = chain_rpc
    box = tmp_path / "box"
    out = sender_agent.run("T", outbox=box, rpc=rpc, program_id=program, keys_dir=tmp_path / "k", **quiet)
    fake = FakeAnthropic("verify", {"file_name": "report.pdf", "proof_pda": out["proof"]["proof_pda"]})
    monkeypatch.setattr(llm, "get_client", lambda: fake)
    res = receiver_agent.receive_from_inbox(box, use_llm=True, rpc=rpc, program_id=program, **quiet)
    assert res["status"] == "VERIFIED" and res["summary"] == "done"


def test_llm_tool_cannot_escape_outbox(chain_rpc, tmp_path, monkeypatch):
    rpc, program = chain_rpc
    monkeypatch.setattr(llm, "get_client", lambda: FakeAnthropic("notarize", {"file_name": "../../etc/hosts"}))
    with pytest.raises(RuntimeError):  # tool hata döner -> başarılı çağrı yok
        sender_agent.run("T", outbox=tmp_path / "box", use_llm=True, rpc=rpc, program_id=program,
                         keys_dir=tmp_path / "k", **quiet)


def test_anthropic_provider_requires_key(monkeypatch):
    monkeypatch.setattr(llm, "PROVIDER", "anthropic")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError):
        llm.get_client()


def test_ollama_provider_gives_helpful_error_when_down(monkeypatch):
    monkeypatch.setattr(llm, "PROVIDER", "ollama")
    monkeypatch.setattr(llm, "BASE_URL", "http://127.0.0.1:9/v1")  # kapalı port
    with pytest.raises(RuntimeError, match="ollama serve"):
        llm.get_client()


# --- OpenAI uyumlu sahte HTTP sunucusu (Ollama/Groq biçimi) ---
@pytest.fixture
def openai_server():
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    state = {"tool": None, "args": None, "turn": 0, "bodies": []}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            state["bodies"].append(body)
            if "tools" not in body:
                msg = {"role": "assistant", "content": "Generated report body"}
            else:
                state["turn"] += 1
                if state["turn"] == 1:
                    msg = {"role": "assistant", "content": "", "tool_calls": [{
                        "id": "c1", "type": "function",
                        "function": {"name": state["tool"], "arguments": json.dumps(state["args"])}}]}
                else:
                    msg = {"role": "assistant", "content": "done"}
            data = json.dumps({"choices": [{"message": msg}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(data)

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    state["url"] = f"http://127.0.0.1:{srv.server_port}/v1"
    yield state
    srv.shutdown()


def _use_openai(monkeypatch, state):
    monkeypatch.setattr(llm, "PROVIDER", "openai")
    monkeypatch.setattr(llm, "BASE_URL", state["url"])


def test_openai_compat_sender_and_receiver(chain_rpc, tmp_path, monkeypatch, openai_server):
    rpc, program = chain_rpc
    _use_openai(monkeypatch, openai_server)
    openai_server.update(tool="notarize", args={"file_name": "report.pdf"})
    box = tmp_path / "box"
    out = sender_agent.run("T", outbox=box, use_llm=True, rpc=rpc, program_id=program, keys_dir=tmp_path / "k", **quiet)
    assert out["proof"]["proof_pda"]
    assert openai_server["bodies"][1]["tools"][0]["function"]["name"] == "notarize"  # OpenAI biçimine çevrilmiş

    openai_server.update(tool="verify", turn=0, args={"file_name": "report.pdf", "proof_pda": out["proof"]["proof_pda"]})
    res = receiver_agent.receive_from_inbox(box, use_llm=True, rpc=rpc, program_id=program, **quiet)
    assert res["status"] == "VERIFIED" and res["summary"] == "done"


def test_openai_compat_bad_tool_arguments_do_not_crash(chain_rpc, tmp_path, monkeypatch, openai_server):
    rpc, program = chain_rpc
    _use_openai(monkeypatch, openai_server)
    openai_server.update(tool="notarize", args="not-json-object")
    with pytest.raises(RuntimeError):
        sender_agent.run("T", outbox=tmp_path / "box", use_llm=True, rpc=rpc, program_id=program,
                         keys_dir=tmp_path / "k", **quiet)


def test_demo_v2_with_chain_passes(monkeypatch):
    monkeypatch.setattr("sys.argv", ["demo_v2.py", "--mock", "--delay", "0", "--chain"])
    assert demo_v2.main() == 0


def test_demo_v2_with_agreement_passes(monkeypatch):
    monkeypatch.setattr("sys.argv", ["demo_v2.py", "--mock", "--delay", "0", "--agreement"])
    assert demo_v2.main() == 0
