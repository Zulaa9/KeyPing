import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, pbkdf2Sync, createCipheriv } from 'crypto';
import { sha256, hmacSha256Hex } from '../sha256';
import { fromBase64, fromHex, toBase64, toHex, utf8Decode, utf8Encode } from '../bytes';
import { webCrypto } from '../web-crypto';

test('sha256 matches node for lengths 0..300', () => {
  for (let n = 0; n <= 300; n++) {
    const data = randomBytes(n);
    assert.equal(toHex(sha256(new Uint8Array(data))), createHash('sha256').update(data).digest('hex'), `len ${n}`);
  }
});

test('hmac-sha256 matches createHmac (keys of 16..100 bytes, non-ASCII text)', () => {
  for (const keyLen of [16, 32, 63, 64, 65, 100]) {
    const key = randomBytes(keyLen);
    for (const text of ['', 'a', 'Gato-Azul-77!', '日本パスワード-秘密 🎌', 'ñ'.repeat(500)]) {
      assert.equal(hmacSha256Hex(text, new Uint8Array(key)), createHmac('sha256', key).update(text).digest('hex'));
    }
  }
});

test('base64 and hex round-trip like Buffer', () => {
  for (let n = 0; n < 70; n++) {
    const b = randomBytes(n);
    assert.equal(toBase64(new Uint8Array(b)), b.toString('base64'));
    assert.deepEqual(Buffer.from(fromBase64(b.toString('base64'))), b);
    assert.equal(toHex(new Uint8Array(b)), b.toString('hex'));
    assert.deepEqual(Buffer.from(fromHex(b.toString('hex'))), b);
  }
  // Misma tolerancia que Buffer.from(s, 'base64') con saltos de línea y espacios.
  const wrapped = 'SG9s\nYSBt dW5k\r\nbw==';
  assert.deepEqual(Buffer.from(fromBase64(wrapped)), Buffer.from(wrapped, 'base64'));
  assert.equal(utf8Decode(utf8Encode('Ñandú ☕ 日本')), 'Ñandú ☕ 日本');
});

test('web crypto pbkdf2 (sha256 and sha512) equals node pbkdf2Sync', async () => {
  const salt = randomBytes(16);
  for (const hash of ['sha256', 'sha512'] as const) {
    const a = await webCrypto.pbkdf2('Contraseña-ñ-日本', new Uint8Array(salt), 1000, 32, hash);
    assert.deepEqual(Buffer.from(a), pbkdf2Sync('Contraseña-ñ-日本', salt, 1000, 32, hash));
  }
});

test('web crypto aes-256-gcm interoperates with node createCipheriv', async () => {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update('{"entries":[]}', 'utf8'), c.final()]);
  const plain = await webCrypto.aesGcmDecrypt(new Uint8Array(key), new Uint8Array(iv), new Uint8Array(ct), new Uint8Array(c.getAuthTag()));
  assert.equal(utf8Decode(plain), '{"entries":[]}');
  const { ciphertext, tag } = await webCrypto.aesGcmEncrypt(new Uint8Array(key), new Uint8Array(iv), utf8Encode('{"entries":[]}'));
  assert.deepEqual(Buffer.from(ciphertext), ct);
  assert.deepEqual(Buffer.from(tag), c.getAuthTag());
  const badTag = Uint8Array.from(tag); badTag[0] ^= 1;
  await assert.rejects(webCrypto.aesGcmDecrypt(new Uint8Array(key), new Uint8Array(iv), ciphertext, badTag));
});
