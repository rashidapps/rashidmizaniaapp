// أساسيات التشفير (WebCrypto فقط، بدون مكتبات): AES-256-GCM لتشفير البيانات، PBKDF2 لاشتقاق مفتاح كلمة المرور،
// HKDF لاشتقاق مفتاح من سر مفتاح المرور (WebAuthn PRF). مفتاح البيانات (DEK) عشوائي ويُغلَّف بكل وسيلة فتح.
const enc = new TextEncoder(), dec = new TextDecoder();
export const PBKDF2_ITER = 600000;

export function b64(buf) {
  const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const rand = n => crypto.getRandomValues(new Uint8Array(n));

export async function passphraseKey(pass, salt, iter, usages) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(pass).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, usages);
}
export const kekFromPassphrase = (pass, salt, iter = PBKDF2_ITER) => passphraseKey(pass, salt, iter, ['wrapKey', 'unwrapKey']);

export async function kekFromPrf(prfBytes, salt) {
  const base = await crypto.subtle.importKey('raw', prfBytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('mizaniyati-kek-v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}
export const newDataKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

export async function wrapDek(dek, kek) {
  const iv = rand(12);
  return { iv: b64(iv), ct: b64(await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv })) };
}
export const unwrapDek = (w, kek) =>
  crypto.subtle.unwrapKey('raw', unb64(w.ct), kek, { name: 'AES-GCM', iv: unb64(w.iv) }, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);

/** تشفير كائن JSON؛ aad يربط النص المشفر بمكانه (المخزن + المعرّف) فلا يمكن نقله لسجل آخر. */
export async function sealJSON(key, obj, aad) {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}
export async function openJSON(key, sealed, aad) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv), additionalData: enc.encode(aad) }, key, unb64(sealed.ct));
  return JSON.parse(dec.decode(pt));
}

/* ---------- نسخة احتياطية مشفّرة بكلمة مرور (ملف مستقل يمكن فتحه على أي جهاز) ---------- */
const BACKUP_AAD = 'mizaniyati-encrypted-backup-v1';
export async function encryptText(text, pass) {
  const salt = rand(16), iv = rand(12);
  const key = await passphraseKey(pass, salt, PBKDF2_ITER, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(BACKUP_AAD) }, key, enc.encode(text));
  return JSON.stringify({ app: 'mizaniyati', format: 'encrypted-backup', version: 1, exportedAt: new Date().toISOString(), kdf: { name: 'PBKDF2-SHA256', iter: PBKDF2_ITER, salt: b64(salt) }, iv: b64(iv), ct: b64(ct) });
}
export function isEncryptedBackup(text) {
  try { const o = JSON.parse(text); return !!o && o.app === 'mizaniyati' && o.format === 'encrypted-backup'; } catch { return false; }
}
/** يعيد النص الأصلي أو null إذا كانت كلمة المرور خاطئة/الملف تالفاً. */
export async function decryptText(fileText, pass) {
  try {
    const o = JSON.parse(fileText);
    if (o.format !== 'encrypted-backup' || o.version !== 1 || o.kdf?.name !== 'PBKDF2-SHA256' || !(o.kdf.iter >= 100000 && o.kdf.iter <= 5000000)) return null;
    const key = await passphraseKey(pass, unb64(o.kdf.salt), o.kdf.iter, ['decrypt']);
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv), additionalData: enc.encode(BACKUP_AAD) }, key, unb64(o.ct)));
  } catch { return null; }
}
