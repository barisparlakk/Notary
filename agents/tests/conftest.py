# Ortak test ayarları: import yolu ve gerçek bir mock_server (uvicorn, rastgele port).
import json
import socket
import sys
import threading
import time
from pathlib import Path

import pytest
import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import mock_rpc  # noqa: E402
import mock_server  # noqa: E402
import onchain  # noqa: E402

TEST_PROGRAM = json.loads((Path(__file__).resolve().parents[2] / "docs" / "test_vectors_v2.json").read_text())["program_id"]


@pytest.fixture(scope="session")
def api_url():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(mock_server.app, port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.02)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture
def chain_rpc():
    """Her test için temiz bir sahte Solana zinciri (notary programının davranışını taklit eder)."""
    url, state, server = mock_rpc.start(TEST_PROGRAM)
    yield onchain.Rpc(url), TEST_PROGRAM
    server.shutdown()
