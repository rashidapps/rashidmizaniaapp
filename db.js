// طبقة IndexedDB: فتح القاعدة، الترحيل بين الإصدارات، وعمليات القراءة/الكتابة المضمونة.
// كل عملية كتابة لا تُعتبر ناجحة إلا بعد اكتمال المعاملة (tx.oncomplete) وليس عند إرسال الطلب فقط.
import { DB_NAME, DB_VERSION } from './config.js';

export const DATA_STORES = ['months', 'fixed', 'variable', 'emergency', 'settings'];

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
};

export function friendlyError(e) {
  const n = e && e.name;
  if (n === 'QuotaExceededError') return 'مساحة التخزين ممتلئة. صدّر نسخة احتياطية ثم احذف بعض البيانات.';
  if (n === 'ConstraintError') return 'هذه العملية مسجلة مسبقاً.';
  if (n === 'InvalidStateError' || n === 'UnknownError') return 'تعذّر الوصول إلى التخزين المحلي. أعد فتح التطبيق.';
  if (e && e.message && /[؀-ۿ]/.test(e.message)) return e.message;
  return 'تعذّر حفظ البيانات. حاول مرة أخرى.';
}

export class Database {
  constructor(idb) { this.idb = idb; }

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
  getAll(store) { return this._read(store, s => s.getAll()); }
  get(store, key) { return this._read(store, s => s.get(key)); }
  getAllByIndex(store, index, key) { return this._read(store, s => s.index(index).getAll(key)); }
  count(store) { return this._read(store, s => s.count()); }
  put(store, obj) { return this.transact([store], st => st(store).put(obj)); }
  putMany(store, arr) { return this.transact([store], st => { const s = st(store); arr.forEach(o => s.put(o)); }); }
  delete(store, key) { return this.transact([store], st => st(store).delete(key)); }

  /** قراءة متسقة لكل مخازن البيانات داخل معاملة واحدة. */
  exportAll() {
    return new Promise((resolve, reject) => {
      let tx; const reqs = {};
      try {
        tx = this.idb.transaction(DATA_STORES, 'readonly');
        DATA_STORES.forEach(n => { reqs[n] = tx.objectStore(n).getAll(); });
      } catch (e) { return reject(e); }
      tx.oncomplete = () => resolve(Object.fromEntries(DATA_STORES.map(n => [n, reqs[n].result])));
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('aborted'));
    });
  }
  /** استبدال كل البيانات دفعة واحدة (ذرّياً): إما أن ينجح كله أو لا يتغير شيء. */
  replaceAll(data) {
    return this.transact(DATA_STORES, st => {
      for (const n of DATA_STORES) {
        const s = st(n);
        s.clear();
        for (const r of data[n] || []) s.put(r);
      }
    });
  }
  clearData() { return this.transact([...DATA_STORES, 'snapshots'], st => { [...DATA_STORES, 'snapshots'].forEach(n => st(n).clear()); }); }
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
