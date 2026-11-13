// عمليات البيانات (الراتب، المصاريف، الصندوق، الإعدادات) فوق طبقة db.js.
import { DEFAULT_CATEGORIES } from './config.js';
import { currentMonth, monthOf, daysInMonth, isValidMonth } from './dates.js';
import { assertValid, SETTING_KEYS } from './schema.js';
import { uid, nowISO } from './util.js';

export class Store {
  constructor(db) { this.db = db; this._ensuring = new Map(); }

  /* ---------- الإعدادات ---------- */
  async getSettings() {
    const o = {};
    (await this.db.getAll('settings')).forEach(r => { o[r.key] = r.value; });
    return o;
  }
  async setSetting(key, value) {
    assertValid('settings', { key, value });
    await this.db.put('settings', { key, value });
    await this._mirror();
  }
  // نسخة مصغّرة من الإعدادات في LocalStorage (احتياطي فقط؛ المصدر الأساسي هو IndexedDB).
  async _mirror() {
    if (this.db.encrypted) { try { localStorage.removeItem('mz.settings'); } catch { /* */ } return; }   // لا نسخ نصية عند التشفير
    try { localStorage.setItem('mz.settings', JSON.stringify(await this.getSettings())); } catch { /* التخزين غير متاح */ }
  }
  async init() {
    if (this.db.encrypted) return;
    try {
      if ((await this.db.count('months')) === 0 && (await this.db.count('settings')) === 0) {
        const m = JSON.parse(localStorage.getItem('mz.settings') || 'null');
        if (m && typeof m === 'object') {
          for (const [k, v] of Object.entries(m)) if (SETTING_KEYS[k]) await this.db.put('settings', { key: k, value: v });
        }
      }
    } catch { /* تجاهل */ }
  }
  async categories() {
    const s = await this.getSettings();
    return [...new Set([...DEFAULT_CATEGORIES, ...(s.categories || [])])];
  }
  async rememberCategory(cat) {
    cat = (cat || '').trim();
    if (!cat || DEFAULT_CATEGORIES.includes(cat)) return;
    const s = await this.getSettings();
    const list = s.categories || [];
    if (!list.includes(cat)) await this.setSetting('categories', [...list, cat].slice(-100));
  }

  /* ---------- الأشهر ---------- */
  async getAllMonths() { return (await this.db.getAll('months')).sort((a, b) => a.id.localeCompare(b.id)); }

  /** ينشئ سجل الشهر إن لم يوجد: يرث الراتب والمصاريف الثابتة من آخر شهر سابق. */
  ensureMonth(id) {
    if (!isValidMonth(id)) return Promise.reject(new Error('شهر غير صالح'));
    if (this._ensuring.has(id)) return this._ensuring.get(id);
    const p = (async () => {
      const existing = await this.db.get('months', id);
      if (existing) return existing;
      const [months, settings] = await Promise.all([this.getAllMonths(), this.getSettings()]);
      const prev = [...months].reverse().find(m => m.id < id);
      const prevFixed = prev ? await this.db.getAllByIndex('fixed', 'monthId', prev.id) : [];
      const t = nowISO();
      const month = { id, salary: settings.defaultSalary ?? prev?.salary ?? 0, createdAt: t, updatedAt: t };
      const copies = prevFixed.map(f => ({
        id: uid(), monthId: id, name: f.name, amount: f.amount,
        dueDay: f.dueDay, note: f.note || '', createdAt: t, updatedAt: t,
      }));
      const sealedMonth = await this.db.seal('months', month);
      const sealedCopies = await this.db.sealAll('fixed', copies);
      await this.db.transact(['months', 'fixed'], st => {
        const r = st('months').get(id);
        r.onsuccess = () => { if (!r.result) { st('months').put(sealedMonth); sealedCopies.forEach(c => st('fixed').put(c)); } };
      });
      return this.db.get('months', id);
    })();
    this._ensuring.set(id, p);
    return p.finally(() => this._ensuring.delete(id));
  }

  async getMonthData(id) {
    const month = await this.ensureMonth(id);
    const [fixed, variable, emergency] = await Promise.all([
      this.db.getAllByIndex('fixed', 'monthId', id),
      this.db.getAllByIndex('variable', 'monthId', id),
      this.db.getAllByIndex('emergency', 'monthId', id),
    ]);
    return { month, fixed, variable, emergency };
  }
  async loadEverything() {
    const d = await this.db.exportAll();
    d.months.sort((a, b) => a.id.localeCompare(b.id));
    return d;
  }
  getAllEmergency() { return this.db.getAll('emergency'); }
  getAllVariable() { return this.db.getAll('variable'); }

  async setSalary(monthId, salary) {
    await this.ensureMonth(monthId);
    const cur = await this.db.get('months', monthId);
    const rec = { ...cur, salary, updatedAt: nowISO() };
    assertValid('months', rec);
    const sealedMonth = await this.db.seal('months', rec);
    const sealedDefault = monthId === currentMonth() ? await this.db.seal('settings', { key: 'defaultSalary', value: salary }) : null;
    await this.db.transact(['months', 'settings'], st => {
      st('months').put(sealedMonth);
      // تعديل راتب الشهر الحالي يصبح الراتب الافتراضي للأشهر القادمة
      if (sealedDefault) st('settings').put(sealedDefault);
    });
    await this._mirror();
    return rec;
  }

