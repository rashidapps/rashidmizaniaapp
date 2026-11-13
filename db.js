// طبقة IndexedDB: فتح القاعدة، الترحيل بين الإصدارات، وعمليات القراءة/الكتابة المضمونة.
// كل عملية كتابة لا تُعتبر ناجحة إلا بعد اكتمال المعاملة (tx.oncomplete) وليس عند إرسال الطلب فقط.
import { DB_NAME, DB_VERSION } from './config.js';
import { sealJSON, openJSON } from './crypto.js';

export const DATA_STORES = ['months', 'fixed', 'variable', 'emergency', 'settings'];
// الحقول التي تبقى غير مشفّرة عند تفعيل التشفير (مطلوبة للفهارس والاستعلام). كل ما عداها يُشفَّر.
// المحتوى المالي (الأسماء، المبالغ، الملاحظات، التصنيفات، الإعدادات) مشفّر دائماً؛ التواريخ ومعرّفات الأشهر تبقى ظاهرة.
const PLAIN_FIELDS = {
  months: ['id'], fixed: ['id', 'monthId'], variable: ['id', 'monthId', 'date', 'ref'],
  emergency: ['id', 'monthId', 'date'], settings: ['key'], snapshots: ['id', 'createdAt'],
};
const keyOf = (store, r) => (store === 'settings' ? r.key : r.id);

// إضافة ترحيل جديد: ارفع DB_VERSION في config.js ثم أضف دالة بالرقم الجديد هنا، مثال:
//   2(db, tx) { tx.objectStore('variable').createIndex('category', 'category'); }
const MIGRATIONS = {
  1(db) {
    db.createObjectStore('months', { keyPath: 'id' });
    const f = db.createObjectStore('fixed', { keyPath: 'id' });
    f.createIndex('monthId', 'monthId');
    const v = db.createObjectStore('variable', { keyPath: 'id' });
    v.createIndex('monthId', 'monthId');
    v.createIndex('date', 'date');
    v.createIndex('ref', 'ref', { unique: true });
    const e = db.createObjectStore('emergency', { keyPath: 'id' });
    e.createIndex('monthId', 'monthId');
    e.createIndex('date', 'date');
    db.createObjectStore('settings', { keyPath: 'key' });
    db.createObjectStore('snapshots', { keyPath: 'id' });
  },
  2(db) {   // مخزن بيانات القفل (مفاتيح مغلَّفة فقط، لا أسرار قابلة للقراءة)
    db.createObjectStore('meta', { keyPath: 'id' });
  },
};

export function friendlyError(e) {
  const n = e && e.name;
  if (n === 'QuotaExceededError') return 'مساحة التخزين ممتلئة. صدّر نسخة احتياطية ثم احذف بعض البيانات.';
  if (n === 'NotAllowedError') return 'أُلغيت العملية أو رفضها الجهاز.';
  if (n === 'ConstraintError') return 'هذه العملية مسجلة مسبقاً.';
  if (n === 'InvalidStateError' || n === 'UnknownError') return 'تعذّر الوصول إلى التخزين المحلي. أعد فتح التطبيق.';
  if (e && e.message && /[؀-ۿ]/.test(e.message)) return e.message;
  return 'تعذّر حفظ البيانات. حاول مرة أخرى.';
}

export class Database {
  constructor(idb) { this.idb = idb; this.dek = null; }
  get encrypted() { return !!this.dek; }
  setKey(k) { this.dek = k || null; }

  /** تشفير سجل قبل كتابته (يجب استدعاؤه قبل فتح المعاملة لأن WebCrypto غير متزامن). */
  async seal(store, rec) {
    if (!this.dek) return rec;
    const plain = {}, rest = { ...rec };
    for (const f of PLAIN_FIELDS[store]) if (f in rec) { plain[f] = rec[f]; delete rest[f]; }
    plain._enc = await sealJSON(this.dek, rest, `${store}:${keyOf(store, rec)}`);
    return plain;
  }
  async open(store, rec) {
    if (!rec || !rec._enc) return rec;
    if (!this.dek) throw new Error('التطبيق مقفل.');
    try {
      const { _enc, ...plain } = rec;
      return { ...plain, ...(await openJSON(this.dek, _enc, `${store}:${keyOf(store, rec)}`)) };
    } catch { throw new Error('تعذّر فك تشفير بعض البيانات (قد تكون تالفة).'); }
  }
  openAll(store, rows) { return Promise.all(rows.map(r => this.open(store, r))); }
  sealAll(store, rows) { return Promise.all(rows.map(r => this.seal(store, r))); }

