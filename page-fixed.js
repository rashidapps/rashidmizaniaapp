import { h, icon, amt, toast, field, moneyField, openSheet, confirmDialog, emptyState } from './ui.js';
import { parseAmount, toInputValue } from './money.js';
import { sum } from './calc.js';
import { friendlyError } from './db.js';
import { currentMonth, daysInMonth, todayISO, monthLabel } from './dates.js';

export async function render(ctx) {
  const { store, month } = ctx;
  const data = await store.getMonthData(month);
  const items = [...data.fixed].sort((a, b) => a.dueDay - b.dueDay || a.name.localeCompare(b.name, 'ar'));
  const root = h('div', { class: 'page' });
  root.append(h('h1', { class: 'page-title' }, 'المصاريف الثابتة', h('small', null, monthLabel(month))));
  root.append(h('div', { class: 'card total-bar' }, h('div', null, h('div', { class: 'muted', style: 'font-size:13px' }, 'إجمالي الالتزامات الشهرية'), h('div', { class: 'v' }, amt(sum(items)))), h('div', { class: 'muted' }, `${items.length} التزام`)));

  const todayDay = month === currentMonth() ? +todayISO().slice(8) : null;
  if (!items.length) {
    root.append(h('div', { class: 'card' }, emptyState('list', 'لا توجد مصاريف ثابتة', 'أضف التزاماتك المتكررة مثل الإيجار والفواتير والأقساط، وستُخصم تلقائياً من الراتب في الحسابات.',
      h('button', { class: 'btn btn-primary', type: 'button', onClick: () => openForm(ctx) }, icon('plus', 18), 'إضافة مصروف ثابت'))));
  } else {
    root.append(h('div', { class: 'card' }, h('div', { class: 'list' }, items.map(it => {
      const due = Math.min(it.dueDay, daysInMonth(month));
      let tag = null, warn = false;
      if (todayDay !== null) {
        const d = due - todayDay;
        if (d === 0) { tag = 'مستحق اليوم'; warn = true; } else if (d > 0 && d <= 3) { tag = `بعد ${d} ${d === 1 ? 'يوم' : 'أيام'}`; warn = true; } else if (d < 0) tag = 'موعده مضى';
      }
      return h('button', { class: 'row', type: 'button', onClick: () => openForm(ctx, it), 'aria-label': `تعديل ${it.name}` },
        h('div', { class: 'bubble' + (warn ? ' warn' : '') }, String(due)),
        h('div', { class: 'mid' }, h('div', { class: 'nm' }, it.name, tag ? h('span', { class: 'tag' + (warn ? ' soon' : '') }, tag) : null), h('div', { class: 'sm' }, `يوم ${due} من الشهر` + (it.note ? ` · ${it.note}` : ''))),
        h('div', { class: 'end' }, amt(it.amount)));
    }))));
    root.append(h('p', { class: 'hint', style: 'padding:0 4px' }, 'التعديل هنا يخص هذا الشهر، وتنتقل الالتزامات تلقائياً إلى الشهر التالي عند بدايته.'));
  }
  return { el: root, fab: { label: 'إضافة مصروف ثابت', onClick: () => openForm(ctx) } };
}

function openForm(ctx, item) {
  const { store, month, app } = ctx;
  const name = h('input', { id: 'f-name', type: 'text', maxlength: '60', autocomplete: 'off', value: item ? item.name : '', placeholder: 'مثال: إيجار المنزل' });
  const f1 = field('اسم المصروف', name);
  const f2 = moneyField('المبلغ', 'f-amount', item ? toInputValue(item.amount) : '');
  const day = h('select', { id: 'f-day' }, Array.from({ length: 31 }, (_, i) => h('option', { value: String(i + 1), selected: item ? item.dueDay === i + 1 : i + 1 === 1 }, String(i + 1))));
  const f3 = field('يوم الاستحقاق من كل شهر', day);
  const note = h('textarea', { id: 'f-note', maxlength: '300', placeholder: 'اختياري' });
  note.value = item ? item.note || '' : '';
  const f4 = field('ملاحظات (اختياري)', note);
  let busy = false;
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit', form: 'fixed-form' }, 'حفظ');
  const form = h('form', { id: 'fixed-form', novalidate: true, onSubmit: async e => {
    e.preventDefault();
    if (busy) return;
    const n = name.value.trim(), a = parseAmount(f2.input.value);
    f1.setError(n ? '' : 'اكتب اسم المصروف');
    f2.setError(Number.isNaN(a) || a <= 0 ? 'أدخل مبلغاً صحيحاً أكبر من صفر' : '');
    if (!n || Number.isNaN(a) || a <= 0) return;
    busy = true; saveBtn.disabled = true;
    try {
      const patch = { name: n, amount: a, dueDay: +day.value, note: note.value };
      if (item) await store.updateFixed(item.id, patch); else await store.addFixed({ monthId: month, ...patch });
      s.close(); toast('تم حفظ المصروف الثابت'); app.refresh();
    } catch (err) { toast(friendlyError(err), 'err'); busy = false; saveBtn.disabled = false; }
  } }, f1, f2, f3, f4);
  const foot = [saveBtn];
  if (item) foot.push(h('button', { class: 'btn btn-outline-danger', type: 'button', onClick: async () => {
    if (!(await confirmDialog({ title: 'حذف المصروف', message: `هل تريد حذف «${item.name}» من هذا الشهر؟`, confirmText: 'حذف', danger: true }))) return;
    try { await store.deleteFixed(item.id); s.close(); toast('تم الحذف'); app.refresh(); } catch (err) { toast(friendlyError(err), 'err'); }
  } }, icon('trash', 18), 'حذف'));
  const s = openSheet({ title: item ? 'تعديل مصروف ثابت' : 'مصروف ثابت جديد', body: form, footer: foot });
}
