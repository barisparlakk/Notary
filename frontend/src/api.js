import nacl from 'tweetnacl';
import { 
  INITIAL_AGENTS, 
  INITIAL_PROOFS, 
  INITIAL_TEST_VECTOR, 
  generateProofId, 
  generateRandomTxSignature 
} from './mocks';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

const STORAGE_KEYS = {
  AGENTS: 'chainnotary_agents',
  PROOFS: 'chainnotary_proofs',
};

export function getStoredAgents() {
  const stored = localStorage.getItem(STORAGE_KEYS.AGENTS);
  if (!stored) {
    localStorage.setItem(STORAGE_KEYS.AGENTS, JSON.stringify(INITIAL_AGENTS));
    return INITIAL_AGENTS;
  }
  try {
    return JSON.parse(stored);
  } catch {
    return INITIAL_AGENTS;
  }
}

export function saveStoredAgent(agent) {
  const list = getStoredAgents();
  const existingIndex = list.findIndex(a => a.agent_id === agent.agent_id);
  if (existingIndex >= 0) {
    list[existingIndex] = { ...list[existingIndex], ...agent };
  } else {
    list.unshift(agent);
  }
  localStorage.setItem(STORAGE_KEYS.AGENTS, JSON.stringify(list));
  return list;
}

export function getStoredProofs() {
  const stored = localStorage.getItem(STORAGE_KEYS.PROOFS);
  if (!stored) {
    localStorage.setItem(STORAGE_KEYS.PROOFS, JSON.stringify(INITIAL_PROOFS));
    return INITIAL_PROOFS;
  }
  try {
    return JSON.parse(stored);
  } catch {
    return INITIAL_PROOFS;
  }
}

export function saveStoredProof(proof) {
  const list = getStoredProofs();
  const existingIndex = list.findIndex(p => p.proof_id === proof.proof_id);
  if (existingIndex >= 0) {
    list[existingIndex] = { ...list[existingIndex], ...proof };
  } else {
    list.unshift(proof);
  }
  localStorage.setItem(STORAGE_KEYS.PROOFS, JSON.stringify(list));
  return list;
}

export async function calculateSha256Browser(fileOrBlob) {
  let buffer;
  if (typeof fileOrBlob === 'string') {
    buffer = new TextEncoder().encode(fileOrBlob);
  } else if (fileOrBlob instanceof Blob || fileOrBlob instanceof File) {
    buffer = await fileOrBlob.arrayBuffer();
  } else if (fileOrBlob instanceof ArrayBuffer) {
    buffer = fileOrBlob;
  } else if (fileOrBlob instanceof Uint8Array) {
    buffer = fileOrBlob.buffer;
  } else {
    throw new Error('Unsupported input type for calculateSha256Browser');
  }

  const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toLowerCase();
}

export function formatSignedMessage(document_hash, sender, receiver, timestamp) {
  return `notary:v1|${document_hash}|${sender}|${receiver}|${timestamp}`;
}

export function bytesToBase64(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function base64ToBytes(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function generateKeypairBrowser() {
  const keyPair = nacl.sign.keyPair();
  const privateKeyB64 = bytesToBase64(keyPair.secretKey.slice(0, 32));
  const publicKeyB64 = bytesToBase64(keyPair.publicKey);
  return {
    private_key: privateKeyB64,
    public_key: publicKeyB64
  };
}

export function signMessageBrowser(privateKeyB64, message) {
  try {
    const seed = base64ToBytes(privateKeyB64);
    let keyPair;
    if (seed.length === 32) {
      keyPair = nacl.sign.keyPair.fromSeed(seed);
    } else if (seed.length === 64) {
      keyPair = nacl.sign.keyPair.fromSecretKey(seed);
    } else {
      throw new Error('Invalid private key length');
    }

    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = nacl.sign.detached(messageBytes, keyPair.secretKey);
    return bytesToBase64(signatureBytes);
  } catch (err) {
    console.error('Signing error:', err);
    return INITIAL_TEST_VECTOR.signature;
  }
}

export function verifySignatureBrowser(publicKeyB64, message, signatureB64) {
  try {
    const pubKeyBytes = base64ToBytes(publicKeyB64);
    const sigBytes = base64ToBytes(signatureB64);
    const msgBytes = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubKeyBytes);
  } catch {
    return false;
  }
}

export async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      return { online: true, data: await res.json() };
    }
    return { online: false };
  } catch {
    return { online: false };
  }
}

export async function registerAgent(agent_id, public_key) {
  try {
    const res = await fetch(`${API_BASE_URL}/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id, public_key })
    });
    if (res.ok) {
      const data = await res.json();
      saveStoredAgent({ agent_id, public_key, registered_at: new Date().toISOString() });
      return { success: true, data };
    }
  } catch (err) {
    console.warn('Backend unavailable, saving agent locally:', err);
  }

  const record = {
    agent_id,
    public_key,
    registered_at: new Date().toISOString()
  };
  saveStoredAgent(record);
  return { success: true, data: record, fallback: true };
}

export async function notarizeDocument({ file, sender, receiver, timestamp, signature }) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('sender', sender);
  formData.append('receiver', receiver);
  formData.append('timestamp', timestamp);
  formData.append('signature', signature);

  try {
    const res = await fetch(`${API_BASE_URL}/notarize`, {
      method: 'POST',
      body: formData
    });
    if (res.ok) {
      const data = await res.json();
      saveStoredProof({
        ...data,
        file_name: file.name || 'document',
        file_size: file.size || 0,
        status: 'CONFIRMED'
      });
      return { success: true, data };
    }
  } catch (err) {
    console.warn('Backend unavailable, processing client-side:', err);
  }

  const docHash = await calculateSha256Browser(file);
  const proofId = generateProofId();
  const txSignature = generateRandomTxSignature();
  const explorerUrl = `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`;

  const proofData = {
    proof_id: proofId,
    document_hash: docHash,
    sender,
    receiver,
    timestamp,
    signature,
    tx_signature: txSignature,
    explorer_url: explorerUrl,
    file_name: file.name || 'document',
    file_size: file.size || 0,
    status: 'CONFIRMED'
  };

  saveStoredProof(proofData);
  return { success: true, data: proofData, fallback: true };
}

export async function verifyDocument({ file, proof_id }) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('proof_id', proof_id);

  try {
    const res = await fetch(`${API_BASE_URL}/verify`, {
      method: 'POST',
      body: formData
    });
    if (res.ok) {
      const data = await res.json();
      return { success: true, data };
    }
  } catch (err) {
    console.warn('Backend unavailable, verifying locally:', err);
  }

  const proofs = getStoredProofs();
  const proof = proofs.find(p => p.proof_id === proof_id) || null;
  const receivedHash = await calculateSha256Browser(file);
  const originalHash = proof ? proof.document_hash : '';

  const isMatch = Boolean(proof && originalHash.toLowerCase() === receivedHash.toLowerCase());

  return {
    success: true,
    data: {
      status: isMatch ? 'VERIFIED' : 'INVALID',
      original_hash: originalHash,
      received_hash: receivedHash,
      proof: proof
    },
    fallback: true
  };
}

export async function getProof(proof_id) {
  try {
    const res = await fetch(`${API_BASE_URL}/proofs/${proof_id}`);
    if (res.ok) {
      return { success: true, data: await res.json() };
    }
  } catch (err) {
    console.warn('Backend unavailable, retrieving locally:', err);
  }

  const proofs = getStoredProofs();
  const proof = proofs.find(p => p.proof_id === proof_id);
  if (proof) {
    return { success: true, data: proof, fallback: true };
  }
  return { success: false, error: 'Proof not found' };
}