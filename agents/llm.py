# Anthropic function-calling yardımcıları: tool-use döngüsü ve düz metin üretimi.
import json
import os

MODEL = os.environ.get("NOTARY_MODEL", "claude-sonnet-5-5")


def get_client():
    """ANTHROPIC_API_KEY env'den okunur; anahtar kodda tutulmaz."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY tanımlı değil (LLM modu için gerekli; --no-llm ile çalıştırabilirsin).")
    import anthropic

    return anthropic.Anthropic()


def complete_text(client, system, user, max_tokens=1500):
    resp = client.messages.create(
        model=MODEL, max_tokens=max_tokens, system=system, messages=[{"role": "user", "content": user}]
    )
    return "".join(b.text for b in resp.content if b.type == "text").strip()


def run_tool_loop(client, system, user, tools, handlers, max_turns=6, max_tokens=1024):
    """Model tool çağırdıkça handler'ları çalıştırır.
    -> (son_metin, calls) ; calls = [{"name", "input", "output"}]"""
    messages = [{"role": "user", "content": user}]
    calls = []
    for _ in range(max_turns):
        resp = client.messages.create(
            model=MODEL, max_tokens=max_tokens, system=system, tools=tools, messages=messages
        )
        messages.append({"role": "assistant", "content": resp.content})
        if resp.stop_reason != "tool_use":
            text = "".join(b.text for b in resp.content if b.type == "text").strip()
            return text, calls
        results = []
        for block in resp.content:
            if block.type != "tool_use":
                continue
            try:
                output = handlers[block.name](**block.input)
                results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(output)})
            except Exception as exc:  # tool hatası modele döner, döngü kırılmaz
                output = {"error": str(exc)}
                results.append(
                    {"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(output), "is_error": True}
                )
            calls.append({"name": block.name, "input": dict(block.input), "output": output})
        messages.append({"role": "user", "content": results})
    raise RuntimeError("Tool döngüsü max_turns içinde bitmedi.")
