import { h, amt, emptyState } from './ui.js';
import { formatAmount } from './money.js';
import { buildSummaries, emergencyTimeline, trailingMonths, yearSummary, sum } from './calc.js';
import { stackedBarsSVG, lineSVG } from './charts.js';
import { monthLabel, formatDate, addMonths, daysInMonth, pad } from './dates.js';
import { UNCATEGORIZED } from './config.js';

const st = { tab: 'month', month: null, year: null };

export async function render(ctx) {
  const { store, month, app } = ctx;
  const all = await store.loadEverything();
  const settings = await store.getSettings();
  const sums = buildSummaries(all);
  const ids = Object.keys(sums).sort();
  const root = h('div', { class: 'page' });
  root.append(h('h1', { class: 'page-title' }, 'التقارير والتحليل'));
  if (!ids.length) { root.append(h('div', { class: 'card' }, emptyState('chart', 'لا توجد بيانات بعد', 'ستظهر التقارير بعد تسجيل راتبك ومصاريفك.'))); return { el: root }; }
  if (!st.month || !ids.includes(st.month)) st.month = ids.includes(month) ? month : ids[ids.length - 1];
  const years = [...new Set(ids.map(i => i.slice(0, 4)))].sort();
  if (!st.year || !years.includes(st.year)) st.year = years[years.length - 1];

  const seg = h('div', { class: 'segmented', role: 'tablist' },
    ...[['month', 'شهري'], ['year', 'سنوي']].map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(st.tab === k), class: st.tab === k ? 'on' : '', onClick: () => { st.tab = k; app.refresh(); } }, l)));
  root.append(seg);

  const tl = emergencyTimeline;
  if (st.tab === 'month') {
    const sel = h('select', { 'aria-label': 'اختيار الشهر', onChange: e => { st.month = e.target.value; app.refresh(); } },
      [...ids].reverse().map(i => h('option', { value: i, selected: i === st.month }, monthLabel(i))));
    root.append(h('div', { class: 'field', style: 'margin:0' }, sel));
    const s = sums[st.month];
    root.append(h('div', { class: 'card' }, h('h3', null, `ملخص ${monthLabel(st.month)}`),
      kv('الراتب', amt(s.salary)), kv('المصاريف الثابتة', amt(s.fixedTotal)), kv('المصاريف غير الثابتة', amt(s.variableTotal)),
      kv('إجمالي المصروفات', amt(s.spent)), kv('إجمالي المدخرات (إيداع الطوارئ)', amt(s.deposited)),
      s.withdrawn ? kv('المسحوب من الصندوق', amt(s.withdrawn)) : null,
      kv('المتبقي من الراتب', amt(s.remaining, { cls: s.remaining < 0 ? 'neg' : '' })),
      kv('نسبة الادخار', h('span', { class: 'amt' }, (s.savingsRate * 100).toFixed(1).replace(/\.0$/, '') + '%'))));
    root.append(catCard('أكثر التصنيفات استهلاكاً', s.categories));
    // مقارنة مع الأشهر السابقة
    const trail = trailingMonths(st.month, 6, ids[0]);
    const prevId = addMonths(st.month, -1);
    const prev = sums[prevId];
    let cmp = null;
    if (prev && prev.spent > 0) {
      const d = ((s.spent - prev.spent) / prev.spent) * 100;
      cmp = h('p', { class: 'hint', style: 'margin-top:8px' }, `مصروفات الشهر ${d >= 0 ? 'أعلى' : 'أقل'} بنسبة ${Math.abs(d).toFixed(0)}% من ${monthLabel(prevId, true)}.`);
    }
    root.append(h('div', { class: 'card' }, h('h3', null, 'مقارنة مع الأشهر السابقة'),
      h('div', { html: stackedBarsSVG(trail.map(id => ({ label: monthLabel(id, true), parts: [{ value: sums[id]?.fixedTotal || 0, color: 'var(--c-fixed)' }, { value: sums[id]?.variableTotal || 0, color: 'var(--c-var)' }] })), { highlight: trail.indexOf(st.month) }) }),
      legend([['ثابتة', 'var(--c-fixed)'], ['غير ثابتة', 'var(--c-var)']]), cmp));
    const t12 = trailingMonths(st.month, 12, ids[0]);
    root.append(h('div', { class: 'card' }, h('h3', null, 'تطور صندوق الطوارئ'),
      h('div', { html: lineSVG(tl(all.emergency, t12).map(p => ({ label: p.monthId.slice(5) + '/' + p.monthId.slice(2, 4), value: p.balance })), { target: settings.emergencyTarget || 0 }) })));
    // تفاصيل الشهر
    const fx = all.fixed.filter(f => f.monthId === st.month).sort((a, b) => a.dueDay - b.dueDay);
    const vr = all.variable.filter(v => v.monthId === st.month).sort((a, b) => a.date.localeCompare(b.date));
    const em = all.emergency.filter(t => t.monthId === st.month).sort((a, b) => a.date.localeCompare(b.date));
    root.append(details(`المصاريف الثابتة (${fx.length})`, fx.map(f => line(f.name, `يوم ${Math.min(f.dueDay, daysInMonth(st.month))}`, f.amount))));
    root.append(details(`المصاريف غير الثابتة (${vr.length})`, vr.map(v => line(v.name, `${formatDate(v.date)} · ${(v.category || '').trim() || UNCATEGORIZED}`, v.amount))));
    root.append(details(`حركات صندوق الطوارئ (${em.length})`, em.map(t => line((t.type === 'deposit' ? 'إيداع' : 'سحب') + (t.reason ? ` · ${t.reason}` : ''), formatDate(t.date), t.type === 'deposit' ? t.amount : -t.amount))));
  } else {
    const sel = h('select', { 'aria-label': 'اختيار السنة', onChange: e => { st.year = e.target.value; app.refresh(); } }, [...years].reverse().map(y => h('option', { value: y, selected: y === st.year }, y)));
    root.append(h('div', { class: 'field', style: 'margin:0' }, sel));
    const y = yearSummary(st.year, sums);
    root.append(h('div', { class: 'card' }, h('h3', null, `ملخص سنة ${st.year}`),
      kv('إجمالي الرواتب', amt(y.salary)), kv('المصاريف الثابتة', amt(y.fixedTotal)), kv('المصاريف غير الثابتة', amt(y.variableTotal)),
      kv('إجمالي المصروفات', amt(y.spent)), kv('إجمالي المدخرات', amt(y.deposited)), y.withdrawn ? kv('إجمالي المسحوب من الصندوق', amt(y.withdrawn)) : null,
      kv('متوسط المصروف الشهري', amt(y.rows.length ? Math.round(y.spent / y.rows.length) : 0))));
    root.append(h('div', { class: 'card' }, h('h3', null, 'الأشهر'),
      h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['الشهر', 'الراتب', 'المصروف', 'الادخار', 'المتبقي'].map(t => h('th', null, t)))),
        h('tbody', null, y.rows.map(r => h('tr', null, h('td', null, monthLabel(r.id, true)), h('td', null, num(r.salary)), h('td', null, num(r.spent)), h('td', null, num(r.deposited)), h('td', { class: r.remaining < 0 ? 'neg' : '' }, num(r.remaining))))),
        h('tfoot', null, h('tr', null, h('td', null, 'المجموع'), h('td', null, num(y.salary)), h('td', null, num(y.spent)), h('td', null, num(y.deposited)), h('td', null, num(y.salary - y.spent))))))));
    root.append(h('div', { class: 'card' }, h('h3', null, 'المصاريف شهرياً'),
      h('div', { html: stackedBarsSVG(y.rows.map(r => ({ label: String(+r.id.slice(5)), parts: [{ value: r.fixedTotal, color: 'var(--c-fixed)' }, { value: r.variableTotal, color: 'var(--c-var)' }] }))) }),
      legend([['ثابتة', 'var(--c-fixed)'], ['غير ثابتة', 'var(--c-var)']])));
    root.append(catCard('أكثر التصنيفات استهلاكاً خلال السنة', y.categories));
    root.append(h('div', { class: 'card' }, h('h3', null, 'تطور صندوق الطوارئ خلال السنة'),
      h('div', { html: lineSVG(tl(all.emergency, y.rows.map(r => r.id)).map(p => ({ label: String(+p.monthId.slice(5)), value: p.balance })), { target: settings.emergencyTarget || 0 }) })));
  }
  return { el: root };
}

