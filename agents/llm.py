# LLM function-calling yardımcıları. İki sağlayıcı:
#   ollama / openai  -> OpenAI uyumlu /chat/completions (varsayılan: yerel Ollama, ücretsiz, anahtar gerekmez)
#   anthropic        -> Anthropic SDK (ANTHROPIC_API_KEY gerekir)
# Seçim: LLM_PROVIDER (varsayılan "ollama"), LLM_MODEL, LLM_BASE_URL, LLM_API_KEY (opsiyonel).
# Tool'lar Anthropic biçiminde ({name, description, input_schema}) verilir; OpenAI biçimine burada çevrilir.
import json
import os

import requests

PROVIDER = os.environ.get("LLM_PROVIDER", "ollama").lower()
DEFAULT_MODELS = {"ollama": "qwen2.5:3b", "openai": "gpt-4o-mini", "anthropic": "claude-sonnet-5-5"}
BASE_URL = os.environ.get("LLM_BASE_URL", "http://localhost:11434/v1").rstrip("/")


def model_name(provider=None):
    return os.environ.get("LLM_MODEL") or os.environ.get("NOTARY_MODEL") or DEFAULT_MODELS[provider or PROVIDER]


class OpenAICompatClient:
    """OpenAI uyumlu sohbet API'si (Ollama, Groq, OpenRouter, Gemini-compat ...)."""

    def __init__(self, base_url, model, api_key=None, timeout=300):
        self.base_url, self.model, self.api_key, self.timeout = base_url.rstrip("/"), model, api_key, timeout

    def chat(self, messages, tools=None, max_tokens=1024):
        body = {"model": self.model, "messages": messages, "max_tokens": max_tokens, "temperature": 0.2}
        if tools:
            body["tools"] = [
                {"type": "function", "function": {"name": t["name"], "description": t.get("description", ""),
                                                   "parameters": t["input_schema"]}}
                for t in tools
            ]
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        resp = requests.post(f"{self.base_url}/chat/completions", json=body, headers=headers, timeout=self.timeout)
        if not resp.ok:
            raise RuntimeError(f"LLM isteği başarısız (HTTP {resp.status_code}): {resp.text[:300]}")
        return resp.json()["choices"][0]["message"]


def get_client():
    """Seçili sağlayıcının istemcisi. Eksik kurulum/anahtar için açıklayıcı hata verir."""
    if PROVIDER == "anthropic":
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError("ANTHROPIC_API_KEY tanımlı değil (LLM_PROVIDER=anthropic için gerekli).")
        import anthropic

        return anthropic.Anthropic()
    client = OpenAICompatClient(BASE_URL, model_name(), os.environ.get("LLM_API_KEY"))
    if PROVIDER == "ollama":
        try:
            requests.get(f"{BASE_URL.removesuffix('/v1')}/api/tags", timeout=3).raise_for_status()
        except requests.RequestException as exc:
            raise RuntimeError(
                f"Ollama'ya ulaşılamadı ({BASE_URL}). Kur ve başlat: `ollama serve`, "
                f"modeli indir: `ollama pull {model_name()}`. Ya da --no-llm kullan."
            ) from exc
    return client


def complete_text(client, system, user, max_tokens=1500):
    if isinstance(client, OpenAICompatClient):
        msg = client.chat([{"role": "system", "content": system}, {"role": "user", "content": user}],
                          max_tokens=max_tokens)
        return (msg.get("content") or "").strip()
    resp = client.messages.create(
        model=model_name("anthropic"), max_tokens=max_tokens, system=system,
        messages=[{"role": "user", "content": user}],
    )
    return "".join(b.text for b in resp.content if b.type == "text").strip()


def run_tool_loop(client, system, user, tools, handlers, max_turns=6, max_tokens=1024):
    """Model tool çağırdıkça handler'ları çalıştırır.
    -> (son_metin, calls) ; calls = [{"name", "input", "output"}]"""
    if isinstance(client, OpenAICompatClient):
        return _loop_openai(client, system, user, tools, handlers, max_turns, max_tokens)
    return _loop_anthropic(client, system, user, tools, handlers, max_turns, max_tokens)


def _call_handler(handlers, name, args):
    try:
        return handlers[name](**args), False
    except Exception as exc:  # tool hatası modele döner, döngü kırılmaz
        return {"error": str(exc)}, True


def _loop_openai(client, system, user, tools, handlers, max_turns, max_tokens):
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    calls = []
    for _ in range(max_turns):
        msg = client.chat(messages, tools=tools, max_tokens=max_tokens)
        tool_calls = msg.get("tool_calls") or []
        messages.append({"role": "assistant", "content": msg.get("content") or "", **({"tool_calls": tool_calls} if tool_calls else {})})
        if not tool_calls:
            return (msg.get("content") or "").strip(), calls
        for tc in tool_calls:
            fn = tc["function"]
            raw = fn.get("arguments") or "{}"
            try:
                args = json.loads(raw) if isinstance(raw, str) else dict(raw)
                output, _ = _call_handler(handlers, fn["name"], args)
            except (ValueError, TypeError) as exc:
                args, output = {}, {"error": f"geçersiz tool argümanları: {exc}"}
            calls.append({"name": fn["name"], "input": args, "output": output})
            messages.append({"role": "tool", "tool_call_id": tc.get("id", fn["name"]), "content": json.dumps(output)})
    raise RuntimeError("Tool döngüsü max_turns içinde bitmedi.")


def _loop_anthropic(client, system, user, tools, handlers, max_turns, max_tokens):
    messages = [{"role": "user", "content": user}]
    calls = []
    for _ in range(max_turns):
        resp = client.messages.create(
            model=model_name("anthropic"), max_tokens=max_tokens, system=system, tools=tools, messages=messages
        )
        messages.append({"role": "assistant", "content": resp.content})
        if resp.stop_reason != "tool_use":
            return "".join(b.text for b in resp.content if b.type == "text").strip(), calls
        results = []
        for block in resp.content:
            if block.type != "tool_use":
                continue
            output, is_error = _call_handler(handlers, block.name, dict(block.input))
            result = {"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(output)}
            if is_error:
                result["is_error"] = True
            results.append(result)
            calls.append({"name": block.name, "input": dict(block.input), "output": output})
        messages.append({"role": "user", "content": results})
    raise RuntimeError("Tool döngüsü max_turns içinde bitmedi.")
