'use strict';
/**
 * UI smoke test (jsdom). Needs the server running in demo mode, e.g.:
 *   DEMO=1 PORT=3113 node server.js
 *   BASE=http://localhost:3113 npm run test:ui
 * Use a fresh REQUESTS_FILE for each run (the test files access requests for open offers).
 * Checks the main flows end-to-end against the real API plus structural rules
 * (no inline style attributes, no API key / token wording, CSS breakpoints present).
 */
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const BASE = process.env.BASE || 'http://localhost:3113';
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + String(extra).slice(0, 160) : ''));
};

/* ───────── static checks (sources) ───────── */
const html = read('index.html'), appJs = read('app.js'), i18n = read('i18n.js'), css = read('styles.css');
const KEY_RE = /api[\s-]?(ключ|key|кілт)|hasApiKey|key_prompt|api-key|токен|token\b|кілт/i;
ok('index.html: no <style>, no inline <script>, no style=', !/<style|style\s*=/.test(html) && !/<script(?![^>]*\bsrc=)[^>]*>/i.test(html));
ok('index.html: default lang ru, viewport-fit=cover', /<html lang="ru">/.test(html) && /viewport-fit=cover/.test(html));
ok('index.html: Google font with cyrillic (Onest/Unbounded)', /fonts\.googleapis\.com\/css2\?family=Onest/.test(html));
ok('app.js: no inline style attributes / .style usage', !/style\s*=\s*["'`\\]/.test(appJs) && !/\.style\./.test(appJs) && !/<style/.test(appJs));
ok('app.js + i18n: no API key / token mentions', !KEY_RE.test(appJs.replace(/event_token|e\.token|\.token\)/g, '')) && !KEY_RE.test(i18n));
ok('app.js: no external scripts', !/https?:\/\/[^'"`\s]*\.js/.test(appJs));
ok('css: mobile-first breakpoints 768/1024/1440 + narrow 374', [/min-width:\s*768px/, /min-width:\s*1024px/, /min-width:\s*1440px/, /max-width:\s*374px/].every((r) => r.test(css)));
ok('css: safe-area, dvh, reduced motion, focus-visible', /safe-area-inset-bottom/.test(css) && /100dvh/.test(css) && /prefers-reduced-motion/.test(css) && /:focus-visible/.test(css));
ok('css: tap target token 44px', /--tap:\s*44px/.test(css));
ok('css: sticky first column + sticky period', /\.sticky-col\s*\{[^}]*position:\s*sticky/.test(css) && /\.period\s*\{[^}]*position:\s*sticky/.test(css));
ok('css: bottom tab bar hidden on desktop, rail shown', /\.topbar, \.tabbar \{ display: none; \}/.test(css) && /\.rail \{ display: none; \}/.test(css));
ok('css: braces balanced', (css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length);
{
  const sb = new JSDOM('', { runScripts: 'outside-only' }).window;
  sb.eval(i18n);
  const L = sb.I18N;
  const keys = Object.keys(L.ru);
  const bad = keys.filter((k) => ['en', 'kk'].some((l) => typeof L[l][k] !== 'string' || !L[l][k].trim()) || !L.ru[k].trim());
  ok('i18n: every key has en/ru/kk', keys.length > 150 && bad.length === 0, keys.length + ' keys' + (bad.length ? '; missing: ' + bad.join(',') : ''));
  const ph = keys.filter((k) => { const v = (x) => (x.match(/\{\w+\}/g) || []).sort().join(); return v(L.ru[k]) !== v(L.en[k]) || v(L.ru[k]) !== v(L.kk[k]); });
  ok('i18n: placeholders match across languages', ph.length === 0, ph.join(','));
}
ok('i18n: kazakh uses specific letters (ә ғ қ ң ө ұ ү і)', /[әғқңөұүі]/.test(i18n));

/* ───────── jsdom app ───────── */
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.detail || e.message)));
vc.on('error', (e) => errors.push('console.error: ' + e));
vc.on('warn', (e) => errors.push('console.warn: ' + e));

const dom = new JSDOM(html.replace(/<script[^>]*><\/script>/g, '').replace(/<link[^>]*>/g, ''), {
  url: BASE + '/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
});
const w = dom.window;
let cookie = '';
const requests = [];
w.fetch = async (p, opts = {}) => {
  requests.push({ path: p, method: opts.method || 'GET', body: opts.body });
  const headers = { ...(opts.headers || {}), cookie };
  const r = await fetch(BASE + p, { ...opts, headers });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  for (const c of sc) cookie = c.split(';')[0];
  return r;
};
w.scrollTo = () => {};
w.Element.prototype.scrollIntoView = () => {};
w.document.execCommand = () => true;
w.addEventListener('error', (e) => errors.push('window error: ' + e.message));
w.addEventListener('unhandledrejection', (e) => errors.push('unhandled: ' + (e.reason && e.reason.message)));

w.eval(i18n);
w.eval(appJs);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => w.document.querySelector(s);
const $$ = (s) => [...w.document.querySelectorAll(s)];
const txt = (s) => ($(s) ? $(s).textContent.replace(/\s+/g, ' ').trim() : null);
const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch { /* not yet */ } await sleep(40); } return false; };
const go = async (h, sel) => { w.location.hash = h; return waitFor(() => $(sel), 5000); };
const submit = (f) => f.dispatchEvent(new w.Event('submit', { cancelable: true }));
const change = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('change')); };

