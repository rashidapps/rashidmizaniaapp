// نقطة الدخول: فتح قاعدة البيانات، التوجيه بين الصفحات، رأس الصفحة، تسجيل Service Worker.
import { openDB, friendlyError } from './db.js';
import { Store } from './store.js';
import { h, icon, toast, openSheet } from './ui.js';
import { currentMonth, monthLabel } from './dates.js';
import * as home from './page-home.js';
import * as fixed from './page-fixed.js';
import * as variable from './page-variable.js';
import * as emergency from './page-emergency.js';
import * as reports from './page-reports.js';
import * as settings from './page-settings.js';

const ROUTES = {
  home: { label: 'الرئيسية', icon: 'home', page: home },
  fixed: { label: 'الثابتة', icon: 'list', page: fixed },
  variable: { label: 'غير الثابتة', icon: 'receipt', page: variable },
  emergency: { label: 'الطوارئ', icon: 'shield', page: emergency },
  reports: { label: 'التقارير', icon: 'chart', page: reports },
  settings: { label: 'الإعدادات', icon: 'gear', page: settings },
};
const TABS = ['home', 'fixed', 'variable', 'emergency', 'reports'];

const app = { store: null, state: { month: currentMonth() }, params: null, persisted: false };
window.__mz = app;   // للاختبارات والتشخيص فقط
let renderToken = 0, lastRoute = null;
const $ = id => document.getElementById(id);

function routeName() {
  const r = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
  return ROUTES[r] ? r : 'home';
}
app.go = (route, params) => {
  app.params = params || null;
  if (routeName() === route && location.hash === '#/' + route) return app.refresh();
  location.hash = '#/' + route;
};
app.refresh = () => render({ keepScroll: true });
app.resetMonth = async () => { app.state.month = currentMonth(); app.params = null; await app.store.ensureMonth(app.state.month); if (routeName() !== 'home') location.hash = '#/home'; else render(); };

/* ---------- الهيكل ---------- */
function buildShell() {
  const root = $('app');
  root.innerHTML = '';
  const prev = h('button', { type: 'button', id: 'm-prev', 'aria-label': 'الشهر السابق' }, icon('chevR', 20));
  const label = h('button', { type: 'button', id: 'm-label', class: 'label', 'aria-label': 'اختيار الشهر' }, '');
  const next = h('button', { type: 'button', id: 'm-next', 'aria-label': 'الشهر التالي' }, icon('chevL', 20));
  const gear = h('div', { class: 'icon-btn' }, h('button', { type: 'button', 'aria-label': 'الإعدادات', onClick: () => app.go('settings') }, icon('gear', 20)));
  root.append(
    h('header', { class: 'topbar' }, h('div', { class: 'brand', id: 'brand' }, 'ميزانيتي'), h('div', { class: 'month-switch', id: 'm-switch' }, prev, label, next), gear),
    h('div', { id: 'upd-slot' }),
    h('main', { id: 'view', tabindex: '-1' }),
    h('button', { class: 'fab', id: 'fab', type: 'button', hidden: true }, icon('plus', 28)),
    h('nav', { class: 'tabbar', 'aria-label': 'التنقل الرئيسي' }, TABS.map(t => h('a', { href: '#/' + t, id: 'tab-' + t }, icon(ROUTES[t].icon, 24), h('span', null, ROUTES[t].label)))));
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  label.addEventListener('click', pickMonth);
}
async function monthIds() { return (await app.store.getAllMonths()).map(m => m.id); }
async function step(d) {
  const ids = await monthIds();
  const i = ids.indexOf(app.state.month);
  const j = i + d;
  if (j < 0 || j >= ids.length) return;
  app.state.month = ids[j];
  render();
}
async function pickMonth() {
  const ids = (await monthIds()).reverse();
  const s = openSheet({ title: 'اختيار الشهر', autofocus: false, body: h('div', { class: 'list' }, ids.map(id => h('button', { class: 'row', type: 'button', onClick: () => { app.state.month = id; s.close(); render(); } },
    h('div', { class: 'mid' }, h('div', { class: 'nm' }, monthLabel(id))), id === app.state.month ? icon('check', 20) : null))) });
}
async function updateHeader(route) {
  const isSettings = route === 'settings';
  $('m-switch').style.visibility = isSettings ? 'hidden' : 'visible';
  $('brand').textContent = isSettings ? 'الإعدادات' : 'ميزانيتي';
  $('m-label').textContent = monthLabel(app.state.month);
  const ids = await monthIds();
  const i = ids.indexOf(app.state.month);
  $('m-prev').disabled = i <= 0;
  $('m-next').disabled = i < 0 || i >= ids.length - 1;
  TABS.forEach(t => { const a = $('tab-' + t); a.classList.toggle('on', t === route); t === route ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
}

async function render({ keepScroll = false } = {}) {
  const token = ++renderToken;
  const route = routeName();
  const view = $('view');
  const y = window.scrollY;
  try {
    await app.store.ensureMonth(app.state.month);
    await updateHeader(route);
    const res = await ROUTES[route].page.render({ store: app.store, month: app.state.month, app });
    if (token !== renderToken) return;
    view.replaceChildren(res.el);
    const fab = $('fab');
    fab.hidden = !res.fab;
    if (res.fab) { fab.setAttribute('aria-label', res.fab.label); fab.onclick = res.fab.onClick; }
    if (keepScroll && lastRoute === route) window.scrollTo(0, y); else window.scrollTo(0, 0);
    lastRoute = route;
  } catch (e) {
    console.error(e);
    if (token !== renderToken) return;
    view.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'empty' }, h('h3', null, 'حدث خطأ غير متوقع'), h('p', null, friendlyError(e)), h('button', { class: 'btn btn-primary', type: 'button', onClick: () => render() }, 'إعادة المحاولة'))));
  }
}

