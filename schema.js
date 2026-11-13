// التحقق من سلامة السجلات — يُستخدم عند الحفظ وعند استيراد النسخ الاحتياطية.
import { isValidISO, isValidMonth, monthOf } from './dates.js';

const isInt = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
const isStr = (s, max = 500) => typeof s === 'string' && s.length <= max;
const optStr = (s, max = 500) => s === undefined || isStr(s, max);

export const SETTING_KEYS = { defaultSalary: 'int', emergencyTarget: 'int', emergencyMonths: 'int', categories: 'strArray' };

export function validateRecord(store, r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['سجل غير صالح'];
  const e = [];
  const id = () => { if (!isStr(r.id, 100) || !r.id) e.push('معرّف سجل مفقود أو غير صالح'); };
  switch (store) {
    case 'months':
      if (!isValidMonth(r.id)) e.push('معرّف شهر غير صالح');
      if (!isInt(r.salary)) e.push('قيمة راتب غير صالحة');
      break;
    case 'fixed':
      id();
      if (!isValidMonth(r.monthId)) e.push('شهر غير صالح في مصروف ثابت');
      if (!isStr(r.name, 100) || !r.name.trim()) e.push('اسم المصروف الثابت مفقود');
      if (!isInt(r.amount, 1)) e.push('مبلغ المصروف الثابت غير صالح');
      if (!isInt(r.dueDay, 1) || r.dueDay > 31) e.push('يوم الاستحقاق غير صالح');
      if (!optStr(r.note)) e.push('ملاحظة غير صالحة');
      break;
    case 'variable':
      id();
      if (!isStr(r.name, 100) || !r.name.trim()) e.push('اسم المصروف مفقود');
      if (!isInt(r.amount, 1)) e.push('مبلغ المصروف غير صالح');
      if (!isValidISO(r.date)) e.push('تاريخ مصروف غير صالح');
      else if (monthOf(r.date) !== r.monthId) e.push('تاريخ المصروف لا يطابق شهره');
      if (!isStr(r.category, 60)) e.push('تصنيف غير صالح');
      if (!optStr(r.note)) e.push('ملاحظة غير صالحة');
      if (r.source !== 'manual' && r.source !== 'bank') e.push('مصدر المصروف غير صالح');
      if (r.ref !== undefined && !isStr(r.ref, 100)) e.push('مرجع غير صالح');
      if (r.needsReview !== undefined && typeof r.needsReview !== 'boolean') e.push('علامة المراجعة غير صالحة');
      break;
    case 'emergency':
      id();
      if (r.type !== 'deposit' && r.type !== 'withdraw') e.push('نوع حركة الصندوق غير صالح');
      if (!isInt(r.amount, 1)) e.push('مبلغ حركة الصندوق غير صالح');
      if (!isValidISO(r.date)) e.push('تاريخ حركة غير صالح');
      else if (monthOf(r.date) !== r.monthId) e.push('تاريخ الحركة لا يطابق شهرها');
      if (!isStr(r.reason, 200)) e.push('سبب غير صالح');
      else if (r.type === 'withdraw' && !r.reason.trim()) e.push('سبب السحب مطلوب');
      break;
    case 'settings': {
      const t = SETTING_KEYS[r.key];
      if (!t) e.push('إعداد غير معروف');
      else if (t === 'int' && !isInt(r.value)) e.push(`قيمة الإعداد ${r.key} غير صالحة`);
      else if (t === 'strArray' && !(Array.isArray(r.value) && r.value.length <= 200 && r.value.every(x => isStr(x, 60)))) e.push('قائمة التصنيفات غير صالحة');
      break;
    }
    default: e.push('نوع بيانات غير معروف');
  }
  return e;
}
export function assertValid(store, rec) {
  const e = validateRecord(store, rec);
  if (e.length) throw new Error(e[0]);
}