const styleAudit = [];
const bodyText = () => w.document.body.textContent;
function audit(where) {
  const styled = $$('[style]');
  if (styled.length) styleAudit.push(`${where}: ${styled.length} (${styled[0].outerHTML.slice(0, 80)})`);
  if (KEY_RE.test(bodyText())) styleAudit.push(`${where}: key/token wording in DOM`);
}

(async () => {
  ok('auth screen renders in Russian by default', await waitFor(() => $('#auth-form')) && w.document.documentElement.lang === 'ru' && /Войти/.test(txt('.tab')), txt('.tab'));
  audit('auth');

  // wrong password
  $('#auth-form').elements.email.value = 'demo@example.com';
  $('#auth-form').elements.password.value = 'wrong';
  submit($('#auth-form'));
  ok('wrong password shows clear error', await waitFor(() => /Неверный email или пароль/.test(txt('#auth-err'))), txt('#auth-err'));

  // language switching + persistence
  $('[data-lang="kk"]').click(); await sleep(50);
  ok('lang switch kk', /Кіру/.test(txt('.tab')) && w.document.documentElement.lang === 'kk', txt('.tab'));
  $('[data-lang="en"]').click(); await sleep(50);
  ok('lang switch en', /Log in/.test(txt('.tab')));
  ok('lang saved to localStorage', w.localStorage.getItem('lang') === 'en');
  $('[data-lang="ru"]').click(); await sleep(50);
  ok('lang back to ru', /Войти/.test(txt('.tab')) && w.localStorage.getItem('lang') === 'ru');

  // good login
  $('#auth-form').elements.email.value = 'demo@example.com';
  $('#auth-form').elements.password.value = 'demo1234';
  submit($('#auth-form'));
  ok('dashboard renders (hero earnings)', await waitFor(() => $('#kpi-earn')), txt('#kpi-earn'));
  ok('earnings is a money value', /\$|US/.test(txt('#kpi-earn')) && /\d/.test(txt('#kpi-earn')));
  ok('KPI strip has 4 metrics', $$('#kpis .metric').length === 4, txt('#kpis'));
  ok('previous period comparison shown', !!$('.hero .delta') || /прошлом периоде/.test(txt('.hero')), txt('.hero-delta'));
  ok('chart svg has bars', await waitFor(() => $$('#chart svg rect.bar').length > 5), $$('#chart svg rect.bar').length + ' bars');
  ok('top offers listed', $$('#top-offers li').length > 0, $$('#top-offers li').length);
  ok('top countries with emoji flags', $$('#top-countries li').length > 0 && /\u{1F1F0}\u{1F1FF}/u.test(txt('#top-countries')), txt('#top-countries li'));
  ok('bottom tab bar has 5 items incl. More', $$('.tabbar a, .tabbar button').length === 5 && /Ещё/.test(txt('.tabbar')), txt('.tabbar'));
  ok('desktop rail nav has 6 items', $$('.rail-nav a').length === 6);
  ok('active tab marked aria-current', $('.tabbar [data-nav="dashboard"]').getAttribute('aria-current') === 'page');
  $$('[data-metric]')[1].click();
  ok('chart metric switch', $('#chart svg').classList.contains('chart-clicks') && $$('[data-metric]')[1].getAttribute('aria-pressed') === 'true');
  $('[data-preset="7d"]').click();
  ok('period preset re-renders', await waitFor(() => $('[data-preset="7d"]') && $('[data-preset="7d"]').getAttribute('aria-pressed') === 'true' && $('#kpi-earn')));
  ok('period saved to localStorage', /"preset":"7d"/.test(w.localStorage.getItem('wm.range') || ''), w.localStorage.getItem('wm.range'));
  ok('dashboard request used 7-day range', requests.some((r) => /\/api\/dashboard\?from=/.test(r.path)));
  $('[data-custom]').click();
  ok('custom date inputs revealed', !$('#period-custom').hidden && $('#r-from').type === 'date');
  audit('dashboard');
  // period with no data -> "Как начать" checklist + empty state
  $('#r-from').value = '2030-01-01';
  change($('#r-to'), '2030-01-05');
  ok('no-data period -> start checklist', await waitFor(() => $('.start .steps')), txt('.start'));
  ok('checklist has 3 ordered steps, step 1 done (has approved offers)', $$('.start .step').length === 3 && $$('.start .step')[0].classList.contains('is-done') && /Как начать/.test(txt('.start h2')));
  ok('empty state with next step', /данных пока нет/.test(txt('.empty') || ''), txt('.empty'));
  ok('custom range persisted', /2030-01-01/.test(w.localStorage.getItem('wm.range') || ''));
  audit('dashboard empty');
  $('[data-preset="7d"]').click();
  await waitFor(() => $('#chart svg'));

  // offers
  ok('offers view', await go('#/offers', '.offer'), txt('#count'));
  ok('offers: 11 visible (private hidden)', $$('.offer').length === 11 && !/Private Partners/.test(txt('.offers')), $$('.offer').length);
  ok('offers: model badges', $$('.offer .model').length === 11 && $$('.model-cpi').length > 0 && $$('.model-cps').length > 0);
  ok('offers: payout prominent', $$('.offer .pay').every((p) => /\d/.test(p.textContent)), txt('.offer .pay'));
  ok('offers: geo flags', /\u{1F1F0}\u{1F1FF}/u.test(txt('.offer .offer-geo')));
  ok('offers: status pills', $$('.offer .st-approved').length === 7 && $$('.offer .st-open').length + $$('.offer .st-requested').length === 3 && $$('.offer .st-pending').length === 1, `${$$('.st-approved').length}/${$$('.st-open').length}/${$$('.st-requested').length}/${$$('.st-pending').length}`);
  ok('offers: quick copy button on connected', $$('[data-copy-url]').length === 7);
  $('[data-copy-url]').click();
  ok('quick copy -> toast', await waitFor(() => /скопирована/.test(txt('#toasts') || '')), txt('#toasts'));
  ok('model filter chips', await waitFor(() => $$('[data-f-model]').length === 5));
  $('[data-f-model="CPI"]').click();
  ok('filter by model CPI', await waitFor(() => $$('.offer').length === 2), $$('.offer').length);
  $('[data-f-model=""]').click();
  await waitFor(() => $$('.offer').length === 11);
  $('#f-q').value = 'zzzz-nothing'; $('#f-q').dispatchEvent(new w.Event('input'));
  ok('empty state with reset', await waitFor(() => $('#f-reset')), txt('.empty'));
  $('#f-reset').click();
  ok('reset filters', await waitFor(() => $$('.offer').length === 11));

  // offer sheet with link builder
  $('[data-link="1"]').click();
  ok('offer sheet opens', await waitFor(() => $('.sheet [data-builder]')));
  ok('sheet: big payout card', /\$/.test(txt('.paycard-sum')) && !!$('.paycard .model'), txt('.paycard-sum'));
  ok('sheet: dialog semantics', $('.sheet').getAttribute('role') === 'dialog' && $('.sheet').getAttribute('aria-modal') === 'true');
  ok('sheet: payouts/geo/caps sections', $$('.sheet .payout-row').length >= 1 && $$('.sheet .caps li').length >= 1 && /GEO/.test(txt('.sheet .kv')));
  const sub = $('.sheet [data-param="aff_sub1"]'); sub.value = 'tg {clickid}'; sub.dispatchEvent(new w.Event('input'));
  const sub5 = $('.sheet [data-param="aff_sub5"]'); sub5.value = 'post7'; sub5.dispatchEvent(new w.Event('input'));
  const out = $('.sheet [data-out]').value;
  ok('link builder output keeps macros', /aff_sub1=tg%20{clickid}&aff_sub5=post7$/.test(out), out);
  ok('sheet: no advertiser data leaks', !/advertiser|margin note|Another Affiliate|secret=1/.test(txt('.sheet')));
  $('[data-foot-copy]').click();
  ok('sticky footer copy', await waitFor(() => $$('.toast').length >= 2));
  audit('offer sheet');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  ok('Esc closes sheet', !$('.sheet') && !w.document.body.classList.contains('locked'));

  // request access
  $('[data-f-access="open"]').click();
  ok('filter access=open', await waitFor(() => $$('.offer').length === 3), $$('.offer').length);
  const before = requests.length;
  $('.offer [data-open]').click();
  await waitFor(() => $('.sheet [data-request]'));
  ok('open offer sheet has request button + note', !!$('.sheet [data-request]') && !!$('.sheet .note-open'));
  $('.sheet [data-request]').click();
  ok('request -> "Заявка отправлена, ждёт подтверждения администратора"', await waitFor(() => /Заявка отправлена, ждёт подтверждения администратора/.test(txt('.sheet') || '')), txt('.sheet [data-access-note]'));
  const reqCall = requests.slice(before).find((r) => r.path === '/api/offers/request');
  ok('request body is {offerIds:[id]} only', reqCall && /^\{"offerIds":\["\d+"\]\}$/.test(reqCall.body), reqCall && reqCall.body);
  ok('toast confirms request', /Заявка отправлена/.test(txt('#toasts')), txt('#toasts'));
  $('.sheet [data-close]').click();
  ok('list shows "Заявка отправлена" pill', await waitFor(() => $$('.offer .st-requested').length >= 1 || $$('.offer').length === 2), txt('.offers'));
  $('[data-f-access="pending"]').click();
  ok('pending filter shows requested + on-review', await waitFor(() => $$('.offer .st-requested').length >= 1 && $$('.offer .st-pending').length >= 1), `${$$('.st-requested').length} requested, ${$$('.st-pending').length} pending`);
  ok('"На рассмотрении" for admin-pending offer', /На рассмотрении/.test(txt('.offers')));
  $('[data-f-access="open"]').click();
  await waitFor(() => $$('.offer [data-req]').length >= 1);
  $('.offer [data-req]').click();
  ok('card request button -> toast', await waitFor(() => $$('.toast-info').length >= 2), $$('.toast-info').length);
  audit('offers');

  // stats
  ok('stats view', await go('#/stats', '#stats-table table'), txt('#stats-table tfoot'));
  ok('stats: sticky first column', $$('#stats-table .sticky-col').length > 3);
  change($('#s-group'), 'country');
  ok('stats group by country', await waitFor(() => /KZ/.test(txt('#stats-table tbody') || '') && /Страна/.test(txt('#stats-table thead'))));
  $('[data-sort="clicks"] button').click();
  ok('sort desc', $('[data-sort="clicks"]').getAttribute('aria-sort') === 'descending');
  {
    const vals = $$('#stats-table tbody tr').map((tr) => +tr.children[2].textContent.replace(/\D/g, ''));
    ok('sorted values descending', vals.every((v, i) => !i || vals[i - 1] >= v), vals.join(','));
  }
  $('[data-sort="clicks"] button').click();
  ok('sort asc toggle', $('[data-sort="clicks"]').getAttribute('aria-sort') === 'ascending');
  ok('csv link follows grouping', /export\.csv\?.*group=country/.test($('#s-csv').getAttribute('href')), $('#s-csv').getAttribute('href'));
  change($('#s-group'), 'offer');
  ok('stats group by offer', await waitFor(() => /Zerno Bank/.test(txt('#stats-table tbody') || '')));
  audit('stats');

  // conversions
  $('[data-preset="30d"]') || null;
  ok('conversions view', await go('#/conversions', '#conv-table table'), txt('#c-count'));
  $('[data-preset="30d"]').click();
  await waitFor(() => $('#conv-table table') && $('[data-preset="30d"]').getAttribute('aria-pressed') === 'true');
  ok('conversions: card-ready cells with labels', $$('#conv-table td[data-label]').length > 8);
  ok('"Ещё" tab is active for conversions', $('#tab-more').classList.contains('is-on'));
  $('[data-c-status="pending"]').click();
  ok('conv filter pending', await waitFor(() => $$('#conv-table .st-pending').length > 0 && $$('#conv-table .st-approved').length === 0));
  $('[data-c-status=""]').click();
  ok('conv pager present', await waitFor(() => $('#c-next')));
  const firstTime = txt('#conv-table tbody td');
  $('#c-next').click();
  ok('conv pager -> page 2', await waitFor(() => /Страница 2/.test(txt('.pager') || '') && txt('#conv-table tbody td') !== firstTime), txt('.pager'));
  audit('conversions');

  // links
  ok('links view', await go('#/links', '#l-builder [data-out]'), $('#l-builder [data-out]') && $('#l-builder [data-out]').value);
  ok('links: quick copy list', $$('[data-ql]').length === 7);
  change($('#l-offer'), $('#l-offer').options[2].value);
  ok('links: switching offer updates link', new RegExp('o=' + $('#l-offer').value).test($('#l-builder [data-out]').value));
  audit('links');

  // more menu (mobile)
  $('#tab-more').click();
  ok('"Ещё" sheet with conversions/profile/lang/logout', await waitFor(() => $('.sheet-menu')) && $$('.sheet-menu [data-menu]').length === 2 && !!$('#menu-logout') && !!$('.sheet-menu .langs'));
  $('.sheet-menu [data-close]').click();

  // account
  ok('account view', await go('#/account', '#profile'), txt('#profile'));
  ok('account: no API key block', !/ключ|key|кілт/i.test(txt('#view')));
  audit('account');
  $('#view [data-lang="kk"]').click();
  ok('lang switch inside app (kk)', await waitFor(() => /Профиль/.test(txt('#view h1')) && /Шолу/.test(txt('.tabbar')) && $('#view [data-lang="en"]')), txt('.tabbar'));
  audit('account kk');
  $('#view [data-lang="en"]').click();
  ok('lang switch inside app (en)', await waitFor(() => /Overview/.test(txt('.tabbar')) && $('#view [data-lang="ru"]')));
  audit('account en');
  $('#view [data-lang="ru"]').click();
  await waitFor(() => /Обзор/.test(txt('.tabbar')) && $('#logout2'));

  // logout + registration
  $('#logout2').click();
  ok('logout -> auth', await waitFor(() => $('#auth-form')));
  $('[data-mode="register"]').click(); await sleep(30);
  let f = $('#auth-form');
  submit(f);
  ok('register: validation error message', await waitFor(() => /Введите имя/.test(txt('#auth-err'))), txt('#auth-err'));
  f.elements.firstName.value = 'Aidar'; f.elements.lastName.value = 'S'; f.elements.email.value = 'smoke' + Date.now() + '@ex.com';
  f.elements.password.value = 'longpass1'; f.elements.mobile.value = '+77001112233';
  f.elements.country.value = f.elements.country.options[1].value; f.elements.imValue.value = '@aidar';
  ok('country option value english + flag in label', f.elements.country.options[1].value === 'Kazakhstan' && /\u{1F1F0}\u{1F1FF}/u.test(f.elements.country.options[1].textContent));
  submit(f);
  ok('register -> pending notice', await waitFor(() => /Аккаунт создан/.test(txt('.note-info') || '')), txt('.note-info'));
  audit('register');

  ok('no inline style attributes in any rendered view', styleAudit.length === 0, styleAudit.join(' | '));
  ok('no runtime errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SMOKE CRASH', e); console.log(errors); process.exit(1); });
