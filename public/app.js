(() => {
  'use strict';

  /* ───────────── basics ───────────── */
  const I = window.I18N;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LANGS = [['ru', 'РУС']];

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
  };

  const lang = 'ru';

  function t(key, vars) {
    let s = I[lang][key] ?? I.ru[key] ?? key;
    if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  }
  const hasKey = (k) => Object.prototype.hasOwnProperty.call(I[lang], k);

  const SERIES = ['earnings', 'clicks', 'conversions'];
  const state = {
    me: null, range: null, currency: 'USD', approved: null, daily: null, dash: null,
    series: { earnings: true, clicks: true, conversions: true }, dtab: 'offers', onSearch: null,
  };

  /* ───────────── тема: только светлая ───────────── */
  // Платформа работает только в светлой теме.
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', 'light');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', '#F4F5F7');
  }
  applyTheme();

  const LOGO = `<svg class="logo-svg" aria-hidden="true" focusable="false" viewBox="0 0 40 40"><rect width="40" height="40" rx="11" fill="#111827"/><path d="M9 15h15l6-7" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M25 8h5v5" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 16v15" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/><circle cx="29.5" cy="29" r="2.8" fill="#E5604D"/></svg>`;

  /* ───────────── icons (inline SVG, attributes only — CSP-safe) ───────────── */
  const P = {
    dashboard: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
    logo: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 21a2.2 2.2 0 0 0 4 0"/>',
    offers: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
    stats: '<path d="M5 20v-8M12 20V5M19 20v-5M3 20h18"/>',
    links: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
    wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><path d="M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5z"/><circle cx="16" cy="13.5" r="1.2"/>',
    finance: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><path d="M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5z"/><circle cx="16" cy="13.5" r="1.2"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    conversions: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.8"/>',
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    logout: '<path d="M14 4h5v16h-5"/><path d="M9 8l-4 4 4 4M5 12h11"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  };
  const ico = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${P[n] || ''}</svg>`;

  /* ───────────── formatting ───────────── */
  const locale = () => ({ kk: 'kk-KZ', ru: 'ru-RU', en: 'en-US' }[lang]);
  const fmtN = (n) => new Intl.NumberFormat(locale()).format(n || 0);
  const fmtP = (n) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 2 }).format(n || 0);
  const compact = (n) => new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
  function fmtMoney(n, cur) {
    try {
      return new Intl.NumberFormat(locale(), { style: 'currency', currency: cur || state.currency || 'USD' }).format(n || 0);
    } catch {
      // нестандартный код валюты из API: оставляем только безопасные символы
      const c = String(cur || '').replace(/[^\p{L}\p{N}$€₸₽ ]/gu, '').slice(0, 8);
      return fmtN(n) + (c ? ' ' + c : '');
    }
  }
  const money = (n) => fmtMoney(n, state.currency);
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const shortDate = (s) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;

  function flag(code) {
    const c = String(code || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) return '';
    return String.fromCodePoint(...[...c].map((ch) => 0x1f1a5 + ch.charCodeAt(0)));
  }
  function regionName(code, l = lang) {
    if (!/^[A-Z]{2}$/i.test(String(code || ''))) return String(code || '');
    try { return new Intl.DisplayNames([l], { type: 'region' }).of(String(code).toUpperCase()) || code; } catch { return code; }
  }
  const geoChip = (c, cls = '') => `<span class="geo ${cls}" title="${esc(regionName(c))}"><span class="flag" aria-hidden="true">${flag(c)}</span>${esc(String(c).toUpperCase())}</span>`;

  /* ───────────── period ───────────── */
  const PRESETS = ['today', 'yesterday', '7d', '30d', 'month', 'last_month', '3m'];
  function presetRange(p) {
    const now = new Date();
    const to = ymd(now);
    const back = (days) => { const d = new Date(now); d.setDate(d.getDate() - days); return ymd(d); };
    if (p === 'today') return { from: to, to, preset: p };
    if (p === 'yesterday') { const y = back(1); return { from: y, to: y, preset: p }; }
    if (p === '7d') return { from: back(6), to, preset: p };
    if (p === '3m') return { from: back(89), to, preset: p };
    if (p === 'month') return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to, preset: p };
    if (p === 'last_month') {
      return { from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)), preset: p };
    }
    return { from: back(29), to, preset: '30d' };
  }
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function loadRange() {
    try {
      const v = JSON.parse(store.get('wm.range') || 'null');
      if (v && PRESETS.includes(v.preset)) return presetRange(v.preset);
      if (v && DATE_RE.test(v.from) && DATE_RE.test(v.to) && v.from <= v.to) return { from: v.from, to: v.to, preset: null };
    } catch { /* ignore */ }
    return presetRange('30d');
  }
  function setRange(r) {
    state.range = r;
    store.set('wm.range', JSON.stringify(r.preset ? { preset: r.preset } : { from: r.from, to: r.to }));
  }
  state.range = loadRange();

  /* ───────────── api ───────────── */
  async function api(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'fetch', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      const e = new Error('network'); e.code = 'network'; throw e;
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.status === 401 && state.me && path !== '/api/auth/login') {
      state.me = null;
      renderAuth('login', t('err_unauthorized'));
    }
    if (!res.ok) {
      const e = new Error((data && data.message) || 'error');
      e.code = (data && data.error) || 'server_error';
      e.status = res.status;
      throw e;
    }
    return data;
  }
  const errText = (e) => (e && hasKey('err_' + e.code) ? t('err_' + e.code) : t('err_server_error'));

  function toast(msg, kind = 'ok') {
    const box = $('#toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.innerHTML = ico(kind === 'err' ? 'alert' : kind === 'info' ? 'send' : 'check') + `<span>${esc(msg)}</span>`;
    box.append(el);
    setTimeout(() => el.remove(), kind === 'err' ? 5200 : 3200);
  }

  /* ───────────── shared components ───────────── */


  function periodBar() {
    const r = state.range;
    const custom = !r.preset;
    return `<div class="period" role="group" aria-label="${esc(t('period'))}">
      <div class="period-chips">${PRESETS.map(
        (p) => `<button type="button" class="chip" data-preset="${p}" aria-pressed="${r.preset === p}">${t('r_' + p)}</button>`
      ).join('')}<button type="button" class="chip chip-cal" data-custom aria-expanded="${custom}" aria-controls="period-custom" aria-pressed="${custom}">${ico('calendar')}<span>${custom ? `${shortDate(r.from)}–${shortDate(r.to)}` : t('r_custom')}</span></button></div>
      <div class="period-custom" id="period-custom" ${custom ? '' : 'hidden'}>
        <label class="field field-inline"><span>${t('r_from')}</span><input id="r-from" class="input" type="date" value="${esc(r.from)}" max="${esc(ymd(new Date()))}"></label>
        <label class="field field-inline"><span>${t('r_to')}</span><input id="r-to" class="input" type="date" value="${esc(r.to)}" max="${esc(ymd(new Date()))}"></label>
      </div>
    </div>`;
  }
  function bindPeriod(onChange) {
    $$('[data-preset]').forEach((b) => { b.onclick = () => { setRange(presetRange(b.dataset.preset)); onChange(); }; });
    const cb = $('[data-custom]');
    if (cb) cb.onclick = () => {
      const box = $('#period-custom');
      const open = box.hidden;
      box.hidden = !open;
      cb.setAttribute('aria-expanded', String(open));
      if (open) $('#r-from').focus();
    };
    const apply = () => {
      let from = $('#r-from').value, to = $('#r-to').value;
      if (!from || !to) return;
      if (from > to) [from, to] = [to, from];
      setRange({ from, to, preset: null });
      onChange();
    };
    $('#r-from').onchange = apply;
    $('#r-to').onchange = apply;
  }

  const emptyBlock = (title, hint, cta, icon = 'search') =>
    `<div class="empty">${ico(icon, 'empty-ico')}<p class="empty-title">${esc(title)}</p>${hint ? `<p class="empty-hint">${esc(hint)}</p>` : ''}${cta || ''}</div>`;

  const errorBlock = (e, retryId) =>
    `<div class="empty empty-err" role="alert">${ico('alert', 'empty-ico')}<p class="empty-title">${esc(errText(e))}</p><button class="btn" type="button" id="${retryId}">${t('retry')}</button></div>`;

  const pager = (prefix, page, pages) => pages > 1
    ? `<nav class="pager" aria-label="${esc(t('page_of', { p: page, n: pages }))}"><button class="btn" type="button" id="${prefix}-prev" ${page <= 1 ? 'disabled' : ''}>${t('back')}</button><span class="pager-pos">${t('page_of', { p: page, n: pages })}</span><button class="btn" type="button" id="${prefix}-next" ${page >= pages ? 'disabled' : ''}>${t('next')}</button></nav>`
    : '';

  function copyText(text) {
    if (!text) return;
    const done = () => { store.set('wm.copied', '1'); toast(t('copied')); };
    const fail = () => toast(t('copy_failed'), 'err');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done, fail));
    } else fallbackCopy(text, done, fail);
  }
  function fallbackCopy(text, done, fail) {
    const ta = document.createElement('textarea');
    ta.className = 'clip-helper';
    ta.value = text;
    ta.setAttribute('readonly', '');
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    (ok ? done : fail)();
  }

  /* ───────────── sheet (bottom sheet on phones, side drawer on desktop) ───────────── */
  let sheet = null;
  function openSheet({ label, html, kind = 'side' }) {
    closeSheet();
    const opener = document.activeElement;
    const ov = document.createElement('div');
    ov.className = 'overlay';
    const box = document.createElement('section');
    box.className = 'sheet sheet-' + kind;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', label);
    box.innerHTML = `<div class="sheet-grip" aria-hidden="true"></div>${html}`;
    document.body.append(ov, box);
    document.body.classList.add('locked');
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
      if (e.key === 'Tab') {
        const f = $$('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex="0"]', box).filter((x) => !x.closest('[hidden]'));
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    ov.onclick = closeSheet;
    sheet = { ov, box, onKey, opener };
    $$('[data-close]', box).forEach((b) => { b.onclick = closeSheet; });
    const c = $('[data-close]', box);
    if (c) c.focus();
    return box;
  }
  function closeSheet() {
    if (!sheet) return;
    const { ov, box, onKey, opener } = sheet;
    sheet = null;
    ov.remove(); box.remove();
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('locked');
    if (opener && document.body.contains(opener) && opener.focus) opener.focus();
  }

  /* ───────────── offer helpers ───────────── */
  const OP = { is_equal: '=', not_equal: '≠', contains: '∋', not_contains: '∌' };
  const pretty = (s) => String(s || '').replace(/_/g, ' ');
  const initials = (name) => (String(name).trim().match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
  const MODELS = ['CPA', 'CPL', 'CPI', 'CPS'];
  const modelBadge = (m) => {
    const M = String(m || '').toUpperCase();
    if (!M) return '';
    const known = MODELS.includes(M);
    return `<span class="model model-${known ? M.toLowerCase() : 'other'}"${known ? ` title="${esc(t('model_' + M))}"` : ''}>${esc(M)}</span>`;
  };
  const logoTile = (o, cls = '') => `<span class="logo ${cls}" aria-hidden="true">${o.logo ? `<img src="${esc(o.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(initials(o.name))}</span>`;

  function bestPayout(o) {
    const prices = (o.payouts || []).map((p) => p.price).filter((x) => x > 0);
    const max = Math.max(o.price || 0, ...prices, 0);
    const varies = new Set([o.price, ...prices].filter((x) => x > 0)).size > 1;
    const cur = ((o.payouts || []).find((p) => p.price === max) || {}).currency || o.currency;
    return { value: max, varies, currency: cur };
  }
  const payText = (o) => {
    const b = bestPayout(o);
    const m = fmtMoney(b.value, b.currency);
    return b.varies ? t('upto', { v: m }) : m;
  };

  function statusOf(o) {
    if (o.access === 'pending' && o.requested) return { cls: 'requested', label: t('access_requested'), note: t('note_requested') };
    if (o.access === 'pending') return { cls: 'pending', label: t('access_pending'), note: t('note_pending') };
    if (o.access === 'approved') return { cls: 'approved', label: t('access_approved'), note: '' };
    if (o.access === 'open') return { cls: 'open', label: t('access_open'), note: t('note_open') };
    return { cls: 'rejected', label: t('access_rejected'), note: t('note_rejected') };
  }
  const statusPill = (o) => { const s = statusOf(o); return `<span class="status st-${s.cls}">${esc(s.label)}</span>`; };

  const SUB_MORE = ['aff_sub2', 'aff_sub3', 'aff_sub4', 'aff_sub5', 'sub_aff_id', 'aff_click_id'];
  const SOURCES = ['Instagram', 'TikTok', 'YouTube', 'Telegram', 'Facebook', 'Google'];
  const subLabel = (f) => (f.startsWith('aff_sub') ? f : t('p_' + f));
  const subField = (f) => `<label class="field"><span>${esc(subLabel(f))}</span><input class="input input-mono" data-param="${f}" maxlength="100" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text"></label>`;

  // Конструктор для блогеров и рекламодателей: выбрал площадку, назвал кампанию, скопировал ссылку.
  function builderHTML(impressionUrl) {
    return `<div class="builder" data-builder>
      <div class="builder-out">
        <label class="field"><span>${t('tracking_link')}</span><textarea class="input input-mono link-out" data-out readonly rows="3"></textarea></label>
        <button class="btn btn-gold btn-wide" type="button" data-copy>${ico('copy')}<span>${t('copy_link')}</span></button>
      </div>
      <div class="field"><span>${t('lb_where')}</span>
        <div class="chiprow" role="group" aria-label="${esc(t('lb_where'))}">${SOURCES.map((s) => `<button type="button" class="chip" data-src="${s.toLowerCase()}" aria-pressed="false">${s}</button>`).join('')}</div>
        <input type="hidden" data-param="source" value="">
      </div>
      <label class="field"><span>${t('lb_campaign')}</span><input class="input" data-param="aff_sub1" maxlength="100" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(t('lb_campaign_ph'))}"><small class="hint">${t('lb_campaign_hint')}</small></label>
      <details class="more-params"><summary>${t('more_params')}</summary><div class="sub-grid">${SUB_MORE.map(subField).join('')}</div></details>
      ${impressionUrl ? `<label class="field"><span>${t('impression_link')}</span><div class="copy-line"><input class="input input-mono" readonly value="${esc(impressionUrl)}" data-imp><button class="btn btn-icon" type="button" data-copy-imp aria-label="${esc(t('copy'))}">${ico('copy')}</button></div></label>` : ''}
      <p class="hint">${t('link_help')}</p>
    </div>`;
  }

  function bindBuilder(root, baseUrl) {
    const out = $('[data-out]', root);
    const update = () => {
      const parts = $$('[data-param]', root)
        .map((i) => [i.dataset.param, i.value.trim()])
        .filter(([, v]) => v)
        // keep {macros} readable so traffic sources can substitute them
        .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v).replace(/%7B/gi, '{').replace(/%7D/gi, '}'));
      out.value = baseUrl + (parts.length ? (baseUrl.includes('?') ? '&' : '?') + parts.join('&') : '');
    };
    $$('[data-param]', root).forEach((i) => i.addEventListener('input', update));
    const src = $('[data-param="source"]', root);
    $$('[data-src]', root).forEach((b) => {
      b.onclick = () => {
        const on = b.getAttribute('aria-pressed') !== 'true';
        $$('[data-src]', root).forEach((x) => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', String(on));
        src.value = on ? b.dataset.src : '';
        update();
      };
    });
    $('[data-copy]', root).onclick = () => copyText(out.value);
    out.onfocus = () => out.select();
    const ci = $('[data-copy-imp]', root);
    if (ci) ci.onclick = () => copyText($('[data-imp]', root).value);
    update();
    return () => out.value;
  }

  async function requestAccess(offer, btn) {
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    try {
      const r = await api('/api/offers/request', { method: 'POST', body: { offerIds: [offer.id] } });
      const res = r && r.result ? r.result[offer.id] : '';
      if (res === 'pending') {
        offer.access = 'pending';
        offer.requested = true;
        toast(t('req_pending'), 'info');
        return true;
      }
      toast(t('req_not_allowed'), 'err');
      return false;
    } catch (e) {
      toast(errText(e), 'err');
      return false;
    } finally {
      if (btn && document.body.contains(btn)) { btn.disabled = false; btn.classList.remove('is-busy'); }
    }
  }

  function offerSheetHTML(o) {
    const s = statusOf(o);
    const payoutRows = (o.payouts.length ? o.payouts : [{ price: o.price, model: o.model, currency: o.currency, conditions: [] }])
      .map((p) => `<li class="payout-row"><span class="payout-sum num">${fmtMoney(p.price, p.currency || o.currency)}</span>${modelBadge(p.model)}<span class="payout-cond">${p.conditions.length
        ? p.conditions.map((c) => `<span class="tag">${esc(pretty(c.field))} ${esc(OP[c.op] || pretty(c.op))} ${c.field === 'country' ? geoChip(c.value, 'geo-sm') : esc(c.value)}</span>`).join('')
        : `<span class="muted">${t('any_conditions')}</span>`}</span></li>`).join('');

    const tags = (arr) => arr.map((x) => `<span class="tag">${esc(x)}</span>`).join('');
    const targeting = [];
    if (o.geo.allow.length) targeting.push([`${t('geo')}, ${t('allowed')}`, o.geo.allow.map((c) => geoChip(c)).join('')]);
    if (o.geo.block.length) targeting.push([`${t('geo')}, ${t('blocked')}`, o.geo.block.map((c) => geoChip(c, 'geo-block')).join('')]);
    if (o.device.length) targeting.push([t('devices'), tags(o.device)]);
    if (o.os.length) targeting.push([t('os'), tags(o.os)]);
    if (o.browser.length) targeting.push([t('browsers'), tags(o.browser)]);

    let access = '';
    let foot = '';
    if (o.access === 'approved' && o.trackingUrl) {
      access = `<section class="sec sec-link" id="sec-link"><h3>${t('link_builder')}</h3>${builderHTML(o.impressionUrl)}</section>`;
      foot = `<button class="btn btn-gold btn-wide" type="button" data-foot-copy>${ico('copy')}<span>${t('copy_link')}</span></button>`;
    } else if (o.access === 'open') {
      access = `<section class="sec"><p class="note note-open">${esc(s.note)}</p></section>`;
      foot = `<button class="btn btn-primary btn-wide" type="button" data-request>${ico('send')}<span>${t('request_access')}</span></button>`;
    } else if (s.note) {
      access = `<section class="sec"><p class="note note-${s.cls}" data-access-note>${ico(o.access === 'pending' ? 'clock' : 'alert')}<span>${esc(s.note)}</span></p></section>`;
    }

    return `
      <header class="sheet-head">
        ${logoTile(o, 'logo-lg')}
        <div class="sheet-title">
          <h2>${esc(o.name)}</h2>
          <p class="sheet-sub"><span class="muted">ID ${esc(o.id)}</span>${statusPill(o)}</p>
        </div>
        <button class="btn btn-icon btn-ghost" type="button" data-close aria-label="${esc(t('close'))}">${ico('close')}</button>
      </header>
      <div class="sheet-body">
        <section class="paycard">
          <p class="paycard-label">${t('payout')}</p>
          <p class="paycard-sum">${esc(payText(o))}</p>
          <p class="paycard-model">${modelBadge(o.model)}${MODELS.includes(String(o.model).toUpperCase()) ? `<span>${t('model_' + String(o.model).toUpperCase())}</span>` : ''}</p>
          ${o.geo.allow.length ? `<p class="paycard-geo">${o.geo.allow.map((c) => geoChip(c, 'geo-dark')).join('')}</p>` : ''}
        </section>
        ${access}
        <section class="sec"><h3>${t('payouts')}</h3><ul class="payouts">${payoutRows}</ul></section>
        ${o.description ? `<section class="sec"><h3>${t('description')}</h3><p class="pre">${esc(o.description)}</p></section>` : ''}
        ${o.kpi ? `<section class="sec"><h3>KPI</h3><p class="pre">${esc(o.kpi)}</p></section>` : ''}
        ${targeting.length ? `<section class="sec"><h3>${t('targeting')}</h3><dl class="kv">${targeting.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl></section>` : ''}
        ${o.caps.length ? `<section class="sec"><h3>${t('caps')}</h3><ul class="caps">${o.caps.map(
          (c) => `<li><span>${esc(pretty(c.type))}${c.event ? ` <span class="tag">${esc(c.event)}</span>` : ''}</span><span class="muted">${esc(pretty(c.period))}</span><strong class="num">${esc(fmtN(c.value))}</strong></li>`
        ).join('')}</ul></section>` : ''}
        ${o.events.length ? `<section class="sec"><h3>${t('events')}</h3><p class="tags">${o.events.map((e) => `<span class="tag">${esc(e.name || e.token)}</span>`).join('')}</p></section>` : ''}
        ${o.creatives.length ? `<section class="sec"><h3>${t('creatives')}</h3><div class="creatives">${o.creatives.map(
          (c) => `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${c.type === 'image' ? `<img src="${esc(c.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span>${esc(c.type)}</span></a>`
        ).join('')}</div></section>` : ''}
        ${o.previewUrl || o.end ? `<section class="sec sec-meta">${o.previewUrl ? `<a class="link-ext" href="${esc(o.previewUrl)}" target="_blank" rel="noopener noreferrer">${ico('external')}<span>${t('preview')}</span></a>` : ''}${o.end ? `<p class="muted">${t('valid_until')}: ${esc(String(o.end).slice(0, 10))}</p>` : ''}</section>` : ''}
      </div>
      ${foot ? `<footer class="sheet-foot">${foot}</footer>` : ''}`;
  }

  function openOffer(o, { onChange, focusBuilder } = {}) {
    const box = openSheet({ label: o.name, html: offerSheetHTML(o), kind: 'side' });
    const b = $('[data-builder]', box);
    if (b) {
      const getLink = bindBuilder(b, o.trackingUrl);
      const fc = $('[data-foot-copy]', box);
      if (fc) fc.onclick = () => copyText(getLink());
      if (focusBuilder) {
        $('#sec-link', box).scrollIntoView({ block: 'start' });
        const first = $('[data-param="aff_sub1"]', box);
        if (first && window.matchMedia && window.matchMedia('(hover: hover)').matches) first.focus();
      }
    }
    const rq = $('[data-request]', box);
    if (rq) rq.onclick = async () => {
      if (await requestAccess(o, rq)) {
        if (onChange) onChange();
        if (sheet && sheet.box === box) openOffer(o, { onChange });
      }
    };
  }

  /* ───────────── shell & routing ───────────── */
  // Боковое меню: пункты верхнего уровня и подпункты (серые, с отступом) — как в референсе.
  const NAV_TREE = [['dashboard'], ['offers'], ['stats', ['conversions']], ['finance'], ['account']];
  const TABS = ['dashboard', 'offers', 'stats', 'finance'];

  function renderShell() {
    const me = state.me;
    document.title = t('brand');
    const navItem = (n, sub) => `<a href="#/${n}" data-nav="${n}" class="nav-item${sub ? ' nav-subitem' : ''}" title="${esc(t('nav_' + n))}">${ico(n)}<span class="nav-label">${t('nav_' + n)}</span></a>`;
    $('#app').innerHTML = `
      <a class="skip" href="#view">${t('skip')}</a>
      <div class="shell">
        <aside class="side">
          <a class="side-logo" href="#/dashboard" aria-label="${esc(t('brand'))}" title="${esc(t('brand'))}"><span class="mark" aria-hidden="true">${LOGO}</span><span class="side-brand">${t('brand')}</span></a>
          <nav class="rail-nav" aria-label="${esc(t('main_nav'))}">${NAV_TREE.map(([n, subs]) => navItem(n) + (subs ? `<div class="nav-sub">${subs.map((s) => navItem(s, true)).join('')}</div>` : '')).join('')}</nav>
          <div class="side-foot">
            ${me.demo ? `<p class="demo-tag" title="${esc(t('demo_banner'))}"><span>${t('demo_banner')}</span></p>` : ''}
            <div class="side-row"><p class="who" title="${esc(me.email)}"><span class="who-mail">${esc(me.email)}</span><span class="who-id">ID ${esc(me.id)}</span></p></div>
            <button class="nav-item side-logout" type="button" id="logout" title="${esc(t('logout'))}">${ico('logout')}<span class="nav-label">${t('logout')}</span></button>
          </div>
        </aside>
        <header class="topbar">
          <a class="top-logo mark" href="#/dashboard" aria-label="${esc(t('brand'))}">${LOGO}</a>
          <form class="top-search" id="top-search" role="search" autocomplete="off">
            <label class="pill-search">${ico('search')}<span class="sr">${t('search_offers')}</span><input id="top-q" type="search" placeholder="${esc(t('search_ph'))}" enterkeyhint="search" autocapitalize="off" spellcheck="false"></label>
          </form>
          <div class="top-actions">
            ${me.demo ? `<span class="demo-pill" title="${esc(t('demo_banner'))}">DEMO</span>` : ''}
            <button class="icon-btn" type="button" id="top-bell" aria-label="${esc(t('notifications'))}" aria-haspopup="dialog">${ico('bell')}</button>
            <button class="avatar" type="button" id="top-more" aria-label="${esc(t('nav_more'))}" aria-haspopup="dialog">${esc(initials(me.email))}</button>
          </div>
        </header>
        <main class="main" id="view" tabindex="-1"></main>
        <nav class="tabbar" aria-label="${esc(t('main_nav'))}">
          ${TABS.map((n) => `<a href="#/${n}" data-nav="${n}">${ico(n)}<span>${t('nav_' + n)}</span></a>`).join('')}
          <button type="button" id="tab-more" data-nav="more" aria-haspopup="dialog">${ico('more')}<span>${t('nav_more')}</span></button>
        </nav>
      </div>`;
    $('#logout').onclick = logout;
    $('#tab-more').onclick = openMore;
    $('#top-more').onclick = openMore;
    $('#top-bell').onclick = openNotifications;
    const q = $('#top-q');
    q.addEventListener('input', () => { if (currentView === 'offers' && state.onSearch) state.onSearch(q.value.trim()); });
    $('#top-search').onsubmit = (e) => {
      e.preventDefault();
      if (currentView === 'offers' && state.onSearch) state.onSearch(q.value.trim());
      else location.hash = '#/offers';
    };
  }

  function openMore() {
    const me = state.me;
    const box = openSheet({
      label: t('nav_more'),
      kind: 'menu',
      html: `<header class="sheet-head sheet-head-menu"><span class="avatar avatar-lg" aria-hidden="true">${esc(initials(me.email))}</span><div class="sheet-title"><h2>${esc(me.email)}</h2><p class="sheet-sub muted">ID ${esc(me.id)}</p></div>
          <button class="btn btn-icon btn-ghost" type="button" data-close aria-label="${esc(t('close'))}">${ico('close')}</button></header>
        <nav class="menu-list" aria-label="${esc(t('nav_more'))}">
          ${['conversions', 'account'].map((n) => `<a href="#/${n}" data-menu>${ico(n)}<span>${t('nav_' + n)}</span></a>`).join('')}
        </nav>
        <button class="btn btn-wide btn-danger-soft" type="button" id="menu-logout">${ico('logout')}<span>${t('logout')}</span></button>`,
    });
    $$('[data-menu]', box).forEach((a) => { a.addEventListener('click', () => closeSheet()); });
    $('#menu-logout', box).onclick = logout;
  }

  async function openNotifications() {
    const box = openSheet({
      label: t('notifications'),
      kind: 'side',
      html: `<header class="sheet-head"><div class="sheet-title"><h2>${t('notifications')}</h2><p class="sheet-sub muted">${t('notif_hint')}</p></div>
          <button class="btn btn-icon btn-ghost" type="button" data-close aria-label="${esc(t('close'))}">${ico('close')}</button></header>
        <div class="sheet-body" id="notif" aria-busy="true"><div class="sk sk-row"></div><div class="sk sk-row"></div></div>`,
    });
    const alive = () => sheet && sheet.box === box;
    const list = $('#notif', box);
    try {
      const d = await api('/api/offers?access=pending');
      if (!alive()) return;
      list.removeAttribute('aria-busy');
      list.innerHTML = d.rows.length
        ? `<ul class="notif-list">${d.rows.map((o) => `<li><button type="button" class="notif-item" data-notif="${esc(o.id)}">${logoTile(o)}<span class="notif-text"><span class="cell-main">${esc(o.name)}</span><span class="cell-sub">${esc(statusOf(o).note)}</span></span>${statusPill(o)}</button></li>`).join('')}</ul>`
        : `<div class="sec">${emptyBlock(t('notif_empty'), '', '', 'bell')}</div>`;
      $$('[data-notif]', list).forEach((b) => {
        b.onclick = () => { const o = d.rows.find((x) => x.id === b.dataset.notif); if (o) openOffer(o); };
      });
    } catch (e) {
      if (!alive()) return;
      list.removeAttribute('aria-busy');
      list.innerHTML = errorBlock(e, 'retry-n');
      $('#retry-n', list).onclick = openNotifications;
    }
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    state.me = null; state.approved = null;
    closeSheet();
    renderAuth('login');
  }

  const SKELETON = {
    dashboard: '<div class="sk sk-period"></div><div class="sk sk-strip"></div><div class="sk sk-chart"></div><div class="sk sk-table"></div>',
    offers: '<div class="sk sk-title"></div><div class="sk sk-input"></div><div class="sk sk-row"></div><div class="sk sk-row"></div><div class="sk sk-row"></div>',
    def: '<div class="sk sk-period"></div><div class="sk sk-title"></div><div class="sk sk-table"></div>',
  };

  let viewTok = 0;
  let currentView = '';
  async function render(name, opts = {}) {
    const viewFn = VIEWS[name];
    const tok = ++viewTok;
    const alive = () => tok === viewTok;
    const main = $('#view');
    if (!main) return;
    if (!opts.keep) main.innerHTML = `<div class="skeletons" aria-busy="true" aria-label="${esc(t('loading'))}">${SKELETON[name] || SKELETON.def}</div>`;
    else main.setAttribute('aria-busy', 'true');
    try {
      await viewFn(alive);
    } catch (e) {
      if (!alive()) return;
      main.innerHTML = `<div class="page-head"><h1>${t('nav_' + name)}</h1></div>${errorBlock(e, 'retry')}`;
      $('#retry').onclick = () => render(name);
    } finally {
      if (alive()) main.removeAttribute('aria-busy');
    }
  }

  function route() {
    if (!state.me) return;
    const raw = location.hash.replace(/^#\/?/, '').split('/')[0] || 'dashboard';
    if (raw === 'links') { location.replace('#/offers'); return; } // ссылки получают внутри оффера
    const name = VIEWS[raw] ? raw : 'dashboard';
    $$('[data-nav]').forEach((a) => {
      const on = a.dataset.nav === name || (a.dataset.nav === 'more' && (name === 'conversions' || name === 'account'));
      if (a.tagName === 'A') a.setAttribute('aria-current', on ? 'page' : 'false');
      a.classList.toggle('is-on', on);
    });
    closeSheet();
    const changed = currentView && currentView !== name;
    currentView = name;
    window.scrollTo(0, 0);
    render(name).then(() => { if (changed) { const m = $('#view'); if (m) m.focus({ preventScroll: true }); } });
  }

  function renderApp() {
    if (!state.me) return renderAuth('login');
    currentView = '';
    renderShell();
    route();
  }

  /* ───────────── auth ───────────── */
  const COUNTRIES = ['KZ', 'UZ', 'KG', 'TJ', 'TM', 'RU', 'BY', 'UA', 'AZ', 'AM', 'GE', 'TR', 'AE', 'DE', 'US'];
  let authMode = 'login';

  function renderAuth(mode = 'login', flash = '') {
    closeSheet();
    authMode = mode;
    document.documentElement.lang = lang;
    document.title = t('brand');
    const isLogin = mode === 'login';
    const art = `<svg class="auth-art" viewBox="0 0 320 90" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path class="line line-clicks" d="M0 62 L22 58 L44 64 L66 50 L88 54 L110 44 L132 52 L154 40 L176 46 L198 34 L220 42 L242 30 L264 36 L286 24 L308 30 L320 22"/>
            <path class="line line-conversions" d="M0 70 L22 72 L44 66 L66 70 L88 62 L110 66 L132 60 L154 64 L176 56 L198 60 L220 52 L242 56 L264 48 L286 52 L308 44 L320 46"/>
            <path class="line line-earnings" d="M0 54 L22 48 L44 56 L66 40 L88 46 L110 32 L132 42 L154 26 L176 36 L198 22 L220 30 L242 16 L264 26 L286 12 L308 20 L320 10"/>
            <circle class="end end-earnings" cx="316" cy="12" r="4"/>
          </svg>`;
    $('#app').innerHTML = `
      <div class="land">
        <header class="land-nav">
          <div class="brandmark"><span class="mark" aria-hidden="true">${LOGO}</span><span>${t('brand')}</span></div>
          <nav class="land-links" aria-label="${esc(t('main_nav'))}">
            <button type="button" class="land-link" data-jump="i-plain">${t('plain_nav')}</button>
            <button type="button" class="land-link" data-jump="i-how">${t('info_how_title')}</button>
            <button type="button" class="land-link" data-jump="i-gl">${t('gl_title')}</button>
            <button type="button" class="land-link" data-jump="i-faq">${t('info_faq_title')}</button>
          </nav>
          <div class="land-tools"></div>
        </header>
        <section class="land-hero">
          <div class="hero-copy">
            <span class="eyebrow"><span class="eyebrow-dot" aria-hidden="true"></span>${t('hero_eyebrow')}</span>
            <h1 class="land-title">${t('auth_title')}</h1>
            <p class="land-sub">${t('auth_sub')}</p>
            <ul class="land-points">
              <li><span class="auth-models">${MODELS.map(modelBadge).join('')}</span><span>${t('auth_p1')}</span></li>
              <li><span class="pt-ico">${ico('links')}</span><span>${t('auth_p2')}</span></li>
              <li><span class="pt-ico">${ico('stats')}</span><span>${t('auth_p3')}</span></li>
            </ul>
          </div>
          <div class="auth-card">
            <div class="tabs" role="tablist">
              <button class="tab" role="tab" type="button" data-mode="login" aria-selected="${isLogin}">${t('login')}</button>
              <button class="tab" role="tab" type="button" data-mode="register" aria-selected="${!isLogin}">${t('register')}</button>
            </div>
            ${flash ? `<p class="note note-info" role="status">${esc(flash)}</p>` : ''}
            ${isLogin ? loginForm() : registerForm()}
          </div>
        </section>
        <section class="land-preview" aria-hidden="true">
          <div class="pcard pcard-main">
            <div class="pcard-top"><span class="pcard-label">${t('earnings')}</span><span class="pcard-tag">${t('hero_example')}</span></div>
            <div class="pcard-sum num">1 248,50 $ <span class="delta up">+18,4 %</span></div>
            ${art}
          </div>
          <div class="pcard pcard-kpi"><span class="pcard-label">${t('clicks')}</span><b class="num">3 925</b><span class="delta up">+20,9 %</span></div>
          <div class="pcard pcard-kpi"><span class="pcard-label">${t('conversions')}</span><b class="num">287</b><span class="delta up">+15,2 %</span></div>
          <div class="pcard pcard-kpi"><span class="pcard-label">${t('cr')}</span><b class="num">5,6 %</b><span class="delta down">−1,4 %</span></div>
          <div class="pcard pcard-float pcard-a"><span class="pcard-dot pcard-dot-ok"></span><div><b>${t('approved')}</b><small>CPA · KZ</small></div><span class="num">+9,50 $</span></div>
        </section>
      </div>`;
    const ic = (n) => `<span class="info-ic" aria-hidden="true">${ico(n)}</span>`;
    const how = [['how1', 'account'], ['how2', 'offers'], ['how3', 'links'], ['how4', 'stats']];
    const why = [['why1', 'stats'], ['why2', 'links'], ['why3', 'conversions'], ['why4', 'offers'], ['why5', 'dashboard'], ['why6', 'check']];
    const faq = ['faq1', 'faq2', 'faq3', 'faq4'];
    $('.land').insertAdjacentHTML('beforeend', `
      <div class="auth-info">
        <section class="info-sec plain" aria-labelledby="i-plain"><h2 id="i-plain">${t('plain_title')}</h2>
          <p class="plain-text">${t('plain_text')}</p>
          <ol class="flow">${['flow1', 'flow2', 'flow3'].map((k, x) => `<li class="info-card"><span class="how-n">${x + 1}</span><h3>${t(k + '_t')}</h3><p>${t(k + '_d')}</p></li>`).join('')}</ol>
          <div class="example info-card"><h3>${t('ex_title')}</h3>
            <ul class="ex-list"><li>${t('ex1')}</li><li>${t('ex2')}</li><li>${t('ex3')}</li></ul>
            <p class="ex-total">${t('ex_total')}</p><p class="ex-note">${t('ex_note')}</p></div></section>
        <section class="info-sec" aria-labelledby="i-who"><h2 id="i-who">${t('who_title')}</h2>
          <ul class="who">${['who1', 'who2', 'who3', 'who4'].map((k) => `<li class="info-card">${ic('check')}<p>${t(k)}</p></li>`).join('')}</ul></section>
        <section class="info-sec" aria-labelledby="i-how"><h2 id="i-how">${t('info_how_title')}</h2>
          <ol class="how">${how.map(([k, n], x) => `<li class="info-card"><span class="how-n">${x + 1}</span><h3>${t(k + '_t')}</h3><p>${t(k + '_d')}</p></li>`).join('')}</ol></section>
        <section class="info-sec" aria-labelledby="i-why"><h2 id="i-why">${t('info_why_title')}</h2>
          <ul class="why">${why.map(([k, n]) => `<li class="info-card">${ic(n)}<h3>${t(k + '_t')}</h3><p>${t(k + '_d')}</p></li>`).join('')}</ul></section>
        <section class="info-sec" aria-labelledby="i-gl"><h2 id="i-gl">${t('gl_title')}</h2>
          <dl class="gloss">${['gl1', 'gl2', 'gl3', 'gl4', 'gl5'].map((k) => `<div class="info-card"><dt>${t(k + '_t')}</dt><dd>${t(k + '_d')}</dd></div>`).join('')}</dl></section>
        <section class="info-sec" aria-labelledby="i-mdl"><h2 id="i-mdl">${t('info_models_title')}</h2>
          <ul class="mdl">${['cpa', 'cpl', 'cpi', 'cps'].map((m) => `<li class="info-card">${modelBadge(m.toUpperCase())}<p>${t('mdl_' + m)}</p></li>`).join('')}</ul></section>
        <section class="info-sec" aria-labelledby="i-faq"><h2 id="i-faq">${t('info_faq_title')}</h2>
          <div class="faq">${faq.map((k) => `<details class="info-card"><summary>${t(k + '_q')}</summary><p>${t(k + '_a')}</p></details>`).join('')}</div></section>
      </div>`);
    $$('[data-jump]').forEach((b) => { b.onclick = () => { const el = document.getElementById(b.dataset.jump); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; });
    $$('[data-mode]').forEach((b) => { b.onclick = () => renderAuth(b.dataset.mode); });
    const form = $('#auth-form');
    form.onsubmit = (e) => { e.preventDefault(); (isLogin ? submitLogin : submitRegister)(form); };
    const first = $('input, select', form);
    if (first && window.matchMedia && window.matchMedia('(hover: hover)').matches) first.focus();
  }

  const loginForm = () => `
    <form class="form" id="auth-form" novalidate>
      <label class="field"><span>${t('email')}</span><input class="input" name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck="false" required></label>
      <label class="field"><span>${t('password')}</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <p class="error" id="auth-err" role="alert"></p>
      <button class="btn btn-primary btn-wide" type="submit">${t('login')}</button>
    </form>`;

  const registerForm = () => `
    <form class="form" id="auth-form" novalidate>
      <div class="form-row">
        <label class="field"><span>${t('first_name')}</span><input class="input" name="firstName" autocomplete="given-name" maxlength="60" required></label>
        <label class="field"><span>${t('last_name')}</span><input class="input" name="lastName" autocomplete="family-name" maxlength="60" required></label>
      </div>
      <label class="field"><span>${t('email')}</span><input class="input" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" required></label>
      <label class="field"><span>${t('password')}</span><input class="input" name="password" type="password" autocomplete="new-password" minlength="8" required aria-describedby="pw-hint"><small class="hint" id="pw-hint">${t('password_hint')}</small></label>
      <div class="form-row">
        <label class="field"><span>${t('phone')}</span><input class="input" name="mobile" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7" required></label>
        <label class="field"><span>${t('country')}</span><select class="input" name="country" required>
          <option value="">${t('choose')}</option>
          ${COUNTRIES.map((c) => `<option value="${esc(regionName(c, 'en'))}">${flag(c)} ${esc(regionName(c, lang))}</option>`).join('')}
        </select></label>
      </div>
      <div class="form-row">
        <label class="field"><span>${t('messenger')}</span><select class="input" name="imType">
          <option value="telegram">Telegram</option><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="skype">Skype</option><option value="other">${t('other')}</option>
        </select></label>
        <label class="field"><span>${t('messenger_handle')}</span><input class="input" name="imValue" maxlength="80" autocapitalize="off" required></label>
      </div>
      <label class="field"><span>${t('company')}</span><input class="input" name="company" maxlength="100"></label>
      <p class="error" id="auth-err" role="alert"></p>
      <button class="btn btn-primary btn-wide" type="submit">${t('register')}</button>
    </form>`;

  async function enter() {
    state.me = await api('/api/me');
    state.approved = null;
    if (!/^#\/(dashboard|offers|stats|conversions|links|account)/.test(location.hash)) location.hash = '#/dashboard';
    renderApp();
  }

  async function submitLogin(form) {
    const btn = $('button[type=submit]', form), err = $('#auth-err');
    err.textContent = ''; btn.disabled = true;
    try {
      await api('/api/auth/login', { method: 'POST', body: { email: form.elements.email.value, password: form.elements.password.value } });
      await enter();
    } catch (e) { err.textContent = errText(e); btn.disabled = false; }
  }

  async function submitRegister(form) {
    const btn = $('button[type=submit]', form), err = $('#auth-err');
    err.textContent = ''; btn.disabled = true;
    const v = (n) => form.elements[n].value.trim();
    try {
      const r = await api('/api/auth/register', {
        method: 'POST',
        body: {
          firstName: v('firstName'), lastName: v('lastName'), email: v('email'), password: form.elements.password.value,
          mobile: v('mobile'), country: v('country'), imType: v('imType'), imValue: v('imValue'), company: v('company'),
        },
      });
      if (r.pending) renderAuth('login', t('registered_pending'));
      else await enter();
    } catch (e) { err.textContent = errText(e); btn.disabled = false; }
  }

  /* ───────────── dashboard ───────────── */
  const pctFmt = (p) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 1 }).format(Math.abs(p));
  function delta(cur, prev) {
    if (!prev) return '';
    const p = (cur - prev) / prev;
    if (!Number.isFinite(p) || Math.abs(p) < 0.0005) return '';
    return `<span class="delta ${p > 0 ? 'up' : 'down'}"><span class="sr">${esc(t('vs_prev'))}: </span>${p > 0 ? '+' : '−'}${pctFmt(p)}</span>`;
  }

  function chartWidth() {
    const box = $('#chart');
    const w = box ? box.clientWidth : 0;
    return Math.round(Math.min(1200, Math.max(300, w || 640)));
  }

  // Тонкая многолинейная диаграмма: каждая линия — в % от своего пика (у метрик разные единицы).
  function trendChart(daily) {
    const W = chartWidth();
    const narrow = W < 560;
    const H = narrow ? 190 : 232, L = 4, R = narrow ? 36 : 44, T = 12, B = 26;
    const pw = W - L - R, ph = H - T - B, n = daily.length;
    const xAt = (i) => L + (n > 1 ? (pw * i) / (n - 1) : pw / 2);
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const y = (T + ph * (1 - i / 4)).toFixed(1);
      grid += `<line class="grid${i === 0 ? ' grid-base' : ''}" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="ylab" x="${W - R + 8}" y="${(+y + 4).toFixed(1)}">${i * 25}%</text>`;
    }
    const step = Math.max(1, Math.ceil(n / (narrow ? 4 : 7)));
    let xl = '';
    daily.forEach((d, i) => {
      if (i % step === 0) xl += `<text class="xlab" x="${xAt(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${shortDate(d.date)}</text>`;
    });
    let lines = '';
    SERIES.forEach((k) => {
      if (!state.series[k]) return;
      const max = Math.max(...daily.map((d) => d[k]), 0) || 1;
      const pts = daily.map((d, i) => [xAt(i), T + ph * (1 - d[k] / max)]);
      const path = pts.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
      const [lx, ly] = pts[pts.length - 1];
      lines += `<path class="line line-${k}" d="${path}"/><circle class="end end-${k}" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4"/>`;
    });
    const cw = n > 1 ? pw / (n - 1) : pw;
    let hits = '';
    daily.forEach((d, i) => {
      const x = Math.max(L, xAt(i) - cw / 2);
      const w = Math.max(1, Math.min(cw, W - R - x));
      hits += `<rect class="hit" x="${x.toFixed(1)}" y="${T}" width="${w.toFixed(1)}" height="${ph}"><title>${esc(shortDate(d.date))} — ${esc(t('earnings'))}: ${esc(money(d.earnings))}; ${esc(t('clicks'))}: ${esc(fmtN(d.clicks))}; ${esc(t('conversions'))}: ${esc(fmtN(d.conversions))}</title></rect>`;
    });
    return `<svg class="chart trend" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('trends'))}">${grid}${xl}${lines}${hits}</svg>`;
  }

  function splitBar(a, b) {
    const sum = a + b;
    const pa = sum > 0 ? (a / sum) * 100 : 0;
    return `<svg class="split" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="split-bg" width="100" height="6" rx="3"/>${sum > 0 ? `<rect class="split-b" width="100" height="6" rx="3"/><rect class="split-a" width="${pa.toFixed(2)}" height="6" rx="3"/>` : ''}</svg>`;
  }

  function ring(frac) {
    const r = 16, c = 2 * Math.PI * r;
    const f = Math.max(0, Math.min(1, frac || 0));
    return `<svg class="ring" viewBox="0 0 40 40" role="img" aria-label="${esc(t('approval_rate') + ': ' + fmtP(f))}"><circle class="ring-bg" cx="20" cy="20" r="${r}"/>${f > 0 ? `<circle class="ring-fg" cx="20" cy="20" r="${r}" stroke-dasharray="${(f * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 20 20)"/>` : ''}</svg>`;
  }

  function startChecklist(hasApproved) {
    const copied = store.get('wm.copied') === '1';
    const steps = [
      ['start_1', 'start_1_hint', hasApproved, `<a class="btn btn-primary" href="#/offers">${t('go_offers')}</a>`],
      ['start_2', 'start_2_hint', copied, hasApproved ? `<a class="btn" href="#/offers">${t('get_link')}</a>` : ''],
      ['start_3', 'start_3_hint', false, ''],
    ];
    const next = steps.findIndex((s) => !s[2]);
    return `<section class="card start" aria-labelledby="start-h">
      <h2 id="start-h">${t('start_title')}</h2>
      <ol class="steps">${steps.map(([h, hint, done, cta], i) => `<li class="step${done ? ' is-done' : ''}${i === next ? ' is-next' : ''}">
        <span class="step-n" aria-hidden="true">${done ? ico('check') : i + 1}</span>
        <div class="step-body"><p class="step-title">${t(h)}${done ? ` <span class="sr">(${t('step_done')})</span>` : ''}</p><p class="step-hint">${t(hint)}</p>${i === next && cta ? `<div class="step-cta">${cta}</div>` : ''}</div>
      </li>`).join('')}</ol>
    </section>`;
  }

  const DTABS = ['offers', 'countries', 'days'];
  function dashTableHTML(d, approved) {
    const T = d.totals;
    const quality = (x) => (!x.clicks ? 'neutral' : !x.conversions ? 'review' : x.cr >= T.cr ? 'good' : 'neutral');
    const badge = (x) => { const q = quality(x); return `<span class="badge q-${q}">${esc(t('q_' + q))}</span>`; };
    const nums = (x) => `<td class="r num">${fmtN(x.clicks)}</td><td class="r num">${fmtN(x.conversions)}</td><td class="r num">${fmtP(x.cr)}</td><td class="r num col-money">${money(x.earnings)}</td>`;
    const H = (k, cls = '') => `<th scope="col"${cls ? ` class="${cls}"` : ''}>${esc(t(k))}</th>`;
    const numHead = H('clicks', 'r') + H('conversions', 'r') + H('cr', 'r') + H('earnings', 'r');
    let head = '', body = '', rows = [];
    if (state.dtab === 'offers') {
      rows = d.topOffers;
      head = H('g_offer') + numHead + H('tracking_link') + H('quality');
      body = rows.map((o) => {
        const ap = approved.find((a) => a.id === o.key);
        return `<tr><th scope="row" class="sticky-col"><span class="cell-main">${esc(o.label || o.key)}</span><span class="cell-sub">ID ${esc(o.key)}</span></th>${nums(o)}
          <td>${ap ? `<button type="button" class="ulink" data-dcopy="${esc(o.key)}" aria-label="${esc(t('copy_link_of', { name: o.label || o.key }))}">${t('link_short')}</button>` : '<span class="muted">—</span>'}</td><td>${badge(o)}</td></tr>`;
      }).join('');
    } else if (state.dtab === 'countries') {
      rows = d.topCountries;
      head = H('g_country') + numHead + H('quality');
      body = rows.map((c) => `<tr><th scope="row" class="sticky-col"><span class="cell-main"><span class="flag" aria-hidden="true">${flag(c.key)}</span> ${esc(regionName(c.key))}</span><span class="cell-sub">${esc(c.key)}</span></th>${nums(c)}<td>${badge(c)}</td></tr>`).join('');
    } else {
      const today = ymd(new Date());
      const yest = (() => { const x = new Date(); x.setDate(x.getDate() - 1); return ymd(x); })();
      rows = [...d.daily].reverse().filter((x) => x.clicks || x.conversions).map((x) => ({ ...x, cr: x.clicks ? x.conversions / x.clicks : 0 }));
      head = H('g_date') + numHead + H('quality');
      let seenOld = false;
      body = rows.map((x) => {
        const fresh = x.date === today || x.date === yest;
        const gap = !fresh && !seenOld && rows[0] !== x;
        if (!fresh) seenOld = true;
        return `<tr class="${fresh ? 'is-fresh' : ''}${gap ? ' gap-top' : ''}"><th scope="row" class="sticky-col"><span class="cell-main num">${fresh ? `<span class="fresh-dot" aria-hidden="true"></span><span class="sr">${esc(t('fresh'))}: </span>` : ''}${esc(x.date === today ? t('r_today') : x.date === yest ? t('r_yesterday') : shortDate(x.date))}</span></th>${nums(x)}<td>${badge(x)}</td></tr>`;
      }).join('');
    }
    if (!rows.length) return emptyBlock(t('no_rows'), '', '', 'stats');
    return `<div class="table-scroll" tabindex="0" role="region" aria-label="${esc(t('dt_' + state.dtab))}"><table class="table table-dash"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  async function viewDashboard(alive) {
    const r = state.range;
    const [d, approved] = await Promise.all([
      api(`/api/dashboard?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`),
      loadApproved().catch(() => []),
    ]);
    if (!alive()) return;
    state.currency = d.currency || state.currency;
    state.daily = d.daily;
    state.dash = d;
    const T = d.totals, Pv = d.previous;
    const noData = !T.clicks && !T.conversions;
    const kpi = (label, value, dl, id = '') => `<div class="kpi"><dt>${label}</dt><dd><span class="kpi-v num"${id ? ` id="${id}"` : ''}>${value}</span>${dl || ''}</dd></div>`;
    const decided = T.approved + T.pending + T.rejected;
    const trendBtn = (p) => `<button type="button" data-trend="${p}" aria-pressed="${r.preset === p}" aria-label="${esc(t('r_' + p))}">${t('tr_' + p)}</button>`;
    const kvRow = (k, v, dl = '') => `<div><dt>${k}</dt><dd><span class="num">${v}</span>${dl}</dd></div>`;

    $('#view').innerHTML = `
      <h1 class="sr">${t('nav_dashboard')}</h1>
      ${periodBar()}
      ${d.truncated ? `<p class="note note-pending">${t('truncated_warn')}</p>` : ''}
      <div class="dash">
        <div class="dash-main">
          <section class="card kpis" aria-label="${esc(t('kpis'))}">
            <dl class="kpi-strip" id="kpis">
              ${kpi(t('earnings'), money(T.earnings), delta(T.earnings, Pv.earnings), 'kpi-earn')}
              ${kpi(t('approved_earnings'), money(T.approvedEarnings), delta(T.approvedEarnings, Pv.approvedEarnings))}
              ${kpi(t('clicks'), fmtN(T.clicks), delta(T.clicks, Pv.clicks))}
              ${kpi(t('conversions'), fmtN(T.conversions), delta(T.conversions, Pv.conversions))}
              ${kpi(t('cr'), fmtP(T.cr), delta(T.cr, Pv.cr))}
              ${kpi(t('epc'), money(T.epc), delta(T.epc, Pv.epc))}
            </dl>
          </section>
          ${noData ? `${startChecklist(approved.length > 0)}
            <div class="card">${emptyBlock(t('no_data'), t('no_data_hint'), '', 'stats')}</div>` : `
          <section class="card trends" aria-labelledby="tr-h">
            <div class="card-head">
              <h2 id="tr-h">${t('trends')}<span class="dots" aria-hidden="true">···</span></h2>
              <div class="seg seg-sm" role="group" aria-label="${esc(t('period'))}">${['7d', '30d', '3m'].map(trendBtn).join('')}</div>
            </div>
            <div class="legend" role="group" aria-label="${esc(t('trends'))}">${SERIES.map((k) => `<button type="button" class="legend-item" data-series="${k}" aria-pressed="${state.series[k]}"><span class="mk mk-${k}" aria-hidden="true"></span>${t(k)}</button>`).join('')}</div>
            <div class="chart-box" id="chart"></div>
            <p class="chart-note">${t('chart_scale')}</p>
          </section>
          <section class="card dtable" aria-label="${esc(t('top_offers'))}">
            <div class="tabs-line" role="tablist" aria-label="${esc(t('top_offers'))}">${DTABS.map((k) => `<button type="button" role="tab" class="tline" data-dtab="${k}" aria-selected="${state.dtab === k}" aria-controls="dash-table">${t('dt_' + k)}</button>`).join('')}
              <a class="link-more" href="#/stats">${t('nav_stats')}</a></div>
            <div id="dash-table" role="tabpanel"></div>
          </section>`}
        </div>
        <aside class="dash-side" aria-label="${esc(t('widgets'))}">
          <section class="wcard" aria-labelledby="w1-h">
            <div class="wcard-head"><h2 id="w1-h">${t('earnings')}<span class="dots" aria-hidden="true">···</span></h2><span class="wcard-tag">${['7d', '30d', '3m'].includes(r.preset) ? t('tr_' + r.preset) : r.preset ? t('r_' + r.preset) : `${shortDate(r.from)}–${shortDate(r.to)}`}</span></div>
            <div class="wsub">
              <p class="wsub-label">${t('approved_earnings')}</p>
              <p class="wsub-v"><span class="num">${money(T.approvedEarnings)}</span>${delta(T.approvedEarnings, Pv.approvedEarnings)}</p>
              ${splitBar(T.approvedEarnings, T.pendingEarnings)}
              <dl class="legend-kv"><div><dt><span class="dot dot-a" aria-hidden="true"></span>${t('approved')}</dt><dd class="num">${money(T.approvedEarnings)}</dd></div><div><dt><span class="dot dot-b" aria-hidden="true"></span>${t('pending')}</dt><dd class="num">${money(T.pendingEarnings)}</dd></div></dl>
            </div>
            <div class="wsub wsub-ring">
              <div><p class="wsub-label">${t('approval_rate')}</p><p class="wsub-v"><span class="num">${fmtP(decided ? T.approved / decided : 0)}</span></p></div>
              ${ring(decided ? T.approved / decided : 0)}
            </div>
            <dl class="kvlist" id="statuses">
              ${kvRow(t('approved'), fmtN(T.approved))}
              ${kvRow(t('pending'), fmtN(T.pending))}
              ${kvRow(t('rejected'), fmtN(T.rejected))}
              ${kvRow(t('unique'), fmtN(T.unique))}
            </dl>
            ${d.topOffers.length ? `<h3 class="wcard-sub">${t('top_offers')}</h3>
            <ul class="tiles" id="top-tiles">${d.topOffers.slice(0, 4).map((o, i) => `<li><a href="#/stats" class="tile" title="${esc(o.label || o.key)}"><span class="tile-img tint-${i % 4}" aria-hidden="true">${esc(initials(o.label || o.key))}</span><span class="tile-cap num">${esc(compact(o.earnings))}</span><span class="sr">${esc(o.label || o.key)}: ${esc(money(o.earnings))}</span></a></li>`).join('')}</ul>` : ''}
          </section>
        </aside>
      </div>`;

    bindPeriod(() => render('dashboard', { keep: true }));
    if (!noData) {
      const paint = () => { const c = $('#chart'); if (c) c.innerHTML = trendChart(d.daily); };
      paint();
      $$('[data-series]').forEach((b) => {
        b.onclick = () => {
          const k = b.dataset.series;
          const on = SERIES.filter((x) => state.series[x]);
          if (state.series[k] && on.length === 1) return; // хотя бы одна линия остаётся
          state.series[k] = !state.series[k];
          b.setAttribute('aria-pressed', String(state.series[k]));
          paint();
        };
      });
      $$('[data-trend]').forEach((b) => { b.onclick = () => { setRange(presetRange(b.dataset.trend)); render('dashboard', { keep: true }); }; });
      const paintTable = () => {
        $('#dash-table').innerHTML = dashTableHTML(d, approved);
        $$('[data-dcopy]').forEach((b) => { b.onclick = () => { const o = approved.find((a) => a.id === b.dataset.dcopy); if (o) copyText(o.trackingUrl); }; });
      };
      paintTable();
      $$('[data-dtab]').forEach((b) => {
        b.onclick = () => {
          state.dtab = b.dataset.dtab;
          $$('[data-dtab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
          paintTable();
        };
      });
    }
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const c = $('#chart');
      if (c && state.daily && currentView === 'dashboard') c.innerHTML = trendChart(state.daily);
    }, 150);
  });

  /* ───────────── offers ───────────── */
  async function viewOffers(alive) {
    const topQ = $('#top-q');
    const f = { q: topQ ? topQ.value.trim() : '', category: '', model: '', country: '', access: '', page: 1 };
    const cache = new Map();
    let reqId = 0, facets = null;

    $('#view').innerHTML = `
      <div class="page-head"><h1>${t('nav_offers')}</h1><p class="muted" id="count" aria-live="polite"></p></div>
      <section class="card filters" id="filters" aria-label="${esc(t('filters'))}">
        <div class="chiprow" role="group" aria-label="${esc(t('filter_access'))}" id="f-access">
          ${['', 'approved', 'pending', 'open'].map((a) => `<button type="button" class="chip" data-f-access="${a}" aria-pressed="${a === ''}">${a ? t('access_' + a) : t('filter_all')}</button>`).join('')}
        </div>
        <div class="chiprow" role="group" aria-label="${esc(t('filter_model'))}" id="f-model"></div>
        <div class="selects">
          <select id="f-category" class="input" aria-label="${esc(t('all_categories'))}"><option value="">${t('all_categories')}</option></select>
          <select id="f-country" class="input" aria-label="${esc(t('all_countries'))}"><option value="">${t('all_countries')}</option></select>
        </div>
      </section>
      <div id="offer-list" class="offer-list"><div class="sk sk-row"></div><div class="sk sk-row"></div></div>`;
    if (!alive()) return;

    const paintFacets = () => {
      $('#f-model').innerHTML = ['', ...facets.models].map((m) => `<button type="button" class="chip" data-f-model="${esc(m)}" aria-pressed="${f.model === m}">${m ? modelBadge(m) : t('filter_all')}</button>`).join('');
      $('#f-category').innerHTML = `<option value="">${t('all_categories')}</option>` + facets.categories.map((x) => `<option value="${esc(x)}" ${f.category === x ? 'selected' : ''}>${esc(x)}</option>`).join('');
      $('#f-country').innerHTML = `<option value="">${t('all_countries')}</option>` + facets.countries.map((x) => `<option value="${esc(x)}" ${f.country === x ? 'selected' : ''}>${flag(x)} ${esc(regionName(x))}</option>`).join('');
      $$('[data-f-model]').forEach((b) => { b.onclick = () => setF('model', b.dataset.fModel); });
    };
    const syncChips = () => {
      $$('[data-f-access]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fAccess === f.access)));
      $$('[data-f-model]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fModel === f.model)));
    };
    const setF = (k, v) => { f[k] = v; f.page = 1; syncChips(); load(); };
    const filtered = () => !!(f.q || f.category || f.model || f.country || f.access);

    async function load() {
      const my = ++reqId;
      const box = $('#offer-list');
      box.setAttribute('aria-busy', 'true');
      try {
        const qs = new URLSearchParams({ ...f, page: String(f.page) });
        for (const [k, v] of [...qs]) if (!v) qs.delete(k);
        const d = await api('/api/offers?' + qs);
        if (my !== reqId || !alive()) return;
        if (!facets) { facets = d.facets; paintFacets(); }
        $('#count').textContent = t('offers_found', { n: fmtN(d.total) }) + (f.q ? ' · ' + t('search_for', { q: f.q }) : '');
        d.rows.forEach((o) => cache.set(o.id, o));
        const pages = Math.max(1, Math.ceil(d.total / d.perPage));
        box.innerHTML = d.rows.length
          ? `<div class="offers">${d.rows.map(offerCard).join('')}</div>${pager('pg', d.page, pages)}`
          : emptyBlock(t('no_offers'), t('no_offers_hint'), filtered() ? `<button class="btn" type="button" id="f-reset">${t('reset_filters')}</button>` : '');
        if (pages > 1) {
          $('#pg-prev').onclick = () => { f.page--; load(); window.scrollTo(0, 0); };
          $('#pg-next').onclick = () => { f.page++; load(); window.scrollTo(0, 0); };
        }
        const rs = $('#f-reset');
        if (rs) rs.onclick = () => {
          Object.assign(f, { q: '', category: '', model: '', country: '', access: '', page: 1 });
          if (topQ) topQ.value = '';
          $('#f-category').value = ''; $('#f-country').value = '';
          syncChips(); load();
        };
        $$('[data-open]', box).forEach((b) => {
          b.onclick = () => openOffer(cache.get(b.dataset.open), { onChange: load, focusBuilder: b.dataset.link === '1' });
        });
        $$('[data-copy-url]', box).forEach((b) => {
          b.onclick = () => { const o = cache.get(b.dataset.copyUrl); if (o) copyText(o.trackingUrl); };
        });
        $$('[data-req]', box).forEach((b) => {
          b.onclick = async () => { const o = cache.get(b.dataset.req); if (await requestAccess(o, b)) { state.approved = null; load(); } };
        });
      } catch (e) {
        if (my !== reqId || !alive()) return;
        box.innerHTML = errorBlock(e, 'retry-list');
        $('#retry-list').onclick = load;
      } finally {
        if (my === reqId) box.removeAttribute('aria-busy');
      }
    }

    function offerCard(o) {
      const geo = o.geo.allow.slice(0, 4).map((c) => geoChip(c)).join('') + (o.geo.allow.length > 4 ? `<span class="geo geo-more">+${o.geo.allow.length - 4}</span>` : '');
      const s = statusOf(o);
      let act = '';
      if (o.access === 'approved' && o.trackingUrl) {
        act = `<button class="btn btn-gold" type="button" data-copy-url="${esc(o.id)}" aria-label="${esc(t('copy_link_of', { name: o.name }))}">${ico('copy')}<span>${t('copy')}</span></button>`;
      } else if (o.access === 'open') {
        act = `<button class="btn btn-primary" type="button" data-req="${esc(o.id)}">${ico('send')}<span>${t('request_access')}</span></button>`;
      } else {
        act = `<p class="offer-note">${esc(s.note)}</p>`;
      }
      return `<article class="offer acc-${s.cls}" aria-labelledby="on-${esc(o.id)}">
        ${logoTile(o)}
        <div class="offer-id">
          <h2 class="offer-name" id="on-${esc(o.id)}"><button type="button" class="linkish" data-open="${esc(o.id)}">${esc(o.name)}</button></h2>
          <p class="offer-meta"><span>ID ${esc(o.id)}</span>${o.categories.length ? `<span>${esc(o.categories.join(', '))}</span>` : ''}</p>
        </div>
        <div class="offer-geo">${geo}</div>
        <div class="offer-pay">${modelBadge(o.model)}<strong class="pay num">${esc(payText(o))}</strong></div>
        <div class="offer-status">${statusPill(o)}</div>
        <div class="offer-act">${act}</div>
      </article>`;
    }

    let timer;
    // Поиск — пилюля в верхней панели: она общая для всех экранов, здесь фильтрует список.
    state.onSearch = (v) => {
      if (!alive()) return;
      clearTimeout(timer);
      timer = setTimeout(() => { if (!alive() || v === f.q) return; f.q = v; f.page = 1; load(); }, 300);
    };
    $$('[data-f-access]').forEach((b) => { b.onclick = () => setF('access', b.dataset.fAccess); });
    $('#f-category').onchange = (e) => setF('category', e.target.value);
    $('#f-country').onchange = (e) => setF('country', e.target.value);
    await load();
  }

  /* ───────────── statistics ───────────── */
  const sv = { group: 'date', offer: '', sort: null, dir: -1 };
  const GROUP_KEYS = ['date', 'hour', 'offer', 'country', 'device', 'os', 'browser', 'event', 'source', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5'];

  async function loadApproved() {
    if (!state.approved) state.approved = await api('/api/offers/approved');
    return state.approved;
  }

  const STAT_COLS = [
    ['earnings', (v) => money(v)], ['clicks', fmtN], ['conversions', fmtN], ['cr', fmtP], ['epc', (v) => money(v)],
    ['approved', fmtN], ['pending', fmtN], ['rejected', fmtN], ['unique', fmtN], ['impressions', fmtN],
  ];


  /* ───────────── финансы: баланс, выплаты, реквизиты ───────────── */
  const PAY_METHODS = ['kaspi', 'card', 'usdt', 'bank'];
  const maskDetails = (m, v) => (m === 'kaspi' || m === 'card' ? '•••• ' + v.slice(-4) : v.length > 10 ? v.slice(0, 4) + '…' + v.slice(-4) : v);
  const payStatus = { pending: ['q-review', 'fin_st_pending'], paid: ['q-good', 'fin_st_paid'], rejected: ['q-neutral', 'fin_st_rejected'] };
  async function viewFinance(alive) {
    const d = await api('/api/finance');
    if (!alive()) return;
    state.currency = d.currency || state.currency;
    const B = d.balance;
    const det = d.details;
    const kpi = (label, value, hint, cls = '') => `<div class="fin-kpi ${cls}"><span class="fin-label">${label}</span><b class="num">${value}</b><span class="fin-hint">${hint}</span></div>`;
    const canAsk = !!det && B.available >= d.minPayout;
    $('#view').innerHTML = `
      <div class="page-head"><h1>${t('nav_finance')}</h1></div>
      <section class="card fin-kpis" aria-label="${esc(t('fin_balance'))}">
        ${kpi(t('fin_available'), money(B.available), t('fin_available_hint'), 'is-ok')}
        ${kpi(t('fin_pending'), money(B.pending), t('fin_pending_hint'), 'is-warn')}
        ${kpi(t('fin_processing'), money(B.processing), t('fin_processing_hint'))}
        ${kpi(t('fin_paid'), money(B.paid), t('fin_paid_hint'))}
      </section>
      <div class="fin-grid">
        <section class="card fin-box" id="fin-payout">
          <h2>${t('fin_request')}</h2>
          <form id="payout-form" novalidate>
            <label class="field"><span>${t('fin_amount')} (${esc(state.currency || '')})</span>
              <div class="copy-line"><input class="input" id="pay-amount" inputmode="decimal" autocomplete="off" placeholder="${esc(String(d.minPayout))}" ${canAsk ? '' : 'disabled'}><button class="btn" type="button" id="pay-all" ${canAsk ? '' : 'disabled'}>${t('fin_all')}</button></div></label>
            <p class="fin-hint" id="pay-msg">${!det ? t('fin_need_details') : B.available < d.minPayout ? t('fin_min').replace('{n}', money(d.minPayout)) : t('fin_to').replace('{d}', esc(t('pm_' + det.method)) + ' ' + esc(maskDetails(det.method, det.value)))}</p>
            <button class="btn btn-primary btn-wide" type="submit" ${canAsk ? '' : 'disabled'}>${ico('send')}<span>${t('fin_request')}</span></button>
          </form>
        </section>
        <section class="card fin-box" id="fin-details">
          <h2>${t('fin_details')}</h2>
          <form id="details-form" novalidate>
            <label class="field"><span>${t('fin_method')}</span><select class="input" id="pm-method">${PAY_METHODS.map((m) => `<option value="${m}" ${det && det.method === m ? 'selected' : ''}>${t('pm_' + m)}</option>`).join('')}</select></label>
            <label class="field"><span id="pm-label">${t('fin_number')}</span><input class="input input-mono" id="pm-value" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(det ? det.value : '')}"></label>
            <p class="fin-hint" id="pm-hint"></p>
            <button class="btn btn-primary btn-wide" type="submit">${t('save')}</button>
          </form>
        </section>
      </div>
      <section class="card fin-table"><h2>${t('fin_history')}</h2>
        ${d.payouts.length ? `<div class="table-scroll" tabindex="0" role="region" aria-label="${esc(t('fin_history'))}"><table class="table table-dash">
          <thead><tr><th scope="col">${t('g_date')}</th><th scope="col">${t('fin_method')}</th><th scope="col" class="r">${t('fin_amount')}</th><th scope="col">${t('status')}</th></tr></thead>
          <tbody>${d.payouts.map((p) => `<tr><th scope="row">${esc(String(p.createdAt).slice(0, 10))}</th><td>${esc(t('pm_' + p.method))} <span class="muted">${esc(maskDetails(p.method, p.details))}</span></td><td class="r num col-money">${money(p.amount)}</td><td><span class="badge ${payStatus[p.status][0]}">${t(payStatus[p.status][1])}</span></td></tr>`).join('')}</tbody>
        </table></div>` : emptyBlock(t('fin_no_payouts'), t('fin_no_payouts_hint'), '', 'wallet')}
      </section>
      <p class="note">${ico('alert')}<span>${t('fin_note')}</span></p>`;

    const method = $('#pm-method'), value = $('#pm-value');
    const syncHint = () => { $('#pm-hint').textContent = t('pmh_' + method.value); $('#pm-label').textContent = t('pml_' + method.value); value.setAttribute('inputmode', method.value === 'kaspi' || method.value === 'card' ? 'numeric' : 'text'); };
    method.onchange = syncHint; syncHint();
    $('#details-form').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/api/finance/details', { method: 'PUT', body: { method: method.value, value: value.value } }); toast(t('fin_saved')); render('finance', { keep: true }); }
      catch (err) { toast(errText(err), 'err'); }
    };
    const amount = $('#pay-amount');
    $('#pay-all').onclick = () => { amount.value = String(B.available); amount.focus(); };
    $('#payout-form').onsubmit = async (e) => {
      e.preventDefault();
      if (!canAsk) return;
      try { await api('/api/finance/payout', { method: 'POST', body: { amount: Number(String(amount.value).replace(',', '.')) } }); toast(t('fin_sent')); render('finance', { keep: true }); }
      catch (err) { toast(errText(err), 'err'); }
    };
  }

  async function viewStats(alive) {
    const r = state.range;
    const approved = await loadApproved();
    if (!alive()) return;
    $('#view').innerHTML = `
      ${periodBar()}
      <div class="page-head"><h1>${t('nav_stats')}</h1></div>
      <div class="toolbar">
        <label class="field"><span>${t('group_by')}</span>
          <select id="s-group" class="input">${GROUP_KEYS.map((g) => `<option value="${g}" ${g === sv.group ? 'selected' : ''}>${t('g_' + g)}</option>`).join('')}</select></label>
        <label class="field"><span>${t('g_offer')}</span>
          <select id="s-offer" class="input"><option value="">${t('all_offers')}</option>${approved.map((o) => `<option value="${esc(o.id)}" ${o.id === sv.offer ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
        <a class="btn" id="s-csv" href="#" download>${ico('download')}<span>${t('export_csv')}</span></a>
      </div>
      <div class="panel panel-flush" id="stats-table"><div class="sk sk-table"></div></div>`;
    bindPeriod(() => render('stats', { keep: true }));

    let reqId = 0, data = null;
    const qs = () => new URLSearchParams({ from: r.from, to: r.to, group: sv.group, ...(sv.offer ? { offer: sv.offer } : {}) });
    const firstCell = (g) => {
      if (sv.group === 'offer') return `<span class="cell-main">${esc(g.label || g.key)}</span>${g.label ? `<span class="cell-sub">ID ${esc(g.key)}</span>` : ''}`;
      if (sv.group === 'country') return `<span class="flag" aria-hidden="true">${flag(g.key)}</span> ${esc(g.key)}`;
      if (sv.group === 'date' && DATE_RE.test(g.key)) return `<span class="num">${esc(g.key)}</span>`;
      return esc(g.key);
    };
    const paintTable = () => {
      const box = $('#stats-table');
      if (!data.rows.length) { box.innerHTML = emptyBlock(t('no_data'), t('no_data_hint'), `<a class="btn btn-primary" href="#/offers">${t('get_link')}</a>`, 'stats'); return; }
      const rows = [...data.rows];
      if (sv.sort) rows.sort((a, b) => (a[sv.sort] - b[sv.sort]) * sv.dir);
      const T = data.totals;
      box.innerHTML = `${data.truncated ? `<p class="note note-pending">${t('truncated_warn')}</p>` : ''}
        <div class="table-scroll" tabindex="0" role="region" aria-label="${esc(t('nav_stats'))}"><table class="table table-stats">
          <thead><tr><th scope="col" class="sticky-col">${t('g_' + sv.group)}</th>${STAT_COLS.map(([k]) => `<th scope="col" class="r${k === 'earnings' ? ' col-money' : ''}" data-sort="${k}" aria-sort="${sv.sort === k ? (sv.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="th-btn" aria-label="${esc(t('sort_by', { c: t(k) }))}">${t(k)}<span class="sort-ind" aria-hidden="true">${sv.sort === k ? (sv.dir > 0 ? '▲' : '▼') : ''}</span></button></th>`).join('')}</tr></thead>
          <tbody>${rows.map((g) => `<tr><th scope="row" class="sticky-col">${firstCell(g)}</th>${STAT_COLS.map(([k, fm]) => `<td class="r num${k === 'earnings' ? ' col-money' : ''}">${fm(g[k])}</td>`).join('')}</tr>`).join('')}</tbody>
          <tfoot><tr><th scope="row" class="sticky-col">${t('totals')}</th>${STAT_COLS.map(([k, fm]) => `<td class="r num${k === 'earnings' ? ' col-money' : ''}">${fm(T[k])}</td>`).join('')}</tr></tfoot>
        </table></div>`;
      $$('[data-sort]', box).forEach((th) => {
        $('button', th).onclick = () => {
          if (sv.sort === th.dataset.sort) sv.dir = -sv.dir; else { sv.sort = th.dataset.sort; sv.dir = -1; }
          paintTable();
          const nb = $(`[data-sort="${sv.sort}"] button`, box);
          if (nb) nb.focus();
        };
      });
    };
    async function load() {
      const my = ++reqId;
      $('#s-csv').href = '/api/stats/export.csv?' + qs();
      const box = $('#stats-table');
      if (!data) box.innerHTML = '<div class="sk sk-table"></div>';
      box.setAttribute('aria-busy', 'true');
      try {
        const d = await api('/api/stats?' + qs());
        if (my !== reqId || !alive()) return;
        state.currency = d.currency || state.currency;
        data = d;
        paintTable();
      } catch (e) {
        if (my !== reqId || !alive()) return;
        box.innerHTML = errorBlock(e, 'retry-s');
        $('#retry-s').onclick = load;
      } finally {
        if (my === reqId) box.removeAttribute('aria-busy');
      }
    }
    $('#s-group').onchange = (e) => { sv.group = e.target.value; sv.sort = null; load(); };
    $('#s-offer').onchange = (e) => { sv.offer = e.target.value; load(); };
    await load();
  }

  /* ───────────── conversions ───────────── */
  const cv = { status: '', offer: '', page: 1 };

  async function viewConversions(alive) {
    const r = state.range;
    const approved = await loadApproved();
    if (!alive()) return;
    $('#view').innerHTML = `
      ${periodBar()}
      <div class="page-head"><h1>${t('nav_conversions')}</h1><p class="muted" id="c-count" aria-live="polite"></p></div>
      <div class="toolbar">
        <div class="chiprow" role="group" aria-label="${esc(t('status'))}">
          ${['', 'approved', 'pending', 'rejected'].map((s) => `<button type="button" class="chip${s ? ' chip-' + s : ''}" data-c-status="${s}" aria-pressed="${cv.status === s}">${s ? t(s) : t('filter_all')}</button>`).join('')}
        </div>
        <label class="field"><span>${t('g_offer')}</span>
          <select id="c-offer" class="input"><option value="">${t('all_offers')}</option>${approved.map((o) => `<option value="${esc(o.id)}" ${o.id === cv.offer ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
      </div>
      <div class="panel panel-flush" id="conv-table"><div class="sk sk-table"></div></div>`;
    bindPeriod(() => { cv.page = 1; render('conversions', { keep: true }); });

    let reqId = 0;
    async function load() {
      const my = ++reqId;
      const box = $('#conv-table');
      box.setAttribute('aria-busy', 'true');
      try {
        const qs = new URLSearchParams({ from: r.from, to: r.to, page: String(cv.page), ...(cv.status ? { status: cv.status } : {}), ...(cv.offer ? { offer: cv.offer } : {}) });
        const d = await api('/api/conversions?' + qs);
        if (my !== reqId || !alive()) return;
        $('#c-count').textContent = `${t('conversions')}: ${fmtN(d.total)}`;
        const pages = Math.max(1, Math.ceil(d.total / d.perPage));
        if (!d.rows.length) { box.innerHTML = emptyBlock(t('no_conversions'), t('no_conversions_hint'), '', 'conversions'); return; }
        const L = (k) => esc(t(k));
        const today = ymd(new Date());
        box.innerHTML = `${d.truncated ? `<p class="note note-pending">${t('truncated_warn')}</p>` : ''}<div class="table-scroll table-scroll-cards"><table class="table table-cards">
          <thead><tr><th scope="col">${t('time')}</th><th scope="col">${t('g_offer')}</th><th scope="col">${t('status')}</th><th scope="col" class="r">${t('payout')}</th><th scope="col">${t('event')}</th><th scope="col">${t('g_country')}</th><th scope="col">${t('subs')}</th><th scope="col">${t('click_id')}</th></tr></thead>
          <tbody>${d.rows.map((x) => {
            const subs = [x.sub1, x.sub2, x.sub3, x.sub4, x.sub5].filter(Boolean);
            const fresh = String(x.time || '').slice(0, 10) === today;
            return `<tr class="conv conv-${esc(x.status)}${fresh ? ' is-fresh' : ''}">
              <td class="c-time num" data-label="${L('time')}">${fresh ? `<span class="fresh-dot" aria-hidden="true"></span><span class="sr">${esc(t('fresh'))}: </span>` : ''}${esc(x.time)}</td>
              <td class="c-offer" data-label="${L('g_offer')}"><span class="cell-main">${esc(x.offerName || x.offerId)}</span>${x.offerName ? `<span class="cell-sub">ID ${esc(x.offerId)}</span>` : ''}</td>
              <td class="c-status" data-label="${L('status')}"><span class="status st-${esc(x.status)}">${esc(t(x.status))}</span></td>
              <td class="c-pay r num" data-label="${L('payout')}">${fmtMoney(x.price, x.currency || state.currency)}</td>
              <td data-label="${L('event')}">${esc(x.event) || '—'}</td>
              <td data-label="${L('g_country')}">${x.country ? geoChip(x.country, 'geo-sm') : '—'}</td>
              <td class="c-subs" data-label="${L('subs')}">${subs.length ? subs.map((s) => `<span class="tag">${esc(s)}</span>`).join('') : '—'}</td>
              <td class="c-click mono" data-label="${L('click_id')}">${esc(x.clickId) || '—'}</td>
            </tr>`;
          }).join('')}</tbody></table></div>
          ${pager('c', d.page, pages)}`;
        if (pages > 1) {
          $('#c-prev').onclick = () => { cv.page--; load(); window.scrollTo(0, 0); };
          $('#c-next').onclick = () => { cv.page++; load(); window.scrollTo(0, 0); };
        }
      } catch (e) {
        if (my !== reqId || !alive()) return;
        box.innerHTML = errorBlock(e, 'retry-c');
        $('#retry-c').onclick = load;
      } finally {
        if (my === reqId) box.removeAttribute('aria-busy');
      }
    }
    $$('[data-c-status]').forEach((b) => {
      b.onclick = () => {
        cv.status = b.dataset.cStatus; cv.page = 1;
        $$('[data-c-status]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        load();
      };
    });
    $('#c-offer').onchange = (e) => { cv.offer = e.target.value; cv.page = 1; load(); };
    await load();
  }

  /* ───────────── links ───────────── */
  /* ───────────── account ───────────── */
  async function viewAccount(alive) {
    const me = await api('/api/me');
    if (!alive()) return;
    state.me = { ...state.me, ...me };
    $('#view').innerHTML = `
      <div class="page-head"><h1>${t('nav_account')}</h1></div>
      <div class="account">
        <section class="panel panel-pad">
          <dl class="kv kv-account" id="profile">
            <div><dt>${t('affiliate_id')}</dt><dd class="num">${esc(me.id)}</dd></div>
            <div><dt>${t('email')}</dt><dd>${esc(me.email)}</dd></div>
            ${me.name ? `<div><dt>${t('name')}</dt><dd>${esc(me.name)}</dd></div>` : ''}
            <div><dt>${t('theme')}</dt><dd></dd></div>
          </dl>
        </section>
        <p class="hint">${t('earnings_note')}</p>
        <div><button class="btn" type="button" id="logout2">${ico('logout')}<span>${t('logout')}</span></button></div>
      </div>`;
    $('#logout2').onclick = logout;
  }

  const VIEWS = { dashboard: viewDashboard, offers: viewOffers, stats: viewStats, conversions: viewConversions, finance: viewFinance, account: viewAccount };

  /* ───────────── boot ───────────── */
  window.addEventListener('hashchange', () => { if (state.me) route(); });
  document.documentElement.lang = lang;
  document.title = t('brand');
  api('/api/me').then((me) => { state.me = me; renderApp(); }, () => renderAuth('login'));
})();
