// منطق القفل والتشفير: تفعيل/إيقاف التشفير، الفتح بكلمة المرور أو بمفتاح المرور (Face ID)، تغيير كلمة المرور.
// نموذج المفاتيح: مفتاح بيانات عشوائي (DEK) يشفّر السجلات، ويُخزَّن مغلَّفاً مرتين: بمفتاح مشتق من كلمة المرور،
// وبمفتاح مشتق من سر مفتاح المرور (PRF) إن فُعِّل Face ID. كلمة المرور هي وسيلة الاسترجاع الوحيدة.
import { DATA_STORES } from './db.js';
import { PBKDF2_ITER, b64, unb64, rand, kekFromPassphrase, kekFromPrf, newDataKey, wrapDek, unwrapDek } from './crypto.js';
import { MIN_PASSPHRASE } from './config.js';
import { nowISO } from './util.js';

export const passkeySupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials && window.isSecureContext;

export function checkPassphrase(p) {
  if (typeof p !== 'string' || p.length < MIN_PASSPHRASE) return `كلمة المرور يجب ألا تقل عن ${MIN_PASSPHRASE} أحرف.`;
  if (/^(.)\1+$/.test(p) || /^(0123456789|12345678|password|11111111)/i.test(p)) return 'كلمة المرور سهلة التخمين.';
  return '';
}

export const getLockInfo = async db => { const m = await db.getMeta(); return m ? { enabled: true, passkey: !!m.passkey } : { enabled: false, passkey: false }; };

/** تشفير كل البيانات الحالية بكلمة المرور في معاملة واحدة ذرّية. */
export async function enableEncryption(db, pass) {
  if (db.encrypted || await db.getMeta()) throw new Error('التشفير مفعّل مسبقاً.');
  const err = checkPassphrase(pass); if (err) throw new Error(err);
  const data = await db.exportAll();
  const snaps = await db.getAll('snapshots');
  const dek = await newDataKey();
  const salt = rand(16);
  const meta = { id: 'lock', v: 1, kdf: { name: 'PBKDF2-SHA256', iter: PBKDF2_ITER, salt: b64(salt) }, wrapPass: await wrapDek(dek, await kekFromPassphrase(pass, salt)), passkey: null, createdAt: nowISO() };
  db.setKey(dek);
  try {
    const sealed = {};
    for (const n of DATA_STORES) sealed[n] = await db.sealAll(n, data[n]);
    const sealedSnaps = await db.sealAll('snapshots', snaps);
    await db.transact([...DATA_STORES, 'snapshots', 'meta'], st => {
      for (const n of DATA_STORES) { st(n).clear(); sealed[n].forEach(r => st(n).put(r)); }
      st('snapshots').clear(); sealedSnaps.forEach(r => st('snapshots').put(r));
      st('meta').put(meta);
    });
  } catch (e) { db.setKey(null); throw e; }
  try { localStorage.removeItem('mz.settings'); } catch { /* */ }
}

async function unwrapWithPass(meta, pass) {
  try { return await unwrapDek(meta.wrapPass, await kekFromPassphrase(pass, unb64(meta.kdf.salt), meta.kdf.iter)); } catch { return null; }
}
export async function unlockWithPassphrase(db, pass) {
  const meta = await db.getMeta();
  if (!meta) return true;
  const dek = await unwrapWithPass(meta, pass);
  if (!dek) return false;
  db.setKey(dek);
  return true;
}

async function prfGet(credId, prfSalt) {
  const a = await navigator.credentials.get({ publicKey: { challenge: rand(32), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: credId }], userVerification: 'required', timeout: 60000, extensions: { prf: { eval: { first: prfSalt } } } } });
  const r = a && a.getClientExtensionResults().prf;
  return r && r.results && r.results.first ? new Uint8Array(r.results.first) : null;
}
export async function unlockWithPasskey(db) {
  const meta = await db.getMeta();
  if (!meta || !meta.passkey) throw new Error('Face ID غير مفعّل.');
  const p = meta.passkey;
  const out = await prfGet(unb64(p.credId), unb64(p.prfSalt));
  if (!out) throw new Error('جهازك لم يُرجع سر مفتاح المرور. استخدم كلمة المرور.');
  try { db.setKey(await unwrapDek(p.wrap, await kekFromPrf(out, unb64(p.hkdfSalt)))); return true; } catch { return false; }
}

/** تفعيل Face ID: ينشئ مفتاح مرور ويتحقق فعلياً من أن الجهاز يدعم PRF قبل الاعتماد عليه. */
export async function addPasskey(db) {
  if (!db.encrypted) throw new Error('فعّل التشفير أولاً.');
  if (!passkeySupported()) throw new Error('هذا المتصفح لا يدعم مفاتيح المرور.');
  const meta = await db.getMeta();
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { id: location.hostname, name: 'ميزانيتي' },
    user: { id: rand(16), name: 'mizaniyati', displayName: 'ميزانيتي' },
    challenge: rand(32),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
    timeout: 60000, extensions: { prf: {} },
  } });
  const ext = cred.getClientExtensionResults();
  if (!ext.prf || !ext.prf.enabled) throw new Error('جهازك أو إصدار iOS لا يدعم استخدام Face ID لفتح البيانات (يتطلب دعم PRF). ستبقى كلمة المرور هي وسيلة الفتح.');
  const prfSalt = rand(32), hkdfSalt = rand(16);
  const out = await prfGet(cred.rawId, prfSalt);
  if (!out) throw new Error('تعذّر الحصول على سر مفتاح المرور من جهازك. ستبقى كلمة المرور هي وسيلة الفتح.');
  meta.passkey = { credId: b64(cred.rawId), prfSalt: b64(prfSalt), hkdfSalt: b64(hkdfSalt), wrap: await wrapDek(db.dek, await kekFromPrf(out, hkdfSalt)), addedAt: nowISO() };
  await db.putMeta(meta);
}
export async function removePasskey(db) {
  const meta = await db.getMeta();
  if (meta && meta.passkey) { meta.passkey = null; await db.putMeta(meta); }
}

export async function changePassphrase(db, oldPass, newPass) {
  const meta = await db.getMeta();
  if (!(await unwrapWithPass(meta, oldPass))) throw new Error('كلمة المرور الحالية غير صحيحة.');
  const err = checkPassphrase(newPass); if (err) throw new Error(err);
  const salt = rand(16);
  meta.kdf = { name: 'PBKDF2-SHA256', iter: PBKDF2_ITER, salt: b64(salt) };
  meta.wrapPass = await wrapDek(db.dek, await kekFromPassphrase(newPass, salt));
  await db.putMeta(meta);
}

/** إيقاف التشفير: يعيد كتابة كل البيانات دون تشفير ويحذف إعدادات القفل (بعد التحقق من كلمة المرور). */
export async function disableEncryption(db, pass) {
  const meta = await db.getMeta();
  if (!meta || !db.encrypted) throw new Error('التشفير غير مفعّل.');
  if (!(await unwrapWithPass(meta, pass))) throw new Error('كلمة المرور غير صحيحة.');
  const data = await db.exportAll();
  const snaps = await db.getAll('snapshots');
  await db.transact([...DATA_STORES, 'snapshots', 'meta'], st => {
    for (const n of DATA_STORES) { st(n).clear(); data[n].forEach(r => st(n).put(r)); }
    st('snapshots').clear(); snaps.forEach(r => st('snapshots').put(r));
    st('meta').clear();
  });
  db.setKey(null);
}