const num = b => h('span', { class: 'amt' }, formatAmount(b));
const kv = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
const legend = items => h('div', { class: 'legend', style: 'margin-top:8px' }, items.map(([n, c]) => h('div', null, h('i', { style: `background:${c}` }), h('span', { class: 'muted' }, n))));
function catCard(title, cats) {
  const max = cats[0]?.total || 1;
  return h('div', { class: 'card' }, h('h3', null, title),
    cats.length ? cats.slice(0, 8).map(c => h('div', { class: 'cat-row' }, h('div', { class: 'top' }, h('span', null, c.name), h('b', null, amt(c.total))), h('div', { class: 'tr' }, h('i', { style: `width:${(c.total / max) * 100}%` })))) : h('p', { class: 'muted' }, 'لا توجد مصاريف غير ثابتة.'));
}
function line(name, sub, v) { return h('div', { class: 'row', style: 'cursor:default' }, h('div', { class: 'mid' }, h('div', { class: 'nm' }, name), h('div', { class: 'sm' }, sub)), h('div', { class: 'end' }, amt(v, { sign: v > 0 && false }))); }
function details(title, rows) {
  return h('details', { class: 'card' }, h('summary', null, title), rows.length ? h('div', { class: 'list' }, rows) : h('p', { class: 'muted' }, 'لا توجد عناصر.'));
}
export { sum, pad };
