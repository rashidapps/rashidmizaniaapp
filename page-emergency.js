import { h, icon, amt, toast, field, moneyField, openSheet, confirmDialog, emptyState } from './ui.js';
import { parseAmount, toInputValue, formatAmount } from './money.js';
import { monthSummary, emergencyState, suggestMonthly, avgNetSavings } from './calc.js';
import { donutSVG } from './charts.js';
import { friendlyError } from './db.js';
import { defaultDateFor, formatDate, isValidISO, monthLabel, currentMonth, todayISO } from './dates.js';

export async function render(ctx) {
  const { store, month, app } = ctx;
  const [tx, settings, md, months] = await Promise.all([store.getAllEmergency(), store.getSettings(), store.getMonthData(month), store.getAllMonths()]);
  const target = settings.emergencyTarget || 0;
  const horizon = settings.emergencyMonths || 12;
  const es = emergencyState(tx, target);
  const ms = monthSummary(md);
  const root = h('div', { class: 'page' });
  root.append(h('h1', { class: 'page-title' }, 'صندوق الطوارئ'));

  if (!target) {
    root.append(h('div', { class: 'card' }, emptyState('shield', 'حدّد هدف صندوق الطوارئ', 'اكتب المبلغ الذي تريد الوصول إليه، وسيعرض التطبيق نسبة الإنجاز والمبلغ المقترح ادخاره شهرياً.',
      h('button', { class: 'btn btn-primary', type: 'button', onClick: () => openTargetForm(ctx, target, horizon) }, 'تحديد الهدف'))));
  } else {
    const segs = [{ value: es.balance, color: 'var(--c-save)' }, { value: es.remaining, color: 'var(--c-free)' }];
    root.append(h('div', { class: 'card' },
      h('h3', null, 'التقدم نحو الهدف', h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => openTargetForm(ctx, target, horizon) }, icon('edit', 16), 'تعديل الهدف')),
      h('div', { class: 'donut-wrap' }, h('div', { html: donutSVG(segs, { size: 170, thickness: 20, centerTop: es.pct.toFixed(0) + '%', centerBottom: es.reached ? 'تم بلوغ الهدف 🎉' : 'نسبة الإنجاز' }) })),
      h('div', { style: 'margin-top:8px' },
        kv('المبلغ المدخر حالياً', amt(es.balance)),
        kv('المبلغ المستهدف', amt(target)),
        kv('المتبقي للوصول للهدف', amt(es.remaining)))));

    if (!es.reached) {
      const sug = suggestMonthly(es.remaining, horizon);
      const ids = months.map(m => m.id);
      const avg = avgNetSavings(tx, ids, 3);
      const eta = avg > 0 ? Math.ceil(es.remaining / avg) : 0;
      root.append(h('div', { class: 'card' }, h('h3', null, 'الادخار المقترح'),
        kv(`للوصول للهدف خلال ${horizon} شهراً`, h('span', null, amt(sug), h('small', { class: 'muted' }, ' / شهرياً'))),
        month === currentMonth() ? kv('المتاح للتحويل هذا الشهر', amt(ms.transferable)) : null,
        kv(`ما أودعته في ${monthLabel(month, true)}`, amt(ms.deposited)),
        eta ? kv('بمعدل ادخارك الأخير تصل خلال', h('span', { class: 'amt' }, `${eta} ${eta <= 10 ? 'أشهر' : 'شهراً'}`)) : null));
    }
  }

  root.append(h('div', { class: 'grid2' },
    h('button', { class: 'btn btn-primary', type: 'button', onClick: () => openTxForm(ctx, 'deposit', null, tx, ms) }, icon('arrowDown', 18), 'إيداع'),
    h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => openTxForm(ctx, 'withdraw', null, tx, ms) }, icon('arrowUp', 18), 'سحب')));

  const sorted = [...tx].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  root.append(h('div', { class: 'card' }, h('h3', null, 'سجل الإيداع والسحب', h('span', { class: 'muted' }, `${sorted.length} حركة`)),
    sorted.length ? h('div', { class: 'list' }, sorted.map(t => h('button', { class: 'row', type: 'button', onClick: () => openTxForm(ctx, t.type, t, tx, ms), 'aria-label': 'تعديل الحركة' },
      h('div', { class: 'bubble' + (t.type === 'withdraw' ? ' warn' : '') }, icon(t.type === 'deposit' ? 'arrowDown' : 'arrowUp', 20)),
      h('div', { class: 'mid' }, h('div', { class: 'nm' }, t.type === 'deposit' ? 'إيداع' : 'سحب', t.reason ? ` · ${t.reason}` : ''), h('div', { class: 'sm' }, formatDate(t.date))),
      h('div', { class: 'end ' + (t.type === 'deposit' ? 'pos' : 'neg') }, amt(t.type === 'deposit' ? t.amount : -t.amount, { sign: t.type === 'deposit' }))))) : emptyState('shield', 'لا توجد حركات بعد', 'أضف أول إيداع لصندوق الطوارئ.')));
  return { el: root };
}
const kv = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));

