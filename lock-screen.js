// شاشة القفل: تظهر قبل أي قراءة للبيانات عندما يكون التشفير مفعّلاً.
import { h, icon } from './ui.js';
import { unlockWithPassphrase, unlockWithPasskey } from './security.js';

export function showLockScreen(db, info) {
  return new Promise(resolve => {
    let fails = 0, busy = false, lockedUntil = 0;
    const pass = h('input', { id: 'lock-pass', type: 'password', autocomplete: 'current-password', placeholder: 'كلمة المرور', 'aria-label': 'كلمة المرور', enterkeyhint: 'go' });
    const msg = h('div', { class: 'lock-msg', role: 'alert', 'aria-live': 'polite' });
    const go = h('button', { class: 'btn btn-primary btn-block', type: 'submit', id: 'lock-go' }, 'فتح');
    const done = () => { screen.remove(); resolve(); };
    const setBusy = b => { busy = b; go.disabled = b; };

    async function withPass() {
      if (busy) return;
      const wait = lockedUntil - Date.now();
      if (wait > 0) { msg.textContent = `انتظر ${Math.ceil(wait / 1000)} ثانية قبل المحاولة.`; return; }
      if (!pass.value) { msg.textContent = 'اكتب كلمة المرور.'; return; }
      setBusy(true); msg.textContent = '';
      try {
        if (await unlockWithPassphrase(db, pass.value)) { pass.value = ''; return done(); }
        fails++; pass.value = '';
        if (fails >= 5) { lockedUntil = Date.now() + Math.min(300, 15 * 2 ** (fails - 5)) * 1000; msg.textContent = 'محاولات كثيرة خاطئة. انتظر قليلاً.'; }
        else msg.textContent = 'كلمة المرور غير صحيحة.';
      } catch { msg.textContent = 'حدث خطأ أثناء الفتح.'; }
      setBusy(false);
    }
    async function withFaceId() {
      if (busy) return;
      setBusy(true); msg.textContent = '';
      try {
        if (await unlockWithPasskey(db)) return done();
        msg.textContent = 'تعذّر الفتح بـ Face ID. استخدم كلمة المرور.';
      } catch (e) { msg.textContent = e && e.name === 'NotAllowedError' ? 'أُلغي التحقق. حاول مجدداً أو استخدم كلمة المرور.' : (e.message || 'تعذّر الفتح بـ Face ID.'); }
      setBusy(false);
    }
    const form = h('form', { class: 'lock-form', novalidate: true, onSubmit: e => { e.preventDefault(); withPass(); } }, pass, go);
    const screen = h('div', { class: 'lockscreen', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'فتح التطبيق' },
      h('div', { class: 'lock-card' },
        h('div', { class: 'lock-ic' }, icon('shield', 36)),
        h('h1', null, 'ميزانيتي'),
        h('p', { class: 'muted' }, 'بياناتك مشفّرة. افتح التطبيق للمتابعة.'),
        info.passkey ? h('button', { class: 'btn btn-primary btn-block', type: 'button', id: 'lock-faceid', onClick: withFaceId }, icon('shield', 18), 'فتح بـ Face ID') : null,
        info.passkey ? h('div', { class: 'lock-or' }, 'أو بكلمة المرور') : null,
        form, msg));
    document.body.append(screen);
    const boot = document.getElementById('boot'); if (boot) boot.remove();
    if (!info.passkey) setTimeout(() => pass.focus(), 80);
  });
}