/* ---------- Service Worker والتحديث ---------- */
function showUpdateBanner(reg) {
  const slot = $('upd-slot');
  if (!slot || slot.firstChild) return;
  slot.append(h('div', { class: 'banner info', style: 'margin:10px 14px 0' }, icon('refresh', 20), h('div', { class: 'grow' }, 'تتوفر نسخة جديدة من التطبيق. بياناتك لن تتأثر.',
    h('div', null, h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => { reg.waiting && reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } }, 'تحديث الآن')))));
}
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(reg); });
    });
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded || !hadController) return; reloaded = true; location.reload(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  } catch (e) { console.warn('SW registration failed', e); }
}
let hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);

/* ---------- الإقلاع ---------- */
function fatal(msg) {
  const b = $('boot'); if (b) b.remove();
  $('app').hidden = false;
  $('app').replaceChildren(h('div', { class: 'fatal' }, h('h2', null, 'تعذّر تشغيل التخزين المحلي'), h('p', null, msg), h('p', { class: 'muted' }, 'تأكد من أنك لا تستخدم التصفح الخاص، وأن التخزين غير مقيّد في إعدادات Safari، ثم أعد فتح التطبيق.')));
}
async function boot() {
  let db;
  try { db = await openDB(); } catch (e) { console.error(e); return fatal(friendlyError(e)); }
  app.store = new Store(db);
  try { await app.store.init(); await app.store.ensureMonth(currentMonth()); } catch (e) { console.error(e); return fatal(friendlyError(e)); }
  try { app.persisted = !!(navigator.storage && navigator.storage.persist && (await navigator.storage.persist())); } catch { /* */ }
  buildShell();
  $('boot').remove();
  $('app').hidden = false;
  window.addEventListener('hashchange', () => render());
  window.addEventListener('db-versionchange', () => { toast('تم تحديث البيانات من نافذة أخرى. سيُعاد التحميل…', 'err'); setTimeout(() => location.reload(), 1200); });
  window.addEventListener('db-blocked', () => toast('أغلق نوافذ التطبيق الأخرى لإكمال التحديث', 'err'));
  let knownCurrent = currentMonth();
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !app.store) return;
    const cm = currentMonth();
    if (cm !== knownCurrent) {   // بدأ شهر جديد أثناء بقاء التطبيق مفتوحاً
      const wasOnCurrent = app.state.month === knownCurrent;
      knownCurrent = cm;
      try { await app.store.ensureMonth(cm); if (wasOnCurrent) app.state.month = cm; toast('بدأ شهر جديد: ' + monthLabel(cm)); render(); } catch (e) { toast(friendlyError(e), 'err'); }
    }
  });
  await render();
  registerSW();
}
boot();
