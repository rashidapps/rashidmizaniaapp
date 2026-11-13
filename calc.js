// حسابات مالية نقية (بدون واجهة) — قابلة للاختبار مباشرة. كل المبالغ بالبيسة.
import { UNCATEGORIZED } from './config.js';
import { addMonths } from './dates.js';

export const sum = (arr, f = x => x.amount) => arr.reduce((a, x) => a + f(x), 0);

export function categoryTotals(variable) {
  const map = new Map();
  for (const v of variable) {
    const c = (v.category || '').trim() || UNCATEGORIZED;
    const e = map.get(c) || { name: c, total: 0, count: 0 };
    e.total += v.amount; e.count++;
    map.set(c, e);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/** ملخص شهر واحد. remaining = الراتب − كل المصاريف (قبل الادخار). */
export function monthSummary({ month, fixed, variable, emergency }) {
  const salary = month ? month.salary : 0;
  const fixedTotal = sum(fixed);
  const variableTotal = sum(variable);
  const spent = fixedTotal + variableTotal;
  const deposited = sum(emergency.filter(t => t.type === 'deposit'));
  const withdrawn = sum(emergency.filter(t => t.type === 'withdraw'));
  const remaining = salary - spent;
  return {
    salary, fixedTotal, variableTotal, spent, remaining,
    deposited, withdrawn,
    transferable: Math.max(0, remaining - deposited),   // ما يمكن تحويله بعد خصم ما أودعته فعلاً هذا الشهر
    freeAfterSavings: remaining - deposited,
    savingsRate: salary > 0 ? deposited / salary : 0,
    spentRate: salary > 0 ? spent / salary : 0,
    categories: categoryTotals(variable),
  };
}

export function groupByMonth(rows) {
  const g = {};
  for (const r of rows) (g[r.monthId] ||= []).push(r);
  return g;
}
export function buildSummaries({ months, fixed, variable, emergency }) {
  const gf = groupByMonth(fixed), gv = groupByMonth(variable), ge = groupByMonth(emergency);
  const out = {};
  for (const m of months) out[m.id] = monthSummary({ month: m, fixed: gf[m.id] || [], variable: gv[m.id] || [], emergency: ge[m.id] || [] });
  return out;
}

export function emergencyBalance(tx) {
  return sum(tx, t => (t.type === 'deposit' ? t.amount : -t.amount));
}
export function emergencyState(tx, target) {
  const balance = emergencyBalance(tx);
  const remaining = Math.max(0, target - balance);
  const pct = target > 0 ? Math.max(0, Math.min(100, (balance / target) * 100)) : 0;
  return { balance, remaining, pct, reached: target > 0 && balance >= target };
}
/** رصيد الصندوق في نهاية كل شهر من القائمة. */
export function emergencyTimeline(tx, monthIds) {
  const sorted = [...tx].sort((a, b) => a.date.localeCompare(b.date));
  return monthIds.map(id => {
    const end = id + '-31';
    return { monthId: id, balance: emergencyBalance(sorted.filter(t => t.date <= end)) };
  });
}
/** المبلغ المقترح شهرياً للوصول للهدف خلال n شهراً (تقريب للأعلى لأقرب 0.100 ر.ع.). */
export function suggestMonthly(remaining, months) {
  if (!(months > 0) || remaining <= 0) return 0;
  return Math.ceil(remaining / months / 100) * 100;
}
/** متوسط صافي الادخار في آخر n أشهر لها حركات. */
export function avgNetSavings(tx, monthIds, n = 3) {
  const net = monthIds.map(id => sum(tx.filter(t => t.monthId === id), t => (t.type === 'deposit' ? t.amount : -t.amount))).filter((_, i) => tx.some(t => t.monthId === monthIds[i]));
  const last = net.slice(-n);
  return last.length ? Math.round(sum(last, x => x) / last.length) : 0;
}

/** آخر n شهراً تنتهي بالشهر المحدد، مقتصرة على ما بعد أول شهر مسجّل. */
export function trailingMonths(selected, n, earliest) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const id = addMonths(selected, -i);
    if (!earliest || id >= earliest) out.push(id);
  }
  return out;
}

export function yearSummary(year, summaries) {
  const ids = Object.keys(summaries).filter(id => id.startsWith(year + '-')).sort();
  const rows = ids.map(id => ({ id, ...summaries[id] }));
  const catMap = new Map();
  rows.forEach(r => r.categories.forEach(c => catMap.set(c.name, (catMap.get(c.name) || 0) + c.total)));
  return {
    rows,
    salary: sum(rows, r => r.salary),
    fixedTotal: sum(rows, r => r.fixedTotal),
    variableTotal: sum(rows, r => r.variableTotal),
    spent: sum(rows, r => r.spent),
    deposited: sum(rows, r => r.deposited),
    withdrawn: sum(rows, r => r.withdrawn),
    categories: [...catMap].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
  };
}
