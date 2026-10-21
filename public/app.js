(() => {
  'use strict';

  /* ───────────── basics ───────────── */
  const I = window.I18N;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LANGS = [['ru', 'РУС'], ['kk', 'ҚАЗ'], ['en', 'ENG']];

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
  };

  let lang = store.get('lang') || 'ru';
  if (!I[lang]) lang = 'ru';

  function t(key, vars) {
    let s = I[lang][key] ?? I.ru[key] ?? key;
    if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  }
  const hasKey = (k) => Object.prototype.hasOwnProperty.call(I[lang], k);

  const state = { me: null, range: null, currency: 'USD', approved: null, chartMetric: 'earnings', daily: null };

  /* ───────────── icons (inline SVG, attributes only — CSP-safe) ───────────── */
  const P = {
    dashboard: '<path d="M3 11l9-7 9 7"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/>',
    offers: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
    stats: '<path d="M5 20v-8M12 20V5M19 20v-5M3 20h18"/>',
    links: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
    conversions: '<path d="M20 6L9 17l-5-5"/>',
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
  const PRESETS = ['today', 'yesterday', '7d', '30d', 'month', 'last_month'];
  function presetRange(p) {
    const now = new Date();
    const to = ymd(now);
    const back = (days) => { const d = new Date(now); d.setDate(d.getDate() - days); return ymd(d); };
    if (p === 'today') return { from: to, to, preset: p };
    if (p === 'yesterday') { const y = back(1); return { from: y, to: y, preset: p }; }
    if (p === '7d') return { from: back(6), to, preset: p };
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
    el.innerHTML = ico(kind === 'err' ? 'alert' : kind === 'info' ? 'send' : 'conversions') + `<span>${esc(msg)}</span>`;
    box.append(el);
    setTimeout(() => el.remove(), kind === 'err' ? 5200 : 3200);
  }

  /* ───────────── shared components ───────────── */
  function langSwitch(cls = '') {
    return `<div class="langs ${cls}" role="group" aria-label="${esc(t('language'))}">${LANGS.map(
      ([c, l]) => `<button type="button" data-lang="${c}" aria-pressed="${c === lang}" lang="${c}">${l}</button>`
    ).join('')}</div>`;
  }
  function bindLang(root = document) {
    $$('[data-lang]', root).forEach((b) => {
      b.onclick = () => {
        lang = b.dataset.lang;
        store.set('lang', lang);
        document.documentElement.lang = lang;
        document.title = t('brand');
        closeSheet();
        if (state.me) renderApp(); else renderAuth(authMode);
      };
    });
  }

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

  const SUB_MAIN = ['aff_sub1', 'aff_sub2', 'aff_sub3'];
  const SUB_MORE = ['aff_sub4', 'aff_sub5', 'sub_aff_id', 'aff_click_id', 'source'];
  const subLabel = (f) => (f.startsWith('aff_sub') ? f : t('p_' + f));
  const subField = (f) => `<label class="field"><span>${esc(subLabel(f))}</span><input class="input input-mono" data-param="${f}" maxlength="100" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text"></label>`;

  function builderHTML(impressionUrl) {
    return `<div class="builder" data-builder>
      <div class="builder-out">
        <label class="field"><span>${t('tracking_link')}</span><textarea class="input input-mono link-out" data-out readonly rows="3"></textarea></label>
        <button class="btn btn-gold btn-wide" type="button" data-copy>${ico('copy')}<span>${t('copy_link')}</span></button>
      </div>
      <div class="sub-grid">${SUB_MAIN.map(subField).join('')}</div>
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
  const NAV = ['dashboard', 'offers', 'stats', 'conversions', 'links', 'account'];
  const TABS = ['dashboard', 'offers', 'stats', 'links'];

  function renderShell() {
    const me = state.me;
    document.title = t('brand');
    $('#app').innerHTML = `
      <a class="skip" href="#view">${t('skip')}</a>
      <div class="shell">
        <aside class="rail">
          <div class="brandmark"><span class="mark" aria-hidden="true">W</span><span>${t('brand')}</span></div>
          ${me.demo ? `<p class="demo-tag">${t('demo_banner')}</p>` : ''}
          <nav class="rail-nav" aria-label="${esc(t('main_nav'))}">${NAV.map((n) => `<a href="#/${n}" data-nav="${n}">${ico(n)}<span>${t('nav_' + n)}</span></a>`).join('')}</nav>
          <div class="rail-foot">
            <p class="who"><span class="who-mail">${esc(me.email)}</span><span class="who-id">ID ${esc(me.id)}</span></p>
            ${langSwitch('langs-dark')}
            <button class="btn btn-ghost-dark" type="button" id="logout">${ico('logout')}<span>${t('logout')}</span></button>
          </div>
        </aside>
        <header class="topbar">
          <span class="mark" aria-hidden="true">W</span>
          <p class="topbar-title" id="top-title"></p>
          ${me.demo ? `<span class="demo-tag" title="${esc(t('demo_banner'))}">DEMO</span>` : ''}
          <button class="avatar" type="button" id="top-more" aria-label="${esc(t('nav_more'))}">${esc(initials(me.email))}</button>
        </header>
        <main class="main" id="view" tabindex="-1"></main>
        <nav class="tabbar" aria-label="${esc(t('main_nav'))}">
          ${TABS.map((n) => `<a href="#/${n}" data-nav="${n}">${ico(n)}<span>${t('nav_' + n)}</span></a>`).join('')}
          <button type="button" id="tab-more" data-nav="more" aria-haspopup="dialog">${ico('more')}<span>${t('nav_more')}</span></button>
        </nav>
      </div>`;
    bindLang($('.rail'));
    $('#logout').onclick = logout;
    $('#tab-more').onclick = openMore;
    $('#top-more').onclick = openMore;
  }

  function openMore() {
    const me = state.me;
    const box = openSheet({
      label: t('nav_more'),
      kind: 'menu',
      html: `<header class="sheet-head sheet-head-menu"><div class="sheet-title"><h2>${esc(me.email)}</h2><p class="sheet-sub muted">ID ${esc(me.id)}</p></div>
          <button class="btn btn-icon btn-ghost" type="button" data-close aria-label="${esc(t('close'))}">${ico('close')}</button></header>
        <nav class="menu-list" aria-label="${esc(t('nav_more'))}">
          ${['conversions', 'account'].map((n) => `<a href="#/${n}" data-menu>${ico(n)}<span>${t('nav_' + n)}</span></a>`).join('')}
        </nav>
        <div class="menu-lang"><span>${t('language')}</span>${langSwitch()}</div>
        <button class="btn btn-wide btn-danger-soft" type="button" id="menu-logout">${ico('logout')}<span>${t('logout')}</span></button>`,
    });
    bindLang(box);
    $$('[data-menu]', box).forEach((a) => { a.addEventListener('click', () => closeSheet()); });
    $('#menu-logout', box).onclick = logout;
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    state.me = null; state.approved = null;
    closeSheet();
    renderAuth('login');
  }

  const SKELETON = {
    dashboard: '<div class="sk sk-period"></div><div class="sk sk-hero"></div><div class="sk sk-strip"></div><div class="sk sk-chart"></div>',
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
    const name = VIEWS[raw] ? raw : 'dashboard';
    $$('[data-nav]').forEach((a) => {
      const on = a.dataset.nav === name || (a.dataset.nav === 'more' && (name === 'conversions' || name === 'account'));
      if (a.tagName === 'A') a.setAttribute('aria-current', on ? 'page' : 'false');
      a.classList.toggle('is-on', on);
    });
    const tt = $('#top-title');
    if (tt) tt.textContent = t('nav_' + name);
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
    $('#app').innerHTML = `
      <div class="auth">
        <section class="auth-side">
          <div class="brandmark"><span class="mark" aria-hidden="true">W</span><span>${t('brand')}</span></div>
          <h1 class="auth-title">${t('auth_title')}</h1>
          <p class="auth-sub">${t('auth_sub')}</p>
          <ul class="auth-points">
            <li><span class="auth-models">${MODELS.map(modelBadge).join('')}</span>${t('auth_p1')}</li>
            <li>${ico('links')}${t('auth_p2')}</li>
            <li>${ico('stats')}${t('auth_p3')}</li>
          </ul>
        </section>
        <section class="auth-main">
          <div class="auth-top">${langSwitch()}</div>
          <div class="auth-card">
            <div class="tabs" role="tablist">
              <button class="tab" role="tab" type="button" data-mode="login" aria-selected="${isLogin}">${t('login')}</button>
              <button class="tab" role="tab" type="button" data-mode="register" aria-selected="${!isLogin}">${t('register')}</button>
            </div>
            ${flash ? `<p class="note note-info" role="status">${esc(flash)}</p>` : ''}
            ${isLogin ? loginForm() : registerForm()}
          </div>
        </section>
      </div>`;
    bindLang();
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
  function delta(cur, prev, { dark = false } = {}) {
    if (!prev) return '';
    const p = (cur - prev) / prev;
    if (!Number.isFinite(p) || Math.abs(p) < 0.0005) return '';
    const v = new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 1 }).format(Math.abs(p));
    return `<span class="delta ${p > 0 ? 'up' : 'down'}${dark ? ' delta-dark' : ''}"><span aria-hidden="true">${p > 0 ? '▲' : '▼'}</span> ${p > 0 ? '+' : '−'}${v}</span>`;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  function chartWidth() {
    const box = $('#chart');
    const w = box ? box.clientWidth : 0;
    return Math.round(Math.min(1100, Math.max(300, w || 640)));
  }

  function barChart(daily, metric) {
    const W = chartWidth();
    const narrow = W < 560;
    const H = narrow ? 200 : 250, L = narrow ? 40 : 52, R = 6, T = 12, B = 26;
    const vals = daily.map((d) => d[metric]);
    const max = niceMax(Math.max(...vals, 0));
    const bw = (W - L - R) / Math.max(daily.length, 1);
    const ph = H - T - B;
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const y = T + ph * (1 - i / 4);
      const lab = metric === 'earnings' ? fmtMoney((max * i) / 4, state.currency).replace(/[.,]00(?=\D*$)/, '') : compact((max * i) / 4);
      g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="ylab" x="${L - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(i % 2 === 0 || !narrow ? lab : '')}</text>`;
    }
    const step = Math.ceil(daily.length / (narrow ? 5 : 10));
    let bars = '', labels = '';
    daily.forEach((d, i) => {
      const h = (d[metric] / max) * ph;
      const x = L + i * bw + bw * 0.15;
      const label = shortDate(d.date);
      const shown = metric === 'earnings' ? money(d[metric]) : fmtN(d[metric]);
      if (h > 0) bars += `<rect class="bar" x="${x.toFixed(1)}" y="${(T + ph - h).toFixed(1)}" width="${Math.max(1, bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(3, bw * 0.2).toFixed(1)}"><title>${esc(label)}: ${esc(shown)}</title></rect>`;
      if (i % step === 0) labels += `<text class="xlab" x="${(x + bw * 0.35).toFixed(1)}" y="${H - 7}" text-anchor="middle">${label}</text>`;
    });
    return `<svg class="chart chart-${metric}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('chart_title') + ': ' + t(metric))}">${g}${bars}${labels}</svg>`;
  }

  const shareBar = (part, whole, cls = '') => {
    const pct = whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0;
    return `<svg class="share ${cls}" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="share-bg" width="100" height="6" rx="3"/><rect class="share-fg" width="${pct.toFixed(2)}" height="6" rx="3"/></svg>`;
  };

  function splitBar(a, b) {
    const sum = a + b;
    const pa = sum > 0 ? (a / sum) * 100 : 0;
    return `<svg class="split" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect class="split-bg" width="100" height="10" rx="5"/>${sum > 0 ? `<rect class="split-b" width="100" height="10" rx="5"/><rect class="split-a" width="${pa.toFixed(2)}" height="10" rx="${pa >= 99.5 ? 5 : 0}"/>` : ''}</svg>`;
  }

  function startChecklist(hasApproved) {
    const copied = store.get('wm.copied') === '1';
    const steps = [
      ['start_1', 'start_1_hint', hasApproved, `<a class="btn btn-primary" href="#/offers">${t('go_offers')}</a>`],
      ['start_2', 'start_2_hint', copied, hasApproved ? `<a class="btn" href="#/links">${t('get_link')}</a>` : ''],
      ['start_3', 'start_3_hint', false, ''],
    ];
    const next = steps.findIndex((s) => !s[2]);
    return `<section class="panel start" aria-labelledby="start-h">
      <h2 id="start-h">${t('start_title')}</h2>
      <ol class="steps">${steps.map(([h, hint, done, cta], i) => `<li class="step${done ? ' is-done' : ''}${i === next ? ' is-next' : ''}">
        <span class="step-n" aria-hidden="true">${done ? ico('conversions') : i + 1}</span>
        <div class="step-body"><p class="step-title">${t(h)}${done ? ` <span class="sr">(${t('step_done')})</span>` : ''}</p><p class="step-hint">${t(hint)}</p>${i === next && cta ? `<div class="step-cta">${cta}</div>` : ''}</div>
      </li>`).join('')}</ol>
    </section>`;
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
    const T = d.totals, Pv = d.previous;
    const noData = !T.clicks && !T.conversions;
    const metric = (label, value, dl) => `<div class="metric"><dt>${label}</dt><dd><span class="metric-v num">${value}</span>${dl || ''}</dd></div>`;

    const topMaxO = Math.max(...d.topOffers.map((o) => o.earnings), 0);
    const topMaxC = Math.max(...d.topCountries.map((o) => o.earnings), 0);

    $('#view').innerHTML = `
      ${periodBar()}
      <h1 class="sr">${t('nav_dashboard')}</h1>
      ${d.truncated ? `<p class="note note-pending">${t('truncated_warn')}</p>` : ''}
      <section class="hero" aria-labelledby="hero-l">
        <div class="hero-main">
          <p class="hero-label" id="hero-l">${t('earned')}</p>
          <p class="hero-sum num${money(T.earnings).length > 11 ? ' hero-sum-long' : ''}" id="kpi-earn">${money(T.earnings)}</p>
          <p class="hero-delta">${delta(T.earnings, Pv.earnings, { dark: true })}<span>${Pv.earnings ? t('prev_was', { v: money(Pv.earnings) }) : ''}</span></p>
        </div>
        <div class="hero-split">
          ${splitBar(T.approvedEarnings, T.pendingEarnings)}
          <dl class="hero-legend">
            <div><dt><span class="dot dot-a" aria-hidden="true"></span>${t('approved')}</dt><dd class="num">${money(T.approvedEarnings)}</dd></div>
            <div><dt><span class="dot dot-b" aria-hidden="true"></span>${t('pending')}</dt><dd class="num">${money(T.pendingEarnings)}</dd></div>
          </dl>
        </div>
      </section>
      <dl class="metrics" id="kpis">
        ${metric(t('clicks'), fmtN(T.clicks), delta(T.clicks, Pv.clicks))}
        ${metric(t('conversions'), fmtN(T.conversions), delta(T.conversions, Pv.conversions))}
        ${metric(t('cr'), fmtP(T.cr), delta(T.cr, Pv.cr))}
        ${metric(t('epc'), money(T.epc), delta(T.epc, Pv.epc))}
      </dl>
      ${noData ? `${startChecklist(approved.length > 0)}
        <div class="panel">${emptyBlock(t('no_data'), t('no_data_hint'), '', 'stats')}</div>` : `
      <section class="panel" aria-labelledby="chart-h">
        <div class="panel-head"><h2 id="chart-h">${t('chart_title')}</h2>
          <div class="seg" role="group" aria-label="${esc(t('chart_title'))}">${['earnings', 'clicks', 'conversions'].map((m) => `<button type="button" data-metric="${m}" aria-pressed="${state.chartMetric === m}">${t(m)}</button>`).join('')}</div>
        </div>
        <div class="chart-box" id="chart"></div>
      </section>
      <div class="cols">
        <section class="panel" aria-labelledby="to-h"><div class="panel-head"><h2 id="to-h">${t('top_offers')}</h2><a class="link-more" href="#/stats">${t('nav_stats')}</a></div>
          <ol class="rank" id="top-offers">${d.topOffers.map((o) => `<li>
            <div class="rank-top"><span class="rank-name">${esc(o.label || o.key)}</span><strong class="rank-sum num">${money(o.earnings)}</strong></div>
            ${shareBar(o.earnings, topMaxO)}
            <p class="rank-meta"><span>ID ${esc(o.key)}</span><span>${t('clicks')}: ${fmtN(o.clicks)}</span><span>${t('conversions')}: ${fmtN(o.conversions)}</span></p>
          </li>`).join('')}</ol>
        </section>
        <section class="panel" aria-labelledby="tc-h"><div class="panel-head"><h2 id="tc-h">${t('top_countries')}</h2></div>
          <ol class="rank" id="top-countries">${d.topCountries.map((c) => `<li>
            <div class="rank-top"><span class="rank-name"><span class="flag" aria-hidden="true">${flag(c.key)}</span> ${esc(regionName(c.key))} <span class="muted">${esc(c.key)}</span></span><strong class="rank-sum num">${money(c.earnings)}</strong></div>
            ${shareBar(c.earnings, topMaxC, 'share-sky')}
            <p class="rank-meta"><span>${t('clicks')}: ${fmtN(c.clicks)}</span><span>${t('conversions')}: ${fmtN(c.conversions)}</span></p>
          </li>`).join('')}</ol>
        </section>
      </div>
      <section class="panel" aria-labelledby="st-h"><div class="panel-head"><h2 id="st-h">${t('statuses')}</h2></div>
        <dl class="metrics metrics-flat">
          ${metric(t('unique'), fmtN(T.unique))}
          ${metric(`<span class="dot dot-a" aria-hidden="true"></span>${t('approved')}`, fmtN(T.approved))}
          ${metric(`<span class="dot dot-b" aria-hidden="true"></span>${t('pending')}`, fmtN(T.pending))}
          ${metric(`<span class="dot dot-r" aria-hidden="true"></span>${t('rejected')}`, fmtN(T.rejected))}
        </dl>
      </section>`}`;

    bindPeriod(() => render('dashboard', { keep: true }));
    if (!noData) {
      const paint = () => { const c = $('#chart'); if (c) c.innerHTML = barChart(d.daily, state.chartMetric); };
      paint();
      $$('[data-metric]').forEach((b) => {
        b.onclick = () => {
          state.chartMetric = b.dataset.metric;
          paint();
          $$('[data-metric]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        };
      });
    }
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const c = $('#chart');
      if (c && state.daily && currentView === 'dashboard') c.innerHTML = barChart(state.daily, state.chartMetric);
    }, 150);
  });

  /* ───────────── offers ───────────── */
  async function viewOffers(alive) {
    const f = { q: '', category: '', model: '', country: '', access: '', page: 1 };
    const cache = new Map();
    let reqId = 0, facets = null;

    $('#view').innerHTML = `
      <div class="page-head"><h1>${t('nav_offers')}</h1><p class="muted" id="count" aria-live="polite"></p></div>
      <div class="filters" id="filters">
        <label class="search">${ico('search')}<span class="sr">${t('search_offers')}</span><input id="f-q" class="input" type="search" placeholder="${esc(t('search_offers'))}" autocomplete="off" enterkeyhint="search"></label>
        <div class="chiprow" role="group" aria-label="${esc(t('filter_access'))}" id="f-access">
          ${['', 'approved', 'pending', 'open'].map((a) => `<button type="button" class="chip" data-f-access="${a}" aria-pressed="${a === ''}">${a ? t('access_' + a) : t('filter_all')}</button>`).join('')}
        </div>
        <div class="chiprow" role="group" aria-label="${esc(t('filter_model'))}" id="f-model"></div>
        <div class="selects">
          <select id="f-category" class="input" aria-label="${esc(t('all_categories'))}"><option value="">${t('all_categories')}</option></select>
          <select id="f-country" class="input" aria-label="${esc(t('all_countries'))}"><option value="">${t('all_countries')}</option></select>
        </div>
      </div>
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
        $('#count').textContent = t('offers_found', { n: fmtN(d.total) });
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
          $('#f-q').value = ''; $('#f-category').value = ''; $('#f-country').value = '';
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
        act = `<button class="btn btn-gold" type="button" data-copy-url="${esc(o.id)}" aria-label="${esc(t('copy_link_of', { name: o.name }))}">${ico('copy')}<span>${t('copy')}</span></button>
          <button class="btn btn-primary" type="button" data-open="${esc(o.id)}" data-link="1">${ico('links')}<span>${t('get_link')}</span></button>`;
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
    $('#f-q').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { f.q = e.target.value.trim(); f.page = 1; load(); }, 300); };
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
      if (!data.rows.length) { box.innerHTML = emptyBlock(t('no_data'), t('no_data_hint'), `<a class="btn btn-primary" href="#/links">${t('get_link')}</a>`, 'stats'); return; }
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
        box.innerHTML = `${d.truncated ? `<p class="note note-pending">${t('truncated_warn')}</p>` : ''}<div class="table-scroll table-scroll-cards"><table class="table table-cards">
          <thead><tr><th scope="col">${t('time')}</th><th scope="col">${t('g_offer')}</th><th scope="col">${t('status')}</th><th scope="col" class="r">${t('payout')}</th><th scope="col">${t('event')}</th><th scope="col">${t('g_country')}</th><th scope="col">${t('subs')}</th><th scope="col">${t('click_id')}</th></tr></thead>
          <tbody>${d.rows.map((x) => {
            const subs = [x.sub1, x.sub2, x.sub3, x.sub4, x.sub5].filter(Boolean);
            return `<tr class="conv conv-${esc(x.status)}">
              <td class="c-time num" data-label="${L('time')}">${esc(x.time)}</td>
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
  async function viewLinks(alive) {
    const list = await loadApproved();
    if (!alive()) return;
    if (!list.length) {
      $('#view').innerHTML = `<div class="page-head"><h1>${t('nav_links')}</h1></div>
        <div class="panel">${emptyBlock(t('no_approved'), t('no_approved_hint'), `<a class="btn btn-primary" href="#/offers">${t('go_offers')}</a>`, 'links')}</div>`;
      return;
    }
    $('#view').innerHTML = `
      <div class="page-head"><h1>${t('link_builder')}</h1></div>
      <div class="cols cols-links">
        <section class="panel panel-pad" aria-label="${esc(t('link_builder'))}">
          <label class="field"><span>${t('choose_offer')}</span><select id="l-offer" class="input">${list.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></label>
          <div id="l-builder"></div>
        </section>
        <section class="panel" aria-labelledby="ml-h">
          <div class="panel-head"><h2 id="ml-h">${t('my_links')}</h2></div>
          <ul class="quick-links">${list.map((o) => `<li>
            <div class="ql-text"><span class="cell-main">${esc(o.name)}</span><span class="cell-sub mono">${esc(o.trackingUrl)}</span></div>
            <button class="btn btn-icon btn-gold" type="button" data-ql="${esc(o.id)}" aria-label="${esc(t('copy_link_of', { name: o.name }))}">${ico('copy')}</button>
          </li>`).join('')}</ul>
        </section>
      </div>`;
    const paint = () => {
      const o = list.find((x) => x.id === $('#l-offer').value) || list[0];
      $('#l-builder').innerHTML = builderHTML(o.impressionUrl);
      bindBuilder($('#l-builder'), o.trackingUrl);
    };
    $('#l-offer').onchange = paint;
    $$('[data-ql]').forEach((b) => { b.onclick = () => { const o = list.find((x) => x.id === b.dataset.ql); if (o) copyText(o.trackingUrl); }; });
    paint();
  }

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
            <div><dt>${t('language')}</dt><dd>${langSwitch()}</dd></div>
          </dl>
        </section>
        <p class="hint">${t('earnings_note')}</p>
        <div><button class="btn" type="button" id="logout2">${ico('logout')}<span>${t('logout')}</span></button></div>
      </div>`;
    bindLang($('#view'));
    $('#logout2').onclick = logout;
  }

  const VIEWS = { dashboard: viewDashboard, offers: viewOffers, stats: viewStats, conversions: viewConversions, links: viewLinks, account: viewAccount };

  /* ───────────── boot ───────────── */
  window.addEventListener('hashchange', () => { if (state.me) route(); });
  document.documentElement.lang = lang;
  document.title = t('brand');
  api('/api/me').then((me) => { state.me = me; renderApp(); }, () => renderAuth('login'));
})();