function openTargetForm(ctx, target, horizon) {
  const { store, app } = ctx;
  const f1 = moneyField('المبلغ المستهدف للصندوق', 't-target', target ? toInputValue(target) : '');
  const months = h('input', { id: 't-months', type: 'text', inputmode: 'numeric', value: String(horizon), autocomplete: 'off' });
  const f2 = field('المدة المرغوبة للوصول للهدف (بالأشهر)', months, { hint: 'يُستخدم لحساب المبلغ الشهري المقترح.' });
  let busy = false;
  const btn = h('button', { class: 'btn btn-primary', type: 'submit', form: 't-form' }, 'حفظ الهدف');
  const form = h('form', { id: 't-form', novalidate: true, onSubmit: async e => {
    e.preventDefault();
    if (busy) return;
    const a = parseAmount(f1.input.value);
    const n = parseInt(months.value.replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x0660), 10);
    f1.setError(Number.isNaN(a) || a <= 0 ? 'أدخل مبلغاً صحيحاً أكبر من صفر' : '');
    f2.setError(Number.isInteger(n) && n >= 1 && n <= 240 ? '' : 'أدخل عدد أشهر بين 1 و240');
    if (Number.isNaN(a) || a <= 0 || !(n >= 1 && n <= 240)) return;
    busy = true; btn.disabled = true;
    try { await store.setSetting('emergencyTarget', a); await store.setSetting('emergencyMonths', n); s.close(); toast('تم حفظ الهدف'); app.refresh(); }
    catch (err) { toast(friendlyError(err), 'err'); busy = false; btn.disabled = false; }
  } }, f1, f2);
  const s = openSheet({ title: 'هدف صندوق الطوارئ', body: form, footer: [btn] });
}

function openTxForm(ctx, type, item, allTx, ms) {
  const { store, month, app } = ctx;
  const isDep = type === 'deposit';
  const balance = allTx.reduce((a, t) => a + (t.type === 'deposit' ? t.amount : -t.amount), 0);
  const f1 = moneyField('المبلغ', 'e-amount', item ? toInputValue(item.amount) : '');
  const date = h('input', { id: 'e-date', type: 'date', value: item ? item.date : todayISO(), min: '2000-01-01', max: '2100-12-31' });
  const f2 = field('التاريخ', date);
  const reason = h('input', { id: 'e-reason', type: 'text', maxlength: '120', autocomplete: 'off', value: item ? item.reason : '', placeholder: isDep ? 'اختياري (مثال: ادخار الشهر)' : 'مثال: إصلاح السيارة' });
  const f3 = field(isDep ? 'ملاحظة (اختياري)' : 'سبب السحب (مطلوب)', reason);
  const extra = [];
  if (isDep && !item && ms.transferable > 0) extra.push(h('button', { class: 'chip', type: 'button', style: 'margin-bottom:12px', onClick: () => { f1.input.value = toInputValue(ms.transferable); } }, `إيداع المتاح للتحويل (${formatAmount(ms.transferable)})`));
  if (!isDep) extra.push(h('p', { class: 'hint', style: 'margin:-6px 0 12px' }, `الرصيد الحالي: ${formatAmount(balance)} ر.ع.`));
  let busy = false;
  const btn = h('button', { class: 'btn btn-primary', type: 'submit', form: 'e-form' }, 'حفظ');
  const form = h('form', { id: 'e-form', novalidate: true, onSubmit: async e => {
    e.preventDefault();
    if (busy) return;
    const a = parseAmount(f1.input.value), r = reason.value.trim();
    let bad = false;
    f1.setError(Number.isNaN(a) || a <= 0 ? 'أدخل مبلغاً صحيحاً أكبر من صفر' : ''); if (Number.isNaN(a) || a <= 0) bad = true;
    f2.setError(isValidISO(date.value) ? '' : 'اختر تاريخاً صحيحاً'); if (!isValidISO(date.value)) bad = true;
    f3.setError(!isDep && !r ? 'اكتب سبب السحب' : ''); if (!isDep && !r) bad = true;
    if (bad) return;
    // لا يجوز أن يصبح رصيد الصندوق سالباً
    const delta = (isDep ? a : -a) - (item ? (isDep ? item.amount : -item.amount) : 0);
    if (balance + delta < 0) { f1.setError(isDep ? 'التعديل يجعل رصيد الصندوق سالباً' : `المبلغ أكبر من رصيد الصندوق (${formatAmount(balance + (item ? item.amount : 0))})`); return; }
    busy = true; btn.disabled = true;
    try {
      if (item) await store.updateEmergency(item.id, { amount: a, date: date.value, reason: r });
      else await store.addEmergency({ type, amount: a, date: date.value, reason: r });
      s.close(); toast(isDep ? 'تم الإيداع في الصندوق' : 'تم السحب من الصندوق'); app.refresh();
    } catch (err) { toast(friendlyError(err), 'err'); busy = false; btn.disabled = false; }
  } }, ...extra, f1, f2, f3);
  const foot = [btn];
  if (item) foot.push(h('button', { class: 'btn btn-outline-danger', type: 'button', onClick: async () => {
    const after = balance - (isDep ? item.amount : -item.amount);
    if (after < 0) { toast('لا يمكن حذف هذه الحركة: سيصبح رصيد الصندوق سالباً', 'err'); return; }
    if (!(await confirmDialog({ title: 'حذف الحركة', message: 'هل تريد حذف هذه الحركة من السجل؟', confirmText: 'حذف', danger: true }))) return;
    try { await store.deleteEmergency(item.id); s.close(); toast('تم الحذف'); app.refresh(); } catch (err) { toast(friendlyError(err), 'err'); }
  } }, icon('trash', 18), 'حذف'));
  const s = openSheet({ title: item ? 'تعديل حركة' : isDep ? 'إيداع في الصندوق' : 'سحب من الصندوق', body: form, footer: foot });
}
