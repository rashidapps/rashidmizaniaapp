// النسخ الاحتياطي: بناء ملف JSON مع بصمة تحقق، التحقق قبل الاستيراد، تصدير CSV، وتسليم الملف للمستخدم.
import { APP_ID, APP_VERSION, DB_VERSION } from './config.js';
import { DATA_STORES } from './db.js';
import { validateRecord } from './schema.js';
import { formatAmount } from './money.js';
import { pad, daysInMonth, monthLabel } from './dates.js';
import { cyrb53 } from './util.js';

export const BACKUP_FORMAT = 1;
const MAX_BYTES = 25 * 1024 * 1024;

export async function digest(str) {
  if (globalThis.crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return 'sha256:' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return 'cyrb53:' + cyrb53(str).toString(16);
}

export async function buildBackup(data) {
  const clean = {};
  for (const s of DATA_STORES) clean[s] = data[s] || [];
  const counts = Object.fromEntries(DATA_STORES.map(s => [s, clean[s].length]));
  return {
    app: APP_ID, format: BACKUP_FORMAT, schemaVersion: DB_VERSION, appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(), counts,
    checksum: await digest(JSON.stringify(clean)),
    data: clean,
  };
}

// ترقية بيانات نسخة قديمة إلى هيكل الإصدار الحالي (فارغة حالياً — الإصدار 1 فقط).
const UPGRADES = { /* 1(data) { ... تحويل من v1 إلى v2 ... } */ };
export function upgradeBackupData(data, from) {
  for (let v = from; v < DB_VERSION; v++) UPGRADES[v] && UPGRADES[v](data);
  return data;
}

/** يتحقق من نص ملف النسخة الاحتياطية. يعيد {ok:true, backup, summary} أو {ok:false, errors}. */
export async function validateBackupText(text) {
  const fail = (...errors) => ({ ok: false, errors });
  if (typeof text !== 'string' || !text.trim()) return fail('الملف فارغ.');
  if (text.length > MAX_BYTES) return fail('حجم الملف أكبر من المسموح.');
  let obj;
  try { obj = JSON.parse(text); } catch { return fail('الملف ليس بصيغة JSON صحيحة.'); }
  if (!obj || typeof obj !== 'object' || obj.app !== APP_ID) return fail('هذا الملف ليس نسخة احتياطية من تطبيق ميزانيتي.');
  if (!Number.isInteger(obj.schemaVersion) || obj.schemaVersion < 1) return fail('رقم إصدار النسخة غير صالح.');
  if (obj.schemaVersion > DB_VERSION) return fail('هذه النسخة أحدث من التطبيق الحالي. حدّث التطبيق أولاً.');
  if (!obj.data || typeof obj.data !== 'object') return fail('بيانات النسخة مفقودة.');
  for (const s of DATA_STORES) if (!Array.isArray(obj.data[s])) return fail(`قسم "${s}" مفقود أو تالف.`);
  if (typeof obj.checksum !== 'string') return fail('بصمة التحقق مفقودة.');
  const cleanData = {};
  for (const s of DATA_STORES) cleanData[s] = obj.data[s];
  const [algo] = obj.checksum.split(':');
  if (algo === 'sha256' && !(globalThis.crypto && crypto.subtle)) return fail('تعذّر التحقق من البصمة في هذا المتصفح.');
  if ((algo === 'sha256' || algo === 'cyrb53') && obj.checksum !== (algo === 'sha256' ? await digest(JSON.stringify(cleanData)) : 'cyrb53:' + cyrb53(JSON.stringify(cleanData)).toString(16))) {
    return fail('فشل التحقق من سلامة الملف: يبدو أنه تالف أو تم تعديله.');
  }
  if (algo !== 'sha256' && algo !== 'cyrb53') return fail('نوع بصمة غير معروف.');

  const errors = [];
  const monthIds = new Set(cleanData.months.map(m => m.id));
  for (const s of DATA_STORES) {
    const ids = new Set(), refs = new Set(), keys = new Set();
    cleanData[s].forEach((r, i) => {
      const errs = validateRecord(s, r);
      if (errs.length) { errors.push(`${s} #${i + 1}: ${errs[0]}`); return; }
      const key = s === 'settings' ? r.key : r.id;
      if (keys.has(key)) errors.push(`${s}: معرّف مكرر (${String(key).slice(0, 20)})`);
      keys.add(key);
      if (s !== 'months' && s !== 'settings' && !monthIds.has(r.monthId)) errors.push(`${s} #${i + 1}: يشير إلى شهر غير موجود في النسخة`);
      if (s === 'variable' && r.ref) { if (refs.has(r.ref)) errors.push(`variable: مرجع بنكي مكرر`); refs.add(r.ref); }
    });
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, 6).concat(errors.length > 6 ? [`… و${errors.length - 6} أخطاء أخرى`] : []) };

  const data = upgradeBackupData(cleanData, obj.schemaVersion);
  const ids = data.months.map(m => m.id).sort();
  return {
    ok: true,
    backup: { ...obj, data },
    summary: {
      exportedAt: obj.exportedAt, counts: Object.fromEntries(DATA_STORES.map(s => [s, data[s].length])),
      from: ids[0], to: ids[ids.length - 1],
    },
  };
}

