import { h, icon, amt, toast, field, moneyField, openSheet, confirmDialog, emptyState } from './ui.js';
import { parseAmount, toInputValue } from './money.js';
import { sum } from './calc.js';
import { friendlyError } from './db.js';
import { defaultDateFor, formatDate, formatDayMonth, monthLabel, monthOf, isValidISO } from './dates.js';
import { UNCATEGORIZED } from './config.js';
import { openBankImport } from './page-bank-import.js';

const view = { q: '', cat: null, review: false, limit: 100 };

export async function render(ctx) {
  const { store, month, app } = ctx;
  if (app.params && 'review' in app.params) { view.review = !!app.params.review; view.q = ''; view.cat = null; app.params = null; }
  const data = await store.getMonthData(month);
  const categories = await store.categories();
  let all = null;
  const reviewAll = (await store.getAllVariable()).filter(v => v.needsReview);
  const root = h('div', { class: 'page' });
  root.append(h('h1', { class: 'page-title' }, 'غير الثابتة', h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => openBankImport(ctx) }, icon('bank', 18), 'استيراد بنكي')));
  root.append(h('div', { class: 'card total-bar' }, h('div', null, h('div', { class: 'muted', style: 'font-size:13px' }, `إجمالي ${monthLabel(month)}`), h('div', { class: 'v' }, amt(sum(data.variable)))), h('div', { class: 'muted' }, `${data.variable.length} عملية`)));

  const search = h('input', { type: 'search', placeholder: 'ابحث في كل المصاريف (الاسم، التصنيف، الملاحظة)', value: view.q, 'aria-label': 'بحث', enterkeyhint: 'search' });
  root.append(h('div', { class: 'search' }, search, icon('search', 20)));
  const chipsBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'تصفية حسب التصنيف' });
  root.append(chipsBox);
  const listBox = h('div');
  root.append(listBox);

  const monthCats = [...new Set(data.variable.map(v => (v.category || '').trim() || UNCATEGORIZED))];
  function paintChips() {
    const mk = (label, on, fn) => h('button', { class: 'chip' + (on ? ' on' : ''), type: 'button', 'aria-pressed': String(on), onClick: fn }, label);
    chipsBox.replaceChildren(
      mk('الكل', !view.cat && !view.review, () => { view.cat = null; view.review = false; paintChips(); paintList(); }),
      reviewAll.length ? mk(`تحتاج مراجعة (${reviewAll.length})`, view.review, () => { view.review = !view.review; view.cat = null; paintChips(); paintList(); }) : null,
      monthCats.map(c => mk(c, view.cat === c, () => { view.cat = view.cat === c ? null : c; view.review = false; paintChips(); paintList(); })));
  }

  async function paintList() {
    const q = view.q.trim().toLowerCase();
    const wide = !!q || view.review;
    let rows;
    if (wide) { all = all || (await store.getAllVariable()); rows = all; } else rows = data.variable;
    rows = rows.filter(v => {
      const c = (v.category || '').trim() || UNCATEGORIZED;
      if (view.review && !v.needsReview) return false;
      if (view.cat && c !== view.cat) return false;
      if (q && !`${v.name} ${c} ${v.note || ''}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
    listBox.replaceChildren();
    if (!rows.length) {
      listBox.append(h('div', { class: 'card' }, wide
        ? emptyState('search', view.review ? 'لا توجد عمليات للمراجعة' : 'لا نتائج', view.review ? null : 'جرّب كلمة أخرى؛ البحث يشمل كل الأشهر.')
        : emptyState('receipt', 'لا توجد مصاريف في هذا الشهر', 'سجّل أول مصروف لك بالضغط على زر +، أو استورد عملية من رسالة البنك.', h('button', { class: 'btn btn-primary', type: 'button', onClick: () => openForm(ctx, null, categories) }, icon('plus', 18), 'إضافة مصروف'))));
      return;
    }
    if (wide) listBox.append(h('p', { class: 'hint', style: 'padding:2px 4px 6px' }, `${rows.length} نتيجة من كل الأشهر · الإجمالي `, amt(sum(rows))));
    const shown = rows.slice(0, view.limit);
    const groups = new Map();
    shown.forEach(v => { (groups.get(v.date) || groups.set(v.date, []).get(v.date)).push(v); });
    const card = h('div', { class: 'card' });
    for (const [date, list] of groups) {
      card.append(h('div', { class: 'day-head' }, h('span', null, wide ? formatDate(date) : formatDayMonth(date)), h('span', null, amt(sum(list)))));
      card.append(h('div', { class: 'list' }, list.map(v => h('button', { class: 'row', type: 'button', onClick: () => openForm(ctx, v, categories), 'aria-label': `${v.name} ${v.amount}` },
        h('div', { class: 'bubble' + (v.needsReview ? ' warn' : '') }, icon(v.source === 'bank' ? 'bank' : 'receipt', 20)),
        h('div', { class: 'mid' }, h('div', { class: 'nm' }, v.name, v.needsReview ? h('span', { class: 'tag review' }, 'مراجعة') : null), h('div', { class: 'sm' }, ((v.category || '').trim() || UNCATEGORIZED) + (v.note ? ` · ${v.note}` : ''))),
        h('div', { class: 'end' }, amt(v.amount))))));
    }
    listBox.append(card);
    if (rows.length > shown.length) listBox.append(h('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:10px', type: 'button', onClick: () => { view.limit += 100; paintList(); } }, `عرض المزيد (${rows.length - shown.length})`));
  }
  search.addEventListener('input', () => { view.q = search.value; view.limit = 100; paintList(); });
  paintChips();
  await paintList();
  return { el: root, fab: { label: 'إضافة مصروف', onClick: () => openForm(ctx, null, categories) } };
}

function openForm(ctx, item, categories) {
  const { store, month, app } = ctx;
  const name = h('input', { id: 'v-name', type: 'text', maxlength: '100', autocomplete: 'off', value: item ? item.name : '', placeholder: 'مثال: غداء' });
  const f1 = field('اسم المصروف', name);
  const f2 = moneyField('المبلغ', 'v-amount', item ? toInputValue(item.amount) : '');
  const date = h('input', { id: 'v-date', type: 'date', value: item ? item.date : defaultDateFor(month), min: '2000-01-01', max: '2100-12-31' });
  const f3 = field('التاريخ', date);
  const cat = h('input', { id: 'v-cat', type: 'text', maxlength: '60', autocomplete: 'off', value: item ? item.category || '' : '', placeholder: 'اختر أو اكتب تصنيفاً (اختياري)' });
  const chips = h('div', { class: 'cat-chips' }, categories.map(c => h('button', { class: 'chip', type: 'button', onClick: () => { cat.value = c; } }, c)));
  const f4 = field('التصنيف', cat);
  f4.insertBefore(chips, f4.querySelector('.field-err'));
  const note = h('textarea', { id: 'v-note', maxlength: '300', placeholder: 'اختياري' });
  note.value = item ? item.note || '' : '';
  const f5 = field('ملاحظات (اختياري)', note);
  let busy = false;
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit', form: 'var-form' }, item && item.needsReview ? 'تأكيد وحفظ' : 'حفظ');
  const form = h('form', { id: 'var-form', novalidate: true, onSubmit: async e => {
    e.preventDefault();
    if (busy) return;
    const n = name.value.trim(), a = parseAmount(f2.input.value);
    const okDate = isValidISO(date.value);
    f1.setError(n ? '' : 'اكتب اسم المصروف');
    f2.setError(Number.isNaN(a) || a <= 0 ? 'أدخل مبلغاً صحيحاً أكبر من صفر' : '');
    f3.setError(okDate ? '' : 'اختر تاريخاً صحيحاً');
    if (!n || Number.isNaN(a) || a <= 0 || !okDate) return;
    busy = true; saveBtn.disabled = true;
    try {
      const patch = { name: n, amount: a, date: date.value, category: cat.value, note: note.value };
      if (item) await store.updateVariable(item.id, { ...patch, needsReview: false }); else await store.addVariable(patch);
      s.close();
      toast(monthOf(date.value) !== month ? `تم الحفظ في ${monthLabel(monthOf(date.value))}` : 'تم حفظ المصروف');
      app.refresh();
    } catch (err) { toast(friendlyError(err), 'err'); busy = false; saveBtn.disabled = false; }
  } }, f1, f2, f3, f4, f5);
  const foot = [saveBtn];
  if (item) foot.push(h('button', { class: 'btn btn-outline-danger', type: 'button', onClick: async () => {
    if (!(await confirmDialog({ title: 'حذف المصروف', message: `هل تريد حذف «${item.name}»؟`, confirmText: 'حذف', danger: true }))) return;
    try { await store.deleteVariable(item.id); s.close(); toast('تم الحذف'); app.refresh(); } catch (err) { toast(friendlyError(err), 'err'); }
  } }, icon('trash', 18), 'حذف'));
  const s = openSheet({ title: item ? (item.needsReview ? 'مراجعة العملية' : 'تعديل المصروف') : 'مصروف جديد', body: form, footer: foot });
}
