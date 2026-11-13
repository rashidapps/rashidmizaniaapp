// أدوات واجهة صغيرة: إنشاء عناصر DOM آمنة (بدون innerHTML للنصوص)، أيقونات، نوافذ سفلية، تنبيهات.
import { formatAmount } from './money.js';
import { CURRENCY_LABEL } from './config.js';

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;   // للرسوم SVG المُولَّدة من أرقام وثوابت فقط
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  const add = k => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) return k.forEach(add);
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  return el;
}

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".8"/><circle cx="4" cy="12" r=".8"/><circle cx="4" cy="18" r=".8"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  chart: '<path d="M5 20v-7M12 20V5M19 20v-10M3 20h18"/>',
  gear: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  chevR: '<path d="m9 6 6 6-6 6"/>',
  chevL: '<path d="m15 6-6 6 6 6"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  bank: '<path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 4 3 20h18z"/><path d="M12 10v4M12 17h.01"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
};
export function icon(name, size = 22) {
  const s = document.createElement('span');
  s.className = 'ic';
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return s;
}

/** عرض مبلغ: رقم لاتيني معزول الاتجاه + رمز العملة. */
export function amt(b, { sign = false, cls = '', unit = true } = {}) {
  return h('span', { class: `amt ${cls}`.trim() }, formatAmount(b, { sign }), unit ? h('small', null, ' ' + CURRENCY_LABEL) : null);
}

export function toast(msg, kind = 'ok') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, kind === 'err' ? icon('alert', 18) : icon('check', 18), h('span', null, msg));
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'err' ? 4200 : 2400);
}

let openSheets = 0;
export function openSheet({ title, body, footer, onClose, autofocus = true, kind = 'sheet' }) {
  const prevFocus = document.activeElement;
  const back = h('div', { class: 'backdrop' });
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'إغلاق' }, icon('x', 20));
  const sheet = h('div', { class: `sheet ${kind}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', null, title), closeBtn),
    h('div', { class: 'sheet-body' }, body),
    footer ? h('div', { class: 'sheet-foot' }, footer) : null);
  back.append(sheet);
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    back.classList.add('out');
    setTimeout(() => back.remove(), 180);
    if (--openSheets <= 0) { openSheets = 0; document.body.classList.remove('lock'); }
    try { prevFocus && prevFocus.focus && prevFocus.focus({ preventScroll: true }); } catch { /* */ }
    onClose && onClose(result);
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.addEventListener('touchstart', e => { if (e.target === back) close(); }, { passive: true });
  closeBtn.addEventListener('click', () => close());
  sheet.addEventListener('focusin', e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 320);
  });
  document.body.append(back);
  document.body.classList.add('lock');
  openSheets++;
  if (autofocus) setTimeout(() => { const f = sheet.querySelector('input:not([type=hidden]),textarea,select'); f && f.focus({ preventScroll: true }); }, 60);
  return { close, el: sheet };
}

export function confirmDialog({ title, message, confirmText = 'تأكيد', cancelText = 'إلغاء', danger = false }) {
  return new Promise(resolve => {
    let decided = false;
    const done = v => { decided = true; s.close(); resolve(v); };
    const s = openSheet({
      title, kind: 'dialog', autofocus: false,
      body: h('p', { class: 'dialog-msg' }, message),
      footer: [
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onClick: () => done(true) }, confirmText),
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => done(false) }, cancelText),
      ],
      onClose: () => { if (!decided) resolve(false); },
    });
  });
}

/** حقل نموذج: label + عنصر إدخال + رسالة خطأ. */
export function field(label, input, { hint, id } = {}) {
  const err = h('div', { class: 'field-err', role: 'alert', hidden: true });
  const wrap = h('div', { class: 'field' }, h('label', { for: id || input.id }, label), input, hint ? h('div', { class: 'hint' }, hint) : null, err);
  wrap.setError = m => {
    err.textContent = m || ''; err.hidden = !m;
    const c = wrap.querySelector('input,select,textarea');
    c && c.setAttribute('aria-invalid', m ? 'true' : 'false');
    wrap.classList.toggle('bad', !!m);
  };
  return wrap;
}
/** حقل مبلغ بالريال العماني (إدخال نصي بلوحة أرقام عشرية). */
export function moneyField(label, id, value, { hint } = {}) {
  const input = h('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done', value: value || '', placeholder: '0.000' });
  const wrap = field(label, h('div', { class: 'money-in' }, input, h('span', null, CURRENCY_LABEL)), { hint, id });
  wrap.input = input;
  return wrap;
}
export function emptyState(iconName, title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-ic' }, icon(iconName, 30)), h('h3', null, title), text ? h('p', null, text) : null, action || null);
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** نافذة إدخال كلمة مرور (مع تأكيد وإقرار اختياريين). تعيد النص أو null عند الإلغاء. */
export function askSecret({ title, message, confirm = false, ack = '', submitText = 'متابعة', validate, label = 'كلمة المرور' }) {
  return new Promise(resolve => {
    let decided = false;
    const p1 = h('input', { id: 'sec-1', type: 'password', autocomplete: confirm ? 'new-password' : 'current-password' });
    const f1 = field(label, p1);
    const p2 = confirm ? h('input', { id: 'sec-2', type: 'password', autocomplete: 'new-password' }) : null;
    const f2 = p2 ? field('أعد كتابة كلمة المرور', p2) : null;
    const cb = ack ? h('input', { type: 'checkbox', id: 'sec-ack' }) : null;
    const ackErr = h('div', { class: 'field-err', hidden: true }, 'يجب الإقرار للمتابعة');
    const btn = h('button', { class: 'btn btn-primary', type: 'submit', form: 'sec-form' }, submitText);
    const form = h('form', { id: 'sec-form', novalidate: true, onSubmit: async e => {
      e.preventDefault();
      const v = p1.value;
      f1.setError(v ? '' : 'اكتب كلمة المرور');
      if (!v) return;
      if (validate) { const err = await validate(v); f1.setError(err || ''); if (err) return; }
      if (p2) { const ok = p2.value === v; f2.setError(ok ? '' : 'كلمتا المرور غير متطابقتين'); if (!ok) return; }
      if (cb && !cb.checked) { ackErr.hidden = false; return; }
      decided = true; s.close(); resolve(v);
    } }, message ? h('p', { class: 'dialog-msg' }, message) : null, f1, f2, cb ? h('label', { class: 'check-row' }, cb, h('span', null, ack)) : null, ackErr);
    const s = openSheet({ title, body: form, footer: [btn], onClose: () => { if (!decided) resolve(null); } });
  });
}
