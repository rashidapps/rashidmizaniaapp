import { h, icon, toast, field, openSheet, confirmDialog } from './ui.js';
import { buildBackup, validateBackupText, backupFilename, toCSV, deliverFile } from './backup.js';
import { friendlyError } from './db.js';
import { APP_VERSION } from './config.js';
import { formatDate, daysSince, currentMonth, monthLabel } from './dates.js';
import { getLastBackupAt, setLastBackupAt } from './prefs.js';
import { openBankImport } from './page-bank-import.js';

export async function render(ctx) {
  const { store, app } = ctx;
  const root = h('div', { class: 'page' });
  root.append(h('h1', { class: 'page-title' }, 'الإعدادات والنسخ الاحتياطي'));
  const snap = await store.getSnapshot();
  const last = getLastBackupAt();
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  let busy = false;
  const guard = fn => async () => { if (busy) return; busy = true; try { await fn(); } catch (e) { toast(friendlyError(e), 'err'); } finally { busy = false; } };

  const exportJSON = guard(async () => {
    const backup = await buildBackup(await store.db.exportAll());
    const r = await deliverFile(backupFilename(), 'application/json', JSON.stringify(backup));
    if (r.cancelled) return;
    setLastBackupAt(new Date().toISOString());
    toast(r.method === 'share' ? 'اختر «حفظ في الملفات» من قائمة المشاركة' : 'تم تنزيل ملف النسخة الاحتياطية');
    app.refresh();
  });
  const exportCSV = scope => guard(async () => {
    const data = await store.db.exportAll();
    const csv = toCSV(data, scope === 'month' ? { monthId: ctx.month } : {});
    const r = await deliverFile(`mizaniyati-${scope === 'month' ? ctx.month : 'all'}.csv`, 'text/csv', csv);
    if (!r.cancelled) toast('تم تجهيز ملف CSV');
  });

  fileIn.addEventListener('change', guard(async () => {
    const f = fileIn.files && fileIn.files[0];
    if (!f) return;
    let text;
    try { text = await f.text(); } catch { toast('تعذّرت قراءة الملف', 'err'); return; } finally { fileIn.value = ''; }
    const v = await validateBackupText(text);
    if (!v.ok) { await confirmDialog({ title: 'ملف غير صالح', message: v.errors.join('\n'), confirmText: 'حسناً', cancelText: 'إغلاق' }); return; }
    const c = v.summary.counts;
    const ok = await confirmDialog({
      title: 'استعادة النسخة الاحتياطية',
      message: `نسخة بتاريخ ${v.summary.exportedAt ? formatDate(v.summary.exportedAt.slice(0, 10)) : '—'} تضم ${c.months} شهراً (${monthLabel(v.summary.from)} → ${monthLabel(v.summary.to)}) و${c.fixed} مصروفاً ثابتاً و${c.variable} مصروفاً غير ثابت و${c.emergency} حركة للصندوق.\n\nسيتم استبدال كل البيانات الحالية. نحتفظ بنسخة من بياناتك الحالية لتتمكن من التراجع.`,
      confirmText: 'استبدال البيانات', danger: true });
    if (!ok) return;
    await store.saveSnapshot(await buildBackup(await store.db.exportAll()));
    await store.restoreData(v.backup.data);
    toast('تمت استعادة البيانات بنجاح');
    app.resetMonth();
  }));
  const undoRestore = guard(async () => {
    if (!snap) return;
    if (!(await confirmDialog({ title: 'التراجع عن آخر استعادة', message: 'سيتم إرجاع البيانات كما كانت قبل آخر استعادة، وسيتم استبدال البيانات الحالية.', confirmText: 'تراجع', danger: true }))) return;
    const v = await validateBackupText(JSON.stringify(snap.payload));
    if (!v.ok) { toast('النسخة المحفوظة تالفة', 'err'); return; }
    await store.restoreData(v.backup.data);
    toast('تم الرجوع للبيانات السابقة');
    app.resetMonth();
  });

  root.append(h('div', { class: 'card' }, h('h3', null, 'النسخ الاحتياطي والاستعادة'),
    h('p', { class: 'muted', style: 'margin-bottom:12px;font-size:14px' }, last ? `آخر نسخة: ${formatDate(last.slice(0, 10))} (قبل ${daysSince(last)} يوم)` : 'لم تُؤخذ نسخة احتياطية بعد.'),
    h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      h('button', { class: 'btn btn-primary', type: 'button', onClick: exportJSON }, icon('download', 18), 'تصدير نسخة احتياطية كاملة (JSON)'),
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => fileIn.click() }, icon('upload', 18), 'استيراد واستعادة نسخة احتياطية'),
      h('div', { class: 'grid2' },
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: exportCSV('month') }, 'CSV للشهر الحالي'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: exportCSV('all') }, 'CSV لكل البيانات')),
      snap ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: undoRestore }, icon('refresh', 16), 'التراجع عن آخر استعادة') : null),
    fileIn,
    h('p', { class: 'hint', style: 'margin-top:12px' }, 'عند التصدير تظهر قائمة المشاركة: اختر «حفظ في الملفات» ثم iCloud Drive. التطبيق لا يستطيع الرفع التلقائي إلى iCloud Drive؛ النسخ الدورية تتطلب أن تأخذها بنفسك أو إعداد اختصار/خدمة مناسبة لاحقاً.')));

  root.append(h('div', { class: 'card' }, h('h3', null, 'المصاريف البنكية'),
    h('p', { class: 'muted', style: 'font-size:14px;margin-bottom:10px' }, 'الصق نص رسائل الخصم من البنك أو استورد ملفاً نصياً ليتعرف التطبيق على المبلغ والمتجر والتاريخ.'),
    h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => openBankImport(ctx) }, icon('bank', 18), 'استيراد من رسائل البنك')));

  const persistLine = h('div', { class: 'kv' }, h('span', { class: 'k' }, 'حماية التخزين من الحذف التلقائي'), h('span', { class: 'v' }, '…'));
  const usageLine = h('div', { class: 'kv' }, h('span', { class: 'k' }, 'المساحة المستخدمة'), h('span', { class: 'v' }, '…'));
  (async () => {
    try { const p = await navigator.storage.persisted(); persistLine.lastChild.textContent = p ? 'مفعّلة' : 'غير مضمونة'; } catch { persistLine.lastChild.textContent = 'غير معروفة'; }
    try { const e = await navigator.storage.estimate(); usageLine.lastChild.textContent = e.usage != null ? (e.usage / 1024).toFixed(0) + ' KB' : '—'; } catch { usageLine.lastChild.textContent = '—'; }
  })();
  const swLine = h('div', { class: 'kv' }, h('span', { class: 'k' }, 'العمل دون إنترنت'), h('span', { class: 'v' }, ('serviceWorker' in navigator && navigator.serviceWorker.controller) ? 'جاهز' : 'يصبح جاهزاً بعد أول تحميل كامل'));
  root.append(h('div', { class: 'card' }, h('h3', null, 'التخزين والخصوصية'), persistLine, usageLine, swLine,
    h('p', { class: 'hint', style: 'margin-top:10px' }, 'بياناتك محفوظة على هذا الجهاز فقط ولا تُرسل إلى أي خادم. حذف بيانات Safari/الموقع أو فقدان الجهاز أو حذف التطبيق قد يؤدي إلى فقدان البيانات، والنسخ الاحتياطي هو وسيلة الحماية الوحيدة — لا يوجد ضمان بنسبة 100%.')));

  const upd = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: async () => {
    try { const reg = await navigator.serviceWorker.getRegistration(); if (!reg) { toast('خدمة العمل دون إنترنت غير مفعّلة بعد', 'err'); return; } await reg.update(); toast(reg.waiting || reg.installing ? 'تتوفر نسخة جديدة' : 'أنت على أحدث نسخة'); } catch { toast('تعذّر التحقق (لا يوجد اتصال؟)', 'err'); }
  } }, icon('refresh', 16), 'التحقق من وجود تحديث');
  root.append(h('div', { class: 'card' }, h('h3', null, 'عن التطبيق'), h('div', { class: 'kv' }, h('span', { class: 'k' }, 'الإصدار'), h('span', { class: 'v kbd' }, APP_VERSION)), h('div', { style: 'margin-top:10px' }, upd)));

  const wipe = () => {
    const inp = h('input', { id: 'wipe', type: 'text', autocomplete: 'off', placeholder: 'اكتب: حذف' });
    const btn = h('button', { class: 'btn btn-danger', type: 'button', disabled: true }, 'حذف كل البيانات نهائياً');
    inp.addEventListener('input', () => { btn.disabled = inp.value.trim() !== 'حذف'; });
    btn.addEventListener('click', guard(async () => { await store.wipeAll(); s.close(); toast('تم حذف كل البيانات'); app.resetMonth(); }));
    const s = openSheet({ title: 'حذف كل البيانات', body: h('div', null, h('p', { class: 'dialog-msg' }, 'سيتم حذف الراتب والمصاريف وصندوق الطوارئ والإعدادات من هذا الجهاز نهائياً. يُنصح بتصدير نسخة احتياطية أولاً.'), field('للتأكيد اكتب كلمة «حذف»', inp)), footer: [btn] });
  };
  root.append(h('div', { class: 'card' }, h('h3', null, 'منطقة الخطر'), h('button', { class: 'btn btn-outline-danger btn-block', type: 'button', onClick: wipe }, icon('trash', 18), 'حذف كل البيانات')));
  return { el: root };
}
export { currentMonth };
