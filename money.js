// كل المبالغ تُخزَّن كأعداد صحيحة بوحدة "بيسة" (1 ريال عماني = 1000 بيسة) لتفادي أخطاء الفاصلة العائمة.
import { CURRENCY_LABEL } from './config.js';

export function normalizeDigits(s) {
  return String(s)
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/٫/g, '.')   // الفاصلة العشرية العربية
    .replace(/٬/g, '')    // فاصل الآلاف العربي
    .replace(/،/g, ',');  // الفاصلة العربية
}

/** يحوّل نص المبلغ إلى بيسة (عدد صحيح) أو NaN إذا كان غير صالح. */
export function parseAmount(input) {
  if (input == null) return NaN;
  let s = normalizeDigits(String(input)).replace(/\s+/g, '');
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) {
    if (s.includes('.')) s = s.replace(/,/g, '');
    else if (/^[1-9]\d{0,2}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');   // 1,500 => 1500
    else if ((s.match(/,/g) || []).length === 1) s = s.replace(',', '.');   // 1,5 => 1.5
    else return NaN;
  }
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return NaN;
  const [w, f = ''] = s.split('.');
  let b = parseInt(w || '0', 10) * 1000 + parseInt(f.padEnd(3, '0').slice(0, 3), 10);
  if (f.length > 3 && parseInt(f[3], 10) >= 5) b += 1;
  if (!Number.isSafeInteger(b) || b > 1e12) return NaN;
  return b;
}

export function formatAmount(b, { sign = false } = {}) {
  const neg = b < 0, a = Math.abs(Math.round(b));
  const w = Math.floor(a / 1000), f = String(a % 1000).padStart(3, '0');
  const ws = String(w).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : sign ? '+' : '') + ws + '.' + f;
}
export const formatOMR = (b, o) => `${formatAmount(b, o)} ${CURRENCY_LABEL}`;

/** قيمة مناسبة لحقل الإدخال (بدون أصفار زائدة). */
export function toInputValue(b) {
  return formatAmount(b).replace(/,/g, '').replace(/\.?0+$/, '');
}
/** تقريب للأعلى إلى أقرب 0.100 ر.ع. */
export const roundUp100 = b => Math.ceil(b / 100) * 100;
