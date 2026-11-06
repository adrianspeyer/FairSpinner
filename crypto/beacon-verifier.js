// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// License: https://polyformproject.org/licenses/noncommercial/1.0.0
// Required Notice: Copyright (c) 2026 Adrian Speyer (https://github.com/adrianspeyer/FairSpinner)
// Third-party Noble code retains its MIT license; see THIRD_PARTY_NOTICES.md.
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

// Pinned from the official quicknet chain info. These are trust anchors, never
// values learned from an untrusted audit or selected by a response's public key.
const QUICKNET = Object.freeze({
  chainHash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  publicKey: '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  genesisTime: 1692803367,
  period: 3,
  scheme: 'bls-unchained-g1-rfc9380',
});
const DST = 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_';
const isRound = value => Number.isSafeInteger(value) && value >= 1;
const isHex = (value, length) => typeof value === 'string' && value.length === length && /^[0-9a-f]+$/.test(value);
const publicKey = hexToBytes(QUICKNET.publicKey);
const verified = new Set();

function randomness(signature) {
  if (!isHex(signature, 96)) throw new Error('Expected a 48-byte lowercase hexadecimal quicknet signature.');
  return bytesToHex(sha256(hexToBytes(signature)));
}

function verify(proof, expectedRound) {
  try {
    if (!proof || typeof proof !== 'object' || Array.isArray(proof) || !isRound(expectedRound) || proof.round !== expectedRound || !isHex(proof.signature, 96) || !isHex(proof.randomness, 64)) return false;
    // Optional metadata must agree with the pin. It never overrides the pin.
    for (const field of ['chainHash', 'publicKey', 'genesisTime', 'period', 'scheme']) {
      if (proof[field] !== undefined && proof[field] !== QUICKNET[field]) return false;
    }
    if (proof.previous_signature !== undefined) return false; // quicknet is unchained
    if (randomness(proof.signature) !== proof.randomness) return false;
    const cacheKey = `${expectedRound}:${proof.signature}:${proof.randomness}`;
    if (verified.has(cacheKey)) return true;
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, BigInt(expectedRound), false);
    // drand quicknet signs SHA-256(uint64be(round)), with RFC 9380 G1 hash-to-curve.
    const message = bls12_381.shortSignatures.hash(sha256(bytes), DST);
    const valid = bls12_381.shortSignatures.verify(hexToBytes(proof.signature), message, publicKey);
    if (valid) {
      if (verified.size >= 64) verified.delete(verified.values().next().value);
      verified.add(cacheKey);
    }
    return valid;
  } catch (error) {
    return false;
  }
}

function timeOfRound(round) {
  if (!isRound(round)) throw new Error('Invalid drand round.');
  const time = QUICKNET.genesisTime + (round - 1) * QUICKNET.period;
  if (!Number.isSafeInteger(time)) throw new Error('Round timestamp is outside the safe integer range.');
  return time;
}

function roundAt(unixSeconds) {
  if (!Number.isFinite(unixSeconds) || unixSeconds < QUICKNET.genesisTime || unixSeconds > Number.MAX_SAFE_INTEGER) throw new Error('Timestamp is outside the quicknet range.');
  return Math.floor((unixSeconds - QUICKNET.genesisTime) / QUICKNET.period) + 1;
}

globalThis.FairSpinBeacon = Object.freeze({ QUICKNET, verify, randomness, timeOfRound, roundAt });
