# Ortak test ayarları: import yolu ve her test için temiz bir sahte Solana zinciri.
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import mock_rpc  # noqa: E402
import onchain  # noqa: E402

TEST_PROGRAM = json.loads((Path(__file__).resolve().parents[2] / "docs" / "test_vectors_v2.json").read_text())["program_id"]


@pytest.fixture
def chain_rpc():
    """Her test için temiz bir sahte Solana zinciri (notary programının davranışını taklit eder)."""
    url, state, server = mock_rpc.start(TEST_PROGRAM)
    yield onchain.Rpc(url), TEST_PROGRAM
    server.shutdown()