  /* ---------- المصاريف الثابتة ---------- */
  async addFixed({ monthId, name, amount, dueDay, note }) {
    await this.ensureMonth(monthId);
    const t = nowISO();
    const rec = { id: uid(), monthId, name: name.trim(), amount, dueDay, note: (note || '').trim(), createdAt: t, updatedAt: t };
    assertValid('fixed', rec);
    await this.db.put('fixed', rec);
    return rec;
  }
  async updateFixed(id, patch) {
    const cur = await this.db.get('fixed', id);
    if (!cur) throw new Error('العنصر غير موجود (ربما حُذف).');
    const rec = { ...cur, ...patch, updatedAt: nowISO() };
    if (typeof rec.name === 'string') rec.name = rec.name.trim();
    assertValid('fixed', rec);
    await this.db.put('fixed', rec);
    return rec;
  }
  deleteFixed(id) { return this.db.delete('fixed', id); }

  /* ---------- المصاريف غير الثابتة ---------- */
  async addVariable({ name, amount, date, category, note, source = 'manual', ref, needsReview }) {
    const monthId = monthOf(date);
    await this.ensureMonth(monthId);
    const t = nowISO();
    const rec = { id: uid(), monthId, name: name.trim(), amount, date, category: (category || '').trim(), note: (note || '').trim(), source, createdAt: t, updatedAt: t };
    if (ref) rec.ref = ref;
    if (needsReview) rec.needsReview = true;
    assertValid('variable', rec);
    await this.db.put('variable', rec);
    await this.rememberCategory(rec.category);
    return rec;
  }
  async updateVariable(id, patch) {
    const cur = await this.db.get('variable', id);
    if (!cur) throw new Error('العنصر غير موجود (ربما حُذف).');
    const rec = { ...cur, ...patch, updatedAt: nowISO() };
    if (typeof rec.name === 'string') rec.name = rec.name.trim();
    if (typeof rec.category === 'string') rec.category = rec.category.trim();
    if (typeof rec.note === 'string') rec.note = rec.note.trim();
    rec.monthId = monthOf(rec.date);
    if (rec.needsReview === false) delete rec.needsReview;
    assertValid('variable', rec);
    await this.ensureMonth(rec.monthId);
    await this.db.put('variable', rec);
    await this.rememberCategory(rec.category);
    return rec;
  }
  deleteVariable(id) { return this.db.delete('variable', id); }

  /** إضافة عمليات بنكية مع منع التكرار عبر المرجع (ref). */
  async addBankExpenses(items) {
    const existing = new Set((await this.db.getAll('variable')).map(v => v.ref).filter(Boolean));
    const t = nowISO();
    const recs = [];
    let skipped = 0;
    for (const it of items) {
      let ref = it.ref;
      if (existing.has(ref)) {
        if (!it.force) { skipped++; continue; }
        let n = 2; while (existing.has(`${it.ref}#${n}`)) n++;
        ref = `${it.ref}#${n}`;
      }
      existing.add(ref);
      const rec = {
        id: uid(), monthId: monthOf(it.date), name: it.name.trim(), amount: it.amount, date: it.date,
        category: '', note: '', source: 'bank', ref, needsReview: true, createdAt: t, updatedAt: t,
      };
      assertValid('variable', rec);
      recs.push(rec);
    }
    for (const m of new Set(recs.map(r => r.monthId))) await this.ensureMonth(m);
    if (recs.length) await this.db.putMany('variable', recs);
    return { added: recs.length, skipped };
  }

  /* ---------- صندوق الطوارئ ---------- */
  async addEmergency({ type, amount, date, reason }) {
    const monthId = monthOf(date);
    await this.ensureMonth(monthId);
    const t = nowISO();
    const rec = { id: uid(), monthId, type, amount, date, reason: (reason || '').trim(), createdAt: t, updatedAt: t };
    assertValid('emergency', rec);
    await this.db.put('emergency', rec);
    return rec;
  }
  async updateEmergency(id, patch) {
    const cur = await this.db.get('emergency', id);
    if (!cur) throw new Error('الحركة غير موجودة (ربما حُذفت).');
    const rec = { ...cur, ...patch, updatedAt: nowISO() };
    rec.monthId = monthOf(rec.date);
    if (typeof rec.reason === 'string') rec.reason = rec.reason.trim();
    assertValid('emergency', rec);
    await this.ensureMonth(rec.monthId);
    await this.db.put('emergency', rec);
    return rec;
  }
  deleteEmergency(id) { return this.db.delete('emergency', id); }

  /* ---------- النسخ الاحتياطي والاستعادة ---------- */
  async saveSnapshot(payload) { await this.db.put('snapshots', { id: 'last', createdAt: nowISO(), payload }); }
  getSnapshot() { return this.db.get('snapshots', 'last'); }
  async restoreData(data) { await this.db.replaceAll(data); await this._mirror(); }
  async wipeAll() {
    await this.db.clearData();   // يمسح البيانات وإعدادات القفل ويُسقط مفتاح التشفير من الذاكرة
    try { Object.keys(localStorage).filter(k => k.startsWith('mz.')).forEach(k => localStorage.removeItem(k)); } catch { /* */ }
  }
}
export { daysInMonth };
