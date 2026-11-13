export const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const pad = n => String(n).padStart(2, '0');

/** تاريخ اليوم بالتوقيت المحلي للجهاز بصيغة YYYY-MM-DD (وليس UTC). */
export const todayISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthOf = iso => iso.slice(0, 7);
export const currentMonth = () => monthOf(todayISO());

export function isValidISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
export const isValidMonth = s => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s) && +s.slice(0, 4) >= 2000 && +s.slice(0, 4) <= 2100;

export function addMonths(id, n) {
  const [y, m] = id.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}
export function daysInMonth(id) {
  const [y, m] = id.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export const monthLabel = (id, short = false) => {
  const [y, m] = id.split('-').map(Number);
  return short ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${y}`;
};
export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
export const formatDayMonth = iso => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
/** التاريخ الافتراضي عند الإضافة: اليوم إن كان داخل الشهر المعروض وإلا آخر يوم فيه. */
export const defaultDateFor = (id, today = todayISO()) => (monthOf(today) === id ? today : `${id}-${pad(daysInMonth(id))}`);
export const daysSince = iso => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
