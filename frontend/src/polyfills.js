// @solana/web3.js ve cüzdan adaptörleri tarayıcıda global Buffer bekler. main.jsx'te ilk import edilir.
import { Buffer } from 'buffer';

globalThis.Buffer = globalThis.Buffer || Buffer;
