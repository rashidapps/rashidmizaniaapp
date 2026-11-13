// تحليل نصوص الرسائل البنكية (تلصقها أنت أو تستوردها من ملف). التطبيق لا يقرأ رسائل الجوال تلقائياً.
// الأنماط عامة وتقريبية — تُراجَع العمليات دائماً قبل الإضافة، وتُوسم "تحتاج مراجعة" بعد إضافتها.
import { BANK_PLACEHOLDER_NAME } from './config.js';
import { normalizeDigits, parseAmount } from './money.js';
import { isValidISO, todayISO, pad } from './dates.js';
import { cyrb53 } from './util.js';

const CUR = '(?:OMR|R\\.?\\s?O\\.?|RO|ر\\.?\\s?ع\\.?|ريال(?:\\s+عماني)?)';
const NUM = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
const AMOUNT_RES = [
  new RegExp(`${CUR}\\s*[:\\-]?\\s*${NUM}`, 'gi'),
  new RegExp(`${NUM}\\s*${CUR}`, 'gi'),
];
const BALANCE_RE = /(balance|bal\b|avl|avail|الرصيد|رصيد|المتاح|المتوفر)/i;

const DEBIT = [/خصم/, /مدين/, /شراء/, /سحب/, /مشتريات/, /تم دفع/, /دفعة/, /debit/i, /purchase/i, /\bpos\b/i, /withdraw/i, /\bpaid\b/i, /\bspent\b/i, /payment/i, /\bat\b/i];
const CREDIT = [/إيداع/, /ايداع/, /دائن/, /تحويل وارد/, /استلام/, /راتب/, /استرداد/, /إرجاع/, /credited/i, /\bdeposit/i, /received/i, /salary/i, /refund/i, /reversal/i];

const EN_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function splitMessages(text) {
  return String(text || '').replace(/\r/g, '').split(/\n\s*\n|^\s*-{3,}\s*$/m).map(s => s.trim()).filter(Boolean);
}
export function normalizeForHash(msg) {
  return normalizeDigits(msg).toLowerCase().replace(/\s+/g, ' ').trim();
}
export const messageRef = msg => 'sms:' + cyrb53(normalizeForHash(msg)).toString(36);

function earliest(res, text) {
  let best = Infinity;
  for (const r of res) { const m = r.exec(text); if (m && m.index < best) best = m.index; }
  return best;
}
export function detectKind(text) {
  const d = earliest(DEBIT.slice(0, -1), text) , c = earliest(CREDIT, text);
  const hasAt = /\bat\b/i.test(text);
  if (d === Infinity && c === Infinity) return hasAt ? 'debit' : 'unknown';
  return d <= c ? 'debit' : 'credit';
}

export function extractAmount(text) {
  const cands = [];
  for (const re of AMOUNT_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 28), m.index);
      if (BALANCE_RE.test(before)) continue;
      cands.push({ idx: m.index, raw: m[1] });
    }
  }
  cands.sort((a, b) => a.idx - b.idx);
  for (const c of cands) { const v = parseAmount(c.raw); if (!Number.isNaN(v) && v > 0) return v; }
  return NaN;
}

export function extractDate(text, today = todayISO()) {
  let m;
  if ((m = /(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/.exec(text))) {
    const iso = `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`; if (isValidISO(iso)) return iso;
  }
  if ((m = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})(?!\d)/.exec(text))) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const iso = `${y}-${pad(+m[2])}-${pad(+m[1])}`; if (isValidISO(iso)) return iso;   // يوم/شهر/سنة
  }
  if ((m = /(\d{1,2})[\-\s]([A-Za-z]{3,9})[\-\s,]*(\d{4}|\d{2})(?!\d)/.exec(text))) {
    const mo = EN_MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; const iso = `${y}-${pad(mo)}-${pad(+m[1])}`; if (isValidISO(iso)) return iso; }
  }
  return today;
}

const STOP_EN = '(?:\\s+(?:on|date|dated|using|via|from|ref|avail|available|bal|balance|card|with|for|at|amount)\\b|\\s+\\d{1,2}[\\/\\-.]\\w|[.,;\\n]|$)';
const STOP_AR = '(?:\\s+(?:بتاريخ|في تاريخ|بواسطة|باستخدام|الرصيد|رصيد|بطاقة|بمبلغ|مبلغ)|\\s+\\d|[.,;\\n]|$)';
export function extractMerchant(text) {
  const t = normalizeDigits(text);
  const tries = [
    new RegExp(`(?:merchant|at|to)\\s*:?\\s+([A-Za-z0-9][A-Za-z0-9&'*./\\- ]{1,40}?)(?=${STOP_EN})`, 'i'),
    new RegExp(`(?:لدى|عند|للتاجر|التاجر|إلى|الى|في)\\s*:?\\s+([^\\n.,;]{2,40}?)(?=${STOP_AR})`),
  ];
  for (const re of tries) {
    const m = re.exec(t);
    if (m) {
      const name = m[1].replace(/\s+/g, ' ').replace(/[*\-]+$/, '').trim();
      if (name.length >= 2 && !/^\d+$/.test(name) && !new RegExp(`^${CUR}`, 'i').test(name) && !/^(your|account|a\/c|card)/i.test(name)) return name;
    }
  }
  return '';
}

export function parseMessage(raw, { today = todayISO() } = {}) {
  const text = raw.trim();
  const ref = messageRef(text);
  const amount = extractAmount(normalizeDigits(text));
  if (Number.isNaN(amount)) return { ok: false, raw: text, ref, reason: 'لم يُعثر على مبلغ' };
  const kind = detectKind(text);
  const merchant = extractMerchant(text);
  const date = extractDate(normalizeDigits(text), today);
  if (kind === 'credit') return { ok: false, credit: true, raw: text, ref, amount, date, reason: 'عملية إيداع/وارد — لا تُسجَّل كمصروف' };
  return { ok: true, raw: text, ref, kind, amount, date, merchant, name: merchant || BANK_PLACEHOLDER_NAME, uncertain: kind === 'unknown' };
}
export const parseMessages = (text, opts) => splitMessages(text).map(m => parseMessage(m, opts));
