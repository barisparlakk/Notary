export const INITIAL_TEST_VECTOR = {
  public_key: "iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=",
  document_hash: "aab38ec286c0fdcf2364733ff773128dcd7af5b56e787911e16f2c846d67f6ea",
  sender: "agent_a",
  receiver: "agent_b",
  timestamp: "2026-10-03T18:30:00Z",
  message: "notary:v1|aab38ec286c0fdcf2364733ff773128dcd7af5b56e787911e16f2c846d67f6ea|agent_a|agent_b|2026-10-03T18:30:00Z",
  signature: "IeVXHQdEWOUbr8aiLUPjpa2VcDoIBtGPEu60U2892J2QtCf0jyGj6KYuKwsPNf+GujaZzU4DVwKMp0dv8O3UDw==",
  tx_signature: "5K3mZpXQyV8Wn2UjL9RbE6Yg7N4c1DhM3sP9wQ8xY2vT1kL5nR7eA4mD8qZ6wE3jF1hV9pL7kM4nB2vC5xY8zT",
  explorer_url: "https://explorer.solana.com/tx/5K3mZpXQyV8Wn2UjL9RbE6Yg7N4c1DhM3sP9wQ8xY2vT1kL5nR7eA4mD8qZ6wE3jF1hV9pL7kM4nB2vC5xY8zT?cluster=devnet"
};

export const INITIAL_AGENTS = [
  {
    agent_id: "agent_a",
    public_key: "iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=",
    role: "Research & Synthesis Agent",
    registered_at: "2026-10-03T17:00:00Z"
  },
  {
    agent_id: "agent_b",
    public_key: "7vK82W7pXmP9QzL2YvT1kL5nR7eA4mD8qZ6wE3jF1hV=",
    role: "Execution & Risk Audit Agent",
    registered_at: "2026-10-03T17:15:00Z"
  }
];

export const INITIAL_PROOFS = [
  {
    proof_id: "proof-8821a9c1",
    document_hash: "aab38ec286c0fdcf2364733ff773128dcd7af5b56e787911e16f2c846d67f6ea",
    sender: "agent_a",
    receiver: "agent_b",
    timestamp: "2026-10-03T18:30:00Z",
    signature: "IeVXHQdEWOUbr8aiLUPjpa2VcDoIBtGPEu60U2892J2QtCf0jyGj6KYuKwsPNf+GujaZzU4DVwKMp0dv8O3UDw==",
    tx_signature: "5K3mZpXQyV8Wn2UjL9RbE6Yg7N4c1DhM3sP9wQ8xY2vT1kL5nR7eA4mD8qZ6wE3jF1hV9pL7kM4nB2vC5xY8zT",
    explorer_url: "https://explorer.solana.com/tx/5K3mZpXQyV8Wn2UjL9RbE6Yg7N4c1DhM3sP9wQ8xY2vT1kL5nR7eA4mD8qZ6wE3jF1hV9pL7kM4nB2vC5xY8zT?cluster=devnet",
    file_name: "financial_risk_report_q3.pdf",
    file_size: 42891,
    status: "CONFIRMED"
  }
];

export function generateRandomTxSignature() {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < 88; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function generateProofId() {
  return 'proof-' + Math.random().toString(16).substring(2, 10);
}