(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VaultCrypto = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_ITER = 600000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function toBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function fromBase64(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveKey(passcode, saltBytes, iterations) {
    const base = await crypto.subtle.importKey('raw', encoder.encode(String(passcode)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: iterations || DEFAULT_ITER, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptSecret(passcode, plaintext) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passcode, salt, DEFAULT_ITER);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(String(plaintext)));
    return {
      v: 1,
      iter: DEFAULT_ITER,
      salt: toBase64(salt),
      iv: toBase64(iv),
      ct: toBase64(new Uint8Array(ct))
    };
  }

  async function decryptSecret(vault, passcode) {
    try {
      const key = await deriveKey(passcode, fromBase64(vault.salt), vault.iter || DEFAULT_ITER);
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(vault.iv) },
        key,
        fromBase64(vault.ct)
      );
      return decoder.decode(plain);
    } catch (_) {
      return null;
    }
  }

  return { DEFAULT_ITER, toBase64, fromBase64, encryptSecret, decryptSecret };
});
