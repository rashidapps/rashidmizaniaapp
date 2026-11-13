// استيراد العمليات البنكية من نص ملصوق أو ملف نصي، مع معاينة ومنع التكرار.
import { h, icon, amt, toast, field, openSheet } from './ui.js';
import { parseMessages } from './sms.js';
import { formatDate } from './dates.js';
import { friendlyError } from './db.js';

export async function openBankImport(ctx) {
  const { store, app } = ctx;
  const ta = h('textarea', { id: 'sms-text', rows: '6', dir: 'auto', placeholder: 'الصق رسالة الخصم هنا (أو عدة رسائل، افصل بينها بسطر فارغ)' });
  const fileIn = h('input', { type: 'file', accept: '.txt,text/plain', hidden: true });
  const result = h('div');
  const addBtn = h('button', { class: 'btn btn-primary', type: 'button', hidden: true }, 'إضافة المحدد');
  let items = [];

  const analyze = async () => {
    const parsed = parseMessages(ta.value);
    result.replaceChildren();
    items = [];
    addBtn.hidden = true;
    if (!parsed.length) { result.append(h('p', { class: 'muted' }, 'الصق نص الرسالة أولاً.')); return; }
    let existing;
    try { existing = new Set((await store.getAllVariable()).map(v => v.ref).filter(Boolean)); } catch (e) { toast(friendlyError(e), 'err'); return; }
    const seen = new Set();
    for (const p of parsed) {
      if (!p.ok) {
        result.append(h('div', { class: 'preview-item skip' }, h('div', { class: 'top' }, icon('x', 18), h('div', { class: 'mid' }, h('b', null, p.reason), h('div', { class: 'hint', dir: 'auto' }, p.raw.slice(0, 90) + (p.raw.length > 90 ? '…' : '')))), null));
        continue;
      }
      const dup = existing.has(p.ref) || seen.has(p.ref);
      seen.add(p.ref);
      const cb = h('input', { type: 'checkbox', checked: !dup, 'aria-label': 'تحديد العملية' });
      const nm = h('input', { type: 'text', value: p.name, maxlength: '100', 'aria-label': 'اسم العملية' });
      items.push({ p, cb, nm, dup });
      result.append(h('div', { class: 'preview-item' + (dup ? ' skip' : '') },
        h('div', { class: 'top' }, cb, nm),
        h('div', { class: 'meta' }, h('span', null, formatDate(p.date)), h('b', null, amt(p.amount)),
          dup ? h('span', { class: 'tag review' }, 'مسجّلة مسبقاً أو مكررة') : null,
          p.uncertain ? h('span', { class: 'tag review' }, 'نوع العملية غير مؤكد') : null,
          !p.merchant && !dup ? h('span', { class: 'tag' }, 'لم يُعرف المتجر') : null)));
    }
    if (items.length) { addBtn.hidden = false; }
    else if (parsed.every(p => !p.ok)) result.append(h('p', { class: 'muted' }, 'لم يتم التعرف على أي عملية خصم في النص.'));
  };

  let busy = false;
  addBtn.addEventListener('click', async () => {
    if (busy) return;
    const chosen = items.filter(i => i.cb.checked);
    if (!chosen.length) { toast('لم تحدد أي عملية', 'err'); return; }
    busy = true; addBtn.disabled = true;
    try {
      const r = await store.addBankExpenses(chosen.map(i => ({ name: i.nm.value.trim() || i.p.name, amount: i.p.amount, date: i.p.date, ref: i.p.ref, force: i.dup })));
      s.close();
      toast(`أُضيفت ${r.added} عملية — تحتاج مراجعة التصنيف`);
      app.go('variable', { review: true });
      app.refresh();
    } catch (e) { toast(friendlyError(e), 'err'); busy = false; addBtn.disabled = false; }
  });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { toast('الملف كبير جداً', 'err'); return; }
    try { ta.value = await f.text(); await analyze(); } catch { toast('تعذّرت قراءة الملف', 'err'); }
    fileIn.value = '';
  });

  const body = h('div', null,
    h('div', { class: 'banner info', style: 'margin-bottom:12px' }, icon('info', 20), h('div', { class: 'grow' }, 'التطبيق لا يقرأ رسائلك تلقائياً. الصق نص رسالة الخصم، أو استورد ملفاً نصياً يجمع رسائل البنك. العمليات تُضاف باسم «مراجعة» لتؤكدها وتصنّفها، ولا تُضاف العملية نفسها مرتين.')),
    field('نص الرسائل', ta),
    h('div', { class: 'grid2', style: 'margin-bottom:14px' },
      h('button', { class: 'btn btn-primary', type: 'button', onClick: analyze }, 'تحليل النص'),
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => fileIn.click() }, icon('upload', 18), 'استيراد ملف .txt')),
    fileIn, result);
  const s = openSheet({ title: 'استيراد من رسائل البنك', body, footer: [addBtn], autofocus: false });
}