export function backupFilename(d = new Date()) {
  return `mizaniyati-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

/* ---------- CSV ---------- */
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // منع تنفيذ الصيغ عند فتح الملف في Excel
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCSV(data, { monthId } = {}) {
  const rows = [];
  const inScope = id => !monthId || id === monthId;
  for (const f of data.fixed) if (inScope(f.monthId)) rows.push({ sort: `${f.monthId}-${pad(Math.min(f.dueDay, daysInMonth(f.monthId)))}`, cells: ['مصروف ثابت', f.monthId, `${f.monthId}-${pad(Math.min(f.dueDay, daysInMonth(f.monthId)))}`, f.name, formatAmount(f.amount).replace(/,/g, ''), '', f.note || '', ''] });
  for (const v of data.variable) if (inScope(v.monthId)) rows.push({ sort: v.date, cells: ['مصروف غير ثابت', v.monthId, v.date, v.name, formatAmount(v.amount).replace(/,/g, ''), v.category, v.note || '', v.source === 'bank' ? (v.needsReview ? 'بنكي - يحتاج مراجعة' : 'بنكي') : 'يدوي'] });
  for (const t of data.emergency) if (inScope(t.monthId)) rows.push({ sort: t.date, cells: [t.type === 'deposit' ? 'إيداع صندوق الطوارئ' : 'سحب من صندوق الطوارئ', t.monthId, t.date, t.reason || '', formatAmount(t.amount).replace(/,/g, ''), '', '', ''] });
  rows.sort((a, b) => a.sort.localeCompare(b.sort) || a.cells[0].localeCompare(b.cells[0]));
  const head = ['النوع', 'الشهر', 'التاريخ', 'الاسم / السبب', 'المبلغ (ر.ع.)', 'التصنيف', 'ملاحظات', 'المصدر'];
  const salaryRows = data.months.filter(m => inScope(m.id)).map(m => ({ sort: m.id, cells: ['الراتب', m.id, '', monthLabel(m.id), formatAmount(m.salary).replace(/,/g, ''), '', '', ''] }));
  return '﻿' + [head, ...salaryRows.concat(rows).map(r => r.cells)].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/* ---------- تسليم الملف للمستخدم ---------- */
// المتصفح لا يستطيع الكتابة تلقائياً في iCloud Drive. الحفظ يتم عبر قائمة المشاركة (حفظ في الملفات)
// أو التنزيل. الواجهة مصممة كسجل "وجهات" ليسهل إضافة وجهة أخرى مستقبلاً (مثل OPFS أو File System Access).
const targets = [];
export const registerBackupTarget = t => targets.push(t);
export const getBackupTargets = () => targets.slice();

registerBackupTarget({
  id: 'share-or-download',
  label: 'حفظ في تطبيق الملفات / مشاركة',
  async save(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return { method: 'share' }; }
      catch (e) { if (e && e.name === 'AbortError') return { method: 'share', cancelled: true }; /* غير ذلك: نكمل بالتنزيل */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { method: 'download' };
  },
});
export const deliverFile = (filename, mime, content) => targets[0].save(filename, mime, content);
