import { h, icon, amt, toast, moneyField } from './ui.js';
import { parseAmount, toInputValue, formatAmount } from './money.js';
import { monthSummary, emergencyState } from './calc.js';
import { donutSVG } from './charts.js';
import { friendlyError } from './db.js';
import { daysSince } from './dates.js';
import { debounce } from './util.js';
import { getLastBackupAt, installHintHidden, hideInstallHint } from './prefs.js';

const isIOSBrowserTab = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone && !(matchMedia && matchMedia('(display-mode: standalone)').matches);

export async function render(ctx) {
  const { store, month: monthId, app } = ctx;
  const [data, allEm, allVar, settings] = await Promise.all([store.getMonthData(monthId), store.getAllEmergency(), store.getAllVariable(), store.getSettings()]);
  const root = h('div', { class: 'page' });
  root.append(h('h1', { class: 'page-title' }, 'نظرة عامة'));

  /* ----- تنبيهات ----- */
  const hasData = allVar.length > 0 || allEm.length > 0 || data.fixed.length > 0;
  const reviewCount = allVar.filter(v => v.needsReview).length;
  if (isIOSBrowserTab() && !installHintHidden()) {
    const b = h('div', { class: 'banner info' }, icon('info', 20), h('div', { class: 'grow' },
      'لتثبيت التطبيق: زر المشاركة ثم «إضافة إلى الشاشة الرئيسية». انتبه: بيانات Safari منفصلة عن التطبيق المثبّت، فابدأ إدخال بياناتك من التطبيق المثبّت بعد تثبيته.',
      h('div', null, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => { hideInstallHint(); b.remove(); } }, 'فهمت'))));
    root.append(b);
  }
  if (reviewCount > 0) {
    root.append(h('div', { class: 'banner' }, icon('alert', 20), h('div', { class: 'grow' }, `${reviewCount} عملية بنكية بانتظار المراجعة.`,
      h('div', null, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => app.go('variable', { review: true }) }, 'مراجعة الآن')))));
  }
  if (hasData) {
    const last = getLastBackupAt();
    const days = last ? daysSince(last) : null;
    if (days === null || days >= 14) {
      root.append(h('div', { class: 'banner' }, icon('download', 20), h('div', { class: 'grow' },
        days === null ? 'لم تأخذ نسخة احتياطية بعد. بياناتك محفوظة على هذا الجهاز فقط.' : `آخر نسخة احتياطية قبل ${days} يوماً.`,
        h('div', null, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => app.go('settings') }, 'نسخ احتياطي الآن')))));
    }
  }
  if (data.month.salary === 0 && !data.fixed.length && !data.variable.length) {
    root.append(h('div', { class: 'banner info' }, icon('info', 20), h('div', { class: 'grow' }, 'ابدأ بإدخال راتبك الشهري أدناه، ثم أضف مصاريفك الثابتة من تبويب «الثابتة».')));
  }

  /* ----- الراتب (يُحفظ تلقائياً) ----- */
  const salaryField = moneyField('الراتب الشهري', 'salary', data.month.salary ? toInputValue(data.month.salary) : '');
  const input = salaryField.input;
  const state = h('div', { class: 'save-state', 'aria-live': 'polite' });
  let saved = data.month.salary;
  async function saveSalary(fromBlur) {
    const raw = input.value.trim();
    if (raw === '') { if (fromBlur) { input.value = saved ? toInputValue(saved) : ''; } return; }
    const v = parseAmount(raw);
    if (Number.isNaN(v)) { state.className = 'save-state bad'; state.textContent = 'أدخل مبلغاً صحيحاً (مثال: 850 أو 850.500)'; return; }
    if (v === saved) { return; }
    try {
      await store.setSalary(monthId, v);
      saved = v; data.month.salary = v;
      state.className = 'save-state'; state.textContent = '✓ تم حفظ الراتب';
      paint();
    } catch (e) { state.className = 'save-state bad'; state.textContent = friendlyError(e); }
  }
  const deb = debounce(() => saveSalary(false), 700);
  input.addEventListener('input', () => { state.textContent = ''; deb(); });
  input.addEventListener('change', () => { deb.cancel(); saveSalary(true); });
  input.addEventListener('blur', () => { deb.cancel(); saveSalary(true); });
  root.append(h('div', { class: 'card' }, salaryField, state));

  const stats = h('div', { class: 'page', style: 'animation:none' });
  root.append(stats);

  function paint() {
    const s = monthSummary(data);
    const over = s.remaining < 0;
    const pct = s.salary > 0 ? Math.min(100, Math.max(0, s.spentRate * 100)) : 0;
    const free = Math.max(0, s.salary - s.spent - s.deposited);
    const segs = [
      { name: 'مصاريف ثابتة', value: s.fixedTotal, color: 'var(--c-fixed)' },
      { name: 'مصاريف غير ثابتة', value: s.variableTotal, color: 'var(--c-var)' },
      { name: 'ادخار للطوارئ', value: s.deposited, color: 'var(--c-save)' },
      { name: 'متبقٍ حر', value: free, color: 'var(--c-free)' },
    ];
    const es = emergencyState(allEm, settings.emergencyTarget || 0);
    const catMax = s.categories[0]?.total || 1;

    stats.replaceChildren(
      h('section', { class: 'hero' + (over ? ' over' : '') },
        h('div', { class: 'lbl' }, over ? 'تجاوزت راتبك بمقدار' : 'المتبقي من الراتب'),
        h('div', { class: 'big' }, amt(over ? -s.remaining : s.remaining)),
        h('div', { class: 'sub' }, s.salary > 0 ? ['المصروف ', h('span', { class: 'amt' }, Math.round(s.spentRate * 100) + '%'), ' من الراتب'] : 'أدخل الراتب لحساب المتبقي'),
        h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'نسبة المصروف من الراتب' }, h('i', { style: `width:${pct}%` }))),
      h('div', { class: 'grid2' },
        stat('مصاريف ثابتة', amt(s.fixedTotal), 'var(--c-fixed)'),
        stat('مصاريف غير ثابتة', amt(s.variableTotal), 'var(--c-var)'),
        stat('إجمالي المصروف', amt(s.spent)),
        stat('ادخار الطوارئ هذا الشهر', amt(s.deposited), 'var(--c-save)'),
        stat('نسبة الادخار من الراتب', h('span', { class: 'amt' }, (s.savingsRate * 100).toFixed(1).replace(/\.0$/, '') + '%')),
        stat('يمكن تحويله للصندوق', amt(s.transferable)),
      ),
      h('div', { class: 'card' }, h('h3', null, 'توزيع الراتب'),
        h('div', { class: 'donut-wrap' },
          h('div', { html: donutSVG(segs, { centerTop: s.salary > 0 ? Math.round(s.spentRate * 100) + '%' : '—', centerBottom: 'مصروف من الراتب' }) }),
          h('div', { class: 'legend' }, segs.map(g => h('div', null, h('i', { style: `background:${g.color}` }), h('span', { class: 'muted' }, g.name), h('b', null, amt(g.value, { unit: false }))))))),
      s.categories.length ? h('div', { class: 'card' }, h('h3', null, 'أكثر التصنيفات استهلاكاً'),
        s.categories.slice(0, 5).map(c => h('div', { class: 'cat-row' }, h('div', { class: 'top' }, h('span', null, c.name), h('b', null, amt(c.total))), h('div', { class: 'tr' }, h('i', { style: `width:${(c.total / catMax) * 100}%` }))))) : null,
      h('div', { class: 'card' }, h('h3', null, 'صندوق الطوارئ', h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => app.go('emergency') }, 'فتح')),
        settings.emergencyTarget
          ? [h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': Math.round(es.pct), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: `width:${es.pct}%` })),
            h('div', { class: 'kv', style: 'margin-top:10px' }, h('span', { class: 'k' }, `المدخر (${es.pct.toFixed(0)}%)`), h('span', { class: 'v' }, amt(es.balance))),
            h('div', { class: 'kv' }, h('span', { class: 'k' }, 'المتبقي للهدف'), h('span', { class: 'v' }, amt(es.remaining)))]
          : h('p', { class: 'muted' }, 'لم تحدد مبلغاً مستهدفاً بعد. حدّد هدف الصندوق من صفحة الطوارئ.')),
    );
  }
  paint();
  return { el: root };
}

function stat(label, value, color) {
  return h('div', { class: 'stat' }, h('div', { class: 'k' }, color ? h('i', { style: `background:${color}` }) : null, label), h('div', { class: 'v' }, value));
}
export { formatAmount };
