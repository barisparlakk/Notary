# Sender/Receiver agent'lar: mock sunucuya karşı, LLM'siz ve sahte LLM istemcisiyle.
import pytest

import llm
import receiver_agent
import sender_agent


def test_sender_receiver_no_llm(api_url, tmp_path):
    keys, box = tmp_path / "keys", tmp_path / "box"
    out = sender_agent.run("Test", outbox=box, api_url=api_url, keys_dir=keys, log=lambda *_: None)
    assert out["file"].read_bytes().startswith(b"%PDF")
    assert (box / "handoff.json").exists()
    res = receiver_agent.receive_from_inbox(box, api_url=api_url, log=lambda *_: None)
    assert res["status"] == "VERIFIED"
    assert res["original_hash"] == out["proof"]["document_hash"]


def test_receiver_detects_tampering(api_url, tmp_path):
    box = tmp_path / "box"
    out = sender_agent.run("Test", outbox=box, api_url=api_url, keys_dir=tmp_path / "keys", log=lambda *_: None)
    out["file"].write_bytes(out["file"].read_bytes() + b"\x00")
    res = receiver_agent.receive_from_inbox(box, api_url=api_url, log=lambda *_: None)
    assert res["status"] == "INVALID"


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


def test_sender_llm_mode(api_url, tmp_path, monkeypatch):
    monkeypatch.setattr(llm, "get_client", lambda: FakeAnthropic("notarize", {"file_name": "report.pdf"}))
    out = sender_agent.run("T", outbox=tmp_path / "box", use_llm=True, api_url=api_url,
                           keys_dir=tmp_path / "keys", log=lambda *_: None)
    assert out["proof"]["proof_id"].startswith("proof_")


def test_receiver_llm_mode(api_url, tmp_path, monkeypatch):
    box = tmp_path / "box"
    out = sender_agent.run("T", outbox=box, api_url=api_url, keys_dir=tmp_path / "keys", log=lambda *_: None)
    fake = FakeAnthropic("verify", {"file_name": "report.pdf", "proof_id": out["proof"]["proof_id"]})
    monkeypatch.setattr(llm, "get_client", lambda: fake)
    res = receiver_agent.receive_from_inbox(box, use_llm=True, api_url=api_url, log=lambda *_: None)
    assert res["status"] == "VERIFIED" and res["summary"] == "done"


def test_llm_tool_cannot_escape_outbox(api_url, tmp_path, monkeypatch):
    monkeypatch.setattr(llm, "get_client", lambda: FakeAnthropic("notarize", {"file_name": "../../etc/hosts"}))
    with pytest.raises(RuntimeError):  # tool hata döner -> başarılı çağrı yok
        sender_agent.run("T", outbox=tmp_path / "box", use_llm=True, api_url=api_url,
                         keys_dir=tmp_path / "keys", log=lambda *_: None)


def test_get_client_requires_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError):
        llm.get_client()


def test_demo_scenario_passes(monkeypatch, capsys):
    import demo

    monkeypatch.setattr("sys.argv", ["demo.py", "--mock", "--delay", "0"])
    assert demo.main() == 0