  _read(store, fn) {
    return new Promise((resolve, reject) => {
      let tx, r;
      try { tx = this.idb.transaction(store, 'readonly'); r = fn(tx.objectStore(store)); } catch (e) { return reject(e); }
      tx.oncomplete = () => resolve(r.result);
      tx.onerror = () => reject(tx.error || r.error);
      tx.onabort = () => reject(tx.error || r.error || new Error('aborted'));
    });
  }
  /** معاملة كتابة على عدة مخازن. تُحلّ الوعد فقط بعد اكتمال المعاملة. */
  transact(stores, fn) {
    return new Promise((resolve, reject) => {
      let tx, out;
      try { tx = this.idb.transaction(stores, 'readwrite'); } catch (e) { return reject(e); }
      tx.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new DOMException('aborted', 'AbortError'));
      try { out = fn(name => tx.objectStore(name), tx); } catch (e) { try { tx.abort(); } catch { /* */ } reject(e); }
    });
  }
  async getAll(store) { return this.openAll(store, await this._read(store, s => s.getAll())); }
  async get(store, key) { return this.open(store, await this._read(store, s => s.get(key))); }
  async getAllByIndex(store, index, key) { return this.openAll(store, await this._read(store, s => s.index(index).getAll(key))); }
  count(store) { return this._read(store, s => s.count()); }
  async put(store, obj) { const o = await this.seal(store, obj); return this.transact([store], st => st(store).put(o)); }
  async putMany(store, arr) { const o = await this.sealAll(store, arr); return this.transact([store], st => { const s = st(store); o.forEach(x => s.put(x)); }); }
  delete(store, key) { return this.transact([store], st => st(store).delete(key)); }

  /* بيانات القفل (غير مشفّرة بذاتها؛ تحتوي مفتاح البيانات مغلَّفاً فقط) */
  getMeta() { return this._read('meta', s => s.get('lock')); }
  putMeta(meta) { return this.transact(['meta'], st => st('meta').put(meta)); }

  /** قراءة متسقة لكل مخازن البيانات داخل معاملة واحدة (تُعاد مفكوكة التشفير). */
  async exportAll() {
    const raw = await new Promise((resolve, reject) => {
      let tx; const reqs = {};
      try {
        tx = this.idb.transaction(DATA_STORES, 'readonly');
        DATA_STORES.forEach(n => { reqs[n] = tx.objectStore(n).getAll(); });
      } catch (e) { return reject(e); }
      tx.oncomplete = () => resolve(Object.fromEntries(DATA_STORES.map(n => [n, reqs[n].result])));
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('aborted'));
    });
    const out = {};
    for (const n of DATA_STORES) out[n] = await this.openAll(n, raw[n]);
    return out;
  }
  /** استبدال كل البيانات دفعة واحدة (ذرّياً): إما أن ينجح كله أو لا يتغير شيء. */
  async replaceAll(data) {
    const sealed = {};
    for (const n of DATA_STORES) sealed[n] = await this.sealAll(n, data[n] || []);
    return this.transact(DATA_STORES, st => {
      for (const n of DATA_STORES) { const s = st(n); s.clear(); sealed[n].forEach(r => s.put(r)); }
    });
  }
  /** حذف كل شيء بما فيه إعدادات القفل. */
  async clearData() {
    const all = [...DATA_STORES, 'snapshots', 'meta'];
    await this.transact(all, st => all.forEach(n => st(n).clear()));
    this.dek = null;
  }
  close() { this.idb.close(); }
}

export function openDB(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(Object.assign(new Error('IndexedDB غير مدعوم'), { name: 'Unsupported' }));
    let req;
    try { req = indexedDB.open(name, DB_VERSION); } catch (e) { return reject(e); }
    req.onupgradeneeded = ev => {
      const db = req.result, tx = req.transaction;
      for (let v = ev.oldVersion + 1; v <= DB_VERSION; v++) MIGRATIONS[v] && MIGRATIONS[v](db, tx, ev.oldVersion);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); globalThis.dispatchEvent && dispatchEvent(new Event('db-versionchange')); };
      resolve(new Database(db));
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => { globalThis.dispatchEvent && dispatchEvent(new Event('db-blocked')); };
  });
}
