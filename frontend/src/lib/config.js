// Ortam ayarları (CONTRACT.md v2). Program ID yoksa ya da VITE_USE_MOCK=true ise DEMO modu açılır:
// bu modda hiçbir şey zincire yazılmaz ve arayüzde "DEMO" etiketi görünür.
const env = import.meta.env;

// docs/test_vectors_v2.json'daki test program ID'si: yalnızca DEMO modunda PDA adresi üretmek için.
export const DEMO_PROGRAM_ID = 'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB';

export const PROGRAM_ID = env.VITE_PROGRAM_ID || '';
export const RPC_URL = env.VITE_RPC_URL || 'https://api.devnet.solana.com';
export const CLUSTER = env.VITE_CLUSTER || 'devnet';
export const API_URL = env.VITE_API_URL || ''; // opsiyonel yardımcı backend (/relay, /health)
export const USE_MOCK = env.VITE_USE_MOCK === 'true' || !PROGRAM_ID;
export const EFFECTIVE_PROGRAM_ID = PROGRAM_ID || DEMO_PROGRAM_ID;
