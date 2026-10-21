(() => {
  'use strict';

  /* ───────────── basics ───────────── */
  const I = window.I18N;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LANGS = [['kk', 'ҚАЗ'], ['ru', 'РУС'], ['en', 'ENG']];

  let lang = 'kk';
  try { lang = localStorage.getItem('lang') || 'kk'; } catch { /* storage blocked */ }
  if (!I[lang]) lang = 'kk';

  function t(key, vars) {
    let s = I[lang][key] ?? I.en[key] ?? key;
    if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  }
  const hasKey = (k) => Object.prototype.hasOwnProperty.call(I[lang], k);

  const state = { me: null, range: null, currency: 'USD', approved: null, chartMetric: 'earnings' };

  /* ───────────── formatting ───────────── */
  const locale = () => ({ kk: 'kk-KZ', ru: 'ru-RU', en: 'en-US' }[lang]);
  const fmtN = (n) => new Intl.NumberFormat(locale()).format(n || 0);
  const fmtP = (n) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 2 }).format(n || 0);
  const compact = (n) => new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
  function fmtMoney(n, cur) {
    try {
      return new Intl.NumberFormat(locale(), { style: 'currency', currency: cur || state.currency || 'USD' }).format(n || 0);
    } catch {
      return fmtN(n) + (cur ? ' ' + cur : '');
    }
  }
  const money = (n) => fmtMoney(n, state.currency);
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function presetRange(p) {
    const now = new Date();
    const to = ymd(now);
    const back = (days) => { const d = new Date(now); d.setDate(d.getDate() - days); return ymd(d); };
    if (p === 'today') return { from: to, to, preset: p };
    if (p === '7d') return { from: back(6), to, preset: p };
    if (p === 'month') return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to, preset: p };
    return { from: back(29), to, preset: '30d' };
  }
  state.range = presetRange('30d');

  /* ───────────── api ───────────── */
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'fetch', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.status === 401 && state.me && path !== '/api/auth/login') {
      state.me = null;
      renderAuth('login');
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

  function toast(msg, isErr) {
    const el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.textContent = msg;
    $('#toasts').append(el);
    setTimeout(() => el.remove(), 3800);
  }

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  /* ───────────── shared components ───────────── */
  function langSwitch() {
    return `<div class="langs" role="group" aria-label="${esc(t('language'))}">${LANGS.map(
      ([c, l]) => `<button type="button" data-lang="${c}" aria-pressed="${c === lang}">${l}</button>`
    ).join('')}</div>`;
  }
  function bindLang(root = document) {
    $$('[data-lang]', root).forEach((b) => {
      b.onclick = () => {
        lang = b.dataset.lang;
        try { localStorage.setItem('lang', lang); } catch { /* ignore */ }
        document.documentElement.lang = lang;
        closeDrawer();
        renderApp();
      };
    });
  }

  function rangeBar() {
    const r = state.range;
    return `<div class="range">
      <div class="seg" role="group">${['today', '7d', '30d', 'month'].map(
        (p) => `<button type="button" data-preset="${p}" aria-pressed="${r.preset === p}">${t('r_' + p)}</button>`
      ).join('')}</div>
      <label class="sr" for="r-from">${t('r_from')}</label>
      <input id="r-from" class="input" type="date" value="${r.from}">
      <span class="muted">–</span>
      <label class="sr" for="r-to">${t('r_to')}</label>
      <input id="r-to" class="input" type="date" value="${r.to}">
    </div>`;
  }
  function bindRange(onChange) {
    $$('[data-preset]').forEach((b) => { b.onclick = () => { state.range = presetRange(b.dataset.preset); onChange(); }; });
    const apply = () => {
      let from = $('#r-from').value, to = $('#r-to').value;
      if (!from || !to) return;
      if (from > to) [from, to] = [to, from];
      state.range = { from, to, preset: null };
      onChange();
    };
    $('#r-from').onchange = apply;
    $('#r-to').onchange = apply;
  }

  const emptyBlock = (title, hint, cta) =>
    `<div class="empty"><strong>${esc(title)}</strong>${hint ? `<span>${esc(hint)}</span>` : ''}${cta || ''}</div>`;

  function errorBlock(e, retryId = 'retry') {
    return `<div class="panel">${emptyBlock(errText(e), '', `<button class="btn" id="${retryId}">${t('retry')}</button>`)}</div>`;
  }

  function copyText(text) {
    const done = () => toast(t('copied'));
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = el('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch { /* ignore */ }
    ta.remove();
  }

  /* ───────────── modal & drawer ───────────── */
  function modal(html) {
    const ov = el('div', 'overlay'); ov.dataset.layer = 'modal';
    const box = el('div', 'modal'); box.dataset.layer = 'modal';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    box.innerHTML = html;
    document.body.append(ov, box);
    const close = () => { ov.remove(); box.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    ov.onclick = close;
    return { box, close };
  }

  function promptKey() {
    return new Promise((resolve) => {
      const { box, close } = modal(`
        <h2>${t('key_prompt_title')}</h2>
        <p class="hint">${t('api_key_help')}</p>
        <label class="field"><span>${t('api_key')}</span><input class="input" id="key-in" type="password" autocomplete="off" maxlength="200"></label>
        <div class="actions"><button class="btn" id="key-cancel" type="button">${t('cancel')}</button><button class="btn primary" id="key-ok" type="button">${t('save')}</button></div>`);
      const input = $('#key-in', box);
      input.focus();
      let settled = false;
      const obs = new MutationObserver(() => { if (!document.body.contains(box)) finish(null); });
      const finish = (v) => { if (settled) return; settled = true; obs.disconnect(); close(); resolve(v); };
      $('#key-cancel', box).onclick = () => finish(null);
      $('#key-ok', box).onclick = () => finish(input.value.trim() || null);
      input.onkeydown = (e) => { if (e.key === 'Enter') finish(input.value.trim() || null); };
      obs.observe(document.body, { childList: true });
    });
  }

  let escHandler = null;
  function closeDrawer() {
    $$('[data-layer="drawer"]').forEach((n) => n.remove());
    if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
  }

  /* ───────────── offer helpers ───────────── */
  const OP = { is_equal: '=', not_equal: '≠', contains: '∋', not_contains: '∌' };
  const pretty = (s) => String(s || '').replace(/_/g, ' ');
  const initials = (name) => (String(name).trim().match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();

  const SUB_FIELDS = ['aff_sub1', 'aff_sub2', 'aff_sub3', 'aff_sub4', 'aff_sub5', 'sub_aff_id', 'aff_click_id', 'source'];
  const subLabel = (f) => (f.startsWith('aff_sub') ? f : t('p_' + f));

  function builderHTML(impressionUrl) {
    return `<div class="copybox" data-builder>
      <div class="form-row">${SUB_FIELDS.map(
        (f) => `<label class="field"><span>${esc(subLabel(f))}</span><input class="input" data-param="${f}" maxlength="100" autocomplete="off"></label>`
      ).join('')}</div>
      <label class="field"><span>${t('tracking_link')}</span><textarea class="input" data-out readonly rows="3"></textarea></label>
      <div><button class="btn primary small" type="button" data-copy>${t('copy')}</button></div>
      ${impressionUrl ? `<label class="field"><span>${t('impression_link')}</span><input class="input" readonly value="${esc(impressionUrl)}"></label>` : ''}
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
    update();
  }

  const reqLabel = (v) => {
    const k = 'req_' + String(v).toLowerCase().replace(/\W+/g, '_');
    return hasKey(k) ? t(k) : String(v);
  };

  async function requestAccess(offer, btn, onDone) {
    let key = null;
    if (!state.me.hasApiKey) {
      key = await promptKey();
      if (!key) return;
    }
    btn.disabled = true;
    try {
      const r = await api('/api/offers/request', { method: 'POST', body: { offerIds: [offer.id], apiKey: key || undefined } });
      state.me.hasApiKey = true;
      state.approved = null;
      toast(reqLabel(r.result[offer.id]));
      onDone();
    } catch (e) {
      if (key) {
        try { await api('/api/settings/api-key', { method: 'POST', body: { apiKey: '' } }); } catch { /* ignore */ }
        state.me.hasApiKey = false;
      }
      toast(errText(e), true);
    } finally {
      btn.disabled = false;
    }
  }

  function drawerHTML(o) {
    const payoutRows = o.payouts.length
      ? o.payouts.map((p) => `<tr>
          <td class="price">${fmtMoney(p.price, p.currency || o.currency)} <small>${esc(p.model)}</small></td>
          <td class="wrap">${p.conditions.length
            ? p.conditions.map((c) => `<span class="chip">${esc(pretty(c.field))} ${esc(OP[c.op] || pretty(c.op))} ${esc(c.value)}</span>`).join('')
            : `<span class="muted">${t('any_conditions')}</span>`}</td></tr>`).join('')
      : `<tr><td class="price">${fmtMoney(o.price, o.currency)} <small>${esc(o.model)}</small></td><td><span class="muted">${t('any_conditions')}</span></td></tr>`;

    const chips = (arr, cls = '') => arr.map((x) => `<span class="chip ${cls}">${esc(x)}</span>`).join('');
    const targeting = [];
    if (o.geo.allow.length) targeting.push([`${t('geo')}, ${t('allowed')}`, chips(o.geo.allow)]);
    if (o.geo.block.length) targeting.push([`${t('geo')}, ${t('blocked')}`, chips(o.geo.block, 'block')]);
    if (o.device.length) targeting.push([t('devices'), chips(o.device)]);
    if (o.os.length) targeting.push([t('os'), chips(o.os)]);
    if (o.browser.length) targeting.push([t('browsers'), chips(o.browser)]);

    let access = '';
    if (o.access === 'approved' && o.trackingUrl) {
      access = `<section><h3>${t('link_builder')}</h3>${builderHTML(o.impressionUrl)}<p class="hint" style="margin-top:8px">${t('link_help')}</p></section>`;
    } else if (o.access === 'open') {
      access = `<section><button class="btn primary" type="button" data-request>${t('request_access')}</button></section>`;
    } else if (o.access === 'pending') {
      access = `<section><div class="notice warn">${t('access_pending')}</div></section>`;
    }

    return `
      <div class="drawer-head">
        <div class="offer-logo">${o.logo ? `<img src="${esc(o.logo)}" alt="" referrerpolicy="no-referrer">` : esc(initials(o.name))}</div>
        <div style="flex:1;min-width:0">
          <h2 style="overflow-wrap:anywhere">${esc(o.name)}</h2>
          <div class="offer-meta" style="margin-top:4px"><span>ID ${esc(o.id)}</span><span class="badge ${o.access}">${t('access_' + o.access)}</span></div>
        </div>
        <button class="btn small ghost" type="button" id="d-close" aria-label="${esc(t('close'))}">✕</button>
      </div>
      <div class="drawer-body">
        ${access}
        <section><h3>${t('payouts')}</h3><div class="panel table-wrap"><table><thead><tr><th>${t('payout')}</th><th>${t('conditions')}</th></tr></thead><tbody>${payoutRows}</tbody></table></div></section>
        ${o.description ? `<section><h3>${t('description')}</h3><p class="pre">${esc(o.description)}</p></section>` : ''}
        ${o.kpi ? `<section><h3>KPI</h3><p class="pre">${esc(o.kpi)}</p></section>` : ''}
        ${targeting.length ? `<section><h3>${t('targeting')}</h3><dl class="kv">${targeting.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl></section>` : ''}
        ${o.caps.length ? `<section><h3>${t('caps')}</h3><div class="panel table-wrap"><table><thead><tr><th></th><th>${t('cap_period')}</th><th class="r">${t('cap_limit')}</th></tr></thead><tbody>${o.caps.map(
          (c) => `<tr><td>${esc(pretty(c.type))}${c.event ? ` <span class="chip">${esc(c.event)}</span>` : ''}</td><td>${esc(pretty(c.period))}</td><td class="r num">${esc(c.value)}</td></tr>`
        ).join('')}</tbody></table></div></section>` : ''}
        ${o.events.length ? `<section><h3>${t('events')}</h3>${o.events.map((e) => `<span class="chip">${esc(e.name || e.token)}</span>`).join('')}</section>` : ''}
        ${o.creatives.length ? `<section><h3>${t('creatives')}</h3><div class="creatives">${o.creatives.map(
          (c) => `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${c.type === 'image' ? `<img src="${esc(c.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span>${esc(c.type)}</span></a>`
        ).join('')}</div></section>` : ''}
        ${o.previewUrl ? `<section><a href="${esc(o.previewUrl)}" target="_blank" rel="noopener noreferrer">${t('preview')}</a></section>` : ''}
        ${o.end ? `<p class="hint">${t('valid_until')}: ${esc(String(o.end).slice(0, 10))}</p>` : ''}
      </div>`;
  }

  function openOffer(o, { onChange, focusBuilder } = {}) {
    closeDrawer();
    const ov = el('div', 'overlay'); ov.dataset.layer = 'drawer';
    const dr = el('aside', 'drawer'); dr.dataset.layer = 'drawer';
    dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-modal', 'true'); dr.setAttribute('aria-label', o.name);
    dr.innerHTML = drawerHTML(o);
    document.body.append(ov, dr);
    ov.onclick = closeDrawer;
    $('#d-close', dr).onclick = closeDrawer;
    escHandler = (e) => { if (e.key === 'Escape' && !$('[data-layer="modal"]')) closeDrawer(); };
    document.addEventListener('keydown', escHandler);
    const b = $('[data-builder]', dr);
    if (b) {
      bindBuilder(b, o.trackingUrl);
      if (focusBuilder) b.scrollIntoView({ block: 'center' });
    }
    const rq = $('[data-request]', dr);
    if (rq) rq.onclick = () => requestAccess(o, rq, () => { closeDrawer(); if (onChange) onChange(); });
    $('#d-close', dr).focus();
  }

  /* ───────────── shell & routing ───────────── */
  const NAV = ['dashboard', 'offers', 'stats', 'conversions', 'links', 'account'];

  function renderShell() {
    const me = state.me;
    $('#app').innerHTML = `
      ${me.demo ? `<div class="demo-bar">${t('demo_banner')}</div>` : ''}
      <div class="shell">
        <aside class="side">
          <div class="brandmark"><div class="logo">W</div><span>${t('brand')}</span></div>
          <nav class="nav" aria-label="main">${NAV.map((n) => `<a href="#/${n}" data-nav="${n}">${t('nav_' + n)}</a>`).join('')}</nav>
          <div class="side-foot">
            <div class="who">${esc(me.email)}<br><span class="muted">ID ${esc(me.id)}</span></div>
            ${langSwitch()}
            <button class="btn small" type="button" id="logout">${t('logout')}</button>
          </div>
        </aside>
        <main class="main" id="view"></main>
      </div>`;
    bindLang();
    $('#logout').onclick = logout;
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    state.me = null; state.approved = null;
    closeDrawer();
    renderAuth('login');
  }

  let viewTok = 0;
  async function render(viewFn) {
    const tok = ++viewTok;
    const alive = () => tok === viewTok;
    const main = $('#view');
    if (!main) return;
    main.innerHTML = '<div class="stack"><div class="skeleton"></div><div class="skeleton"></div></div>';
    try {
      await viewFn(alive);
    } catch (e) {
      if (!alive()) return;
      main.innerHTML = errorBlock(e);
      $('#retry').onclick = () => render(viewFn);
    }
  }

  function route() {
    if (!state.me) return;
    const raw = location.hash.replace(/^#\/?/, '').split('/')[0] || 'dashboard';
    const name = VIEWS[raw] ? raw : 'dashboard';
    $$('.nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.nav === name ? 'page' : 'false'));
    closeDrawer();
    window.scrollTo(0, 0);
    render(VIEWS[name]);
  }

  function renderApp() {
    if (!state.me) return renderAuth('login');
    renderShell();
    route();
  }

  /* ───────────── auth ───────────── */
  const COUNTRIES = ['KZ', 'UZ', 'KG', 'TJ', 'TM', 'RU', 'BY', 'UA', 'AZ', 'AM', 'GE', 'TR', 'AE', 'DE', 'US'];
  function regionName(code, l) {
    try { return new Intl.DisplayNames([l], { type: 'region' }).of(code) || code; } catch { return code; }
  }

  function renderAuth(mode = 'login', flash = '') {
    closeDrawer();
    document.documentElement.lang = lang;
    const isLogin = mode === 'login';
    $('#app').innerHTML = `
      <div class="auth">
        <section class="auth-side">
          <div class="brandmark"><div class="logo">W</div><span>${t('brand')}</span></div>
          <div><h1>${t('auth_title')}</h1><p>${t('auth_sub')}</p></div>
          <span></span>
        </section>
        <section class="auth-main">
          <div class="auth-top">${langSwitch()}</div>
          <div class="auth-card">
            <div class="tabs" role="tablist">
              <button class="tab" role="tab" type="button" data-mode="login" aria-selected="${isLogin}">${t('login')}</button>
              <button class="tab" role="tab" type="button" data-mode="register" aria-selected="${!isLogin}">${t('register')}</button>
            </div>
            ${flash ? `<div class="notice">${esc(flash)}</div>` : ''}
            ${isLogin ? loginForm() : registerForm()}
          </div>
        </section>
      </div>`;
    bindLang();
    $$('[data-mode]').forEach((b) => { b.onclick = () => renderAuth(b.dataset.mode); });
    const form = $('#auth-form');
    form.onsubmit = (e) => { e.preventDefault(); (isLogin ? submitLogin : submitRegister)(form); };
    const first = $('input, select', form);
    if (first) first.focus();
  }

  const loginForm = () => `
    <form class="form" id="auth-form" novalidate>
      <label class="field"><span>${t('email')}</span><input class="input" name="email" type="email" autocomplete="username" required></label>
      <label class="field"><span>${t('password')}</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <div class="error" id="auth-err" role="alert"></div>
      <button class="btn primary" type="submit">${t('login')}</button>
    </form>`;

  const registerForm = () => `
    <form class="form" id="auth-form" novalidate>
      <div class="form-row">
        <label class="field"><span>${t('first_name')}</span><input class="input" name="firstName" autocomplete="given-name" maxlength="60" required></label>
        <label class="field"><span>${t('last_name')}</span><input class="input" name="lastName" autocomplete="family-name" maxlength="60" required></label>
      </div>
      <label class="field"><span>${t('email')}</span><input class="input" name="email" type="email" autocomplete="email" required></label>
      <label class="field"><span>${t('password')}</span><input class="input" name="password" type="password" autocomplete="new-password" minlength="8" required><small class="hint">${t('password_hint')}</small></label>
      <div class="form-row">
        <label class="field"><span>${t('phone')}</span><input class="input" name="mobile" type="tel" autocomplete="tel" placeholder="+7" required></label>
        <label class="field"><span>${t('country')}</span><select class="input" name="country" required>
          <option value="">${t('choose')}</option>
          ${COUNTRIES.map((c) => `<option value="${esc(regionName(c, 'en'))}">${esc(regionName(c, lang))}</option>`).join('')}
        </select></label>
      </div>
      <div class="form-row">
        <label class="field"><span>${t('messenger')}</span><select class="input" name="imType">
          <option value="telegram">Telegram</option><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="skype">Skype</option><option value="other">${t('other')}</option>
        </select></label>
        <label class="field"><span>${t('messenger_handle')}</span><input class="input" name="imValue" maxlength="80" required></label>
      </div>
      <label class="field"><span>${t('company')}</span><input class="input" name="company" maxlength="100"></label>
      <div class="error" id="auth-err" role="alert"></div>
      <button class="btn primary" type="submit">${t('register')}</button>
    </form>`;

  async function enter() {
    state.me = await api('/api/me');
    state.approved = null;
    location.hash = '#/dashboard';
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
  function delta(cur, prev) {
    if (!prev) return '';
    const p = (cur - prev) / prev;
    if (!Number.isFinite(p) || Math.abs(p) < 0.0005) return '';
    return `<span class="delta ${p > 0 ? 'up' : 'down'}">${p > 0 ? '▲' : '▼'} ${new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 1 }).format(Math.abs(p))}</span>`;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  function barChart(daily, metric) {
    const W = 720, H = 240, L = 46, R = 8, T = 10, B = 26;
    const vals = daily.map((d) => d[metric]);
    const max = niceMax(Math.max(...vals, 0));
    const bw = (W - L - R) / Math.max(daily.length, 1);
    const ph = H - T - B;
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const y = T + ph * (1 - i / 4);
      g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${esc(compact((max * i) / 4))}</text>`;
    }
    const step = Math.ceil(daily.length / 8);
    let bars = '', labels = '';
    daily.forEach((d, i) => {
      const h = (d[metric] / max) * ph;
      const x = L + i * bw + bw * 0.14;
      const label = `${d.date.slice(8)}.${d.date.slice(5, 7)}`;
      const shown = metric === 'earnings' ? money(d[metric]) : fmtN(d[metric]);
      if (h > 0) bars += `<rect class="bar" x="${x.toFixed(1)}" y="${(T + ph - h).toFixed(1)}" width="${(bw * 0.72).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"><title>${esc(label)}: ${esc(shown)}</title></rect>`;
      if (i % step === 0) labels += `<text x="${(x + bw * 0.36).toFixed(1)}" y="${H - 8}" text-anchor="middle">${label}</text>`;
    });
    return `<svg class="chart ${metric === 'earnings' ? 'is-money' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('chart_title') + ': ' + t(metric))}">${g}${bars}${labels}</svg>`;
  }

  const miniTable = (head, rows) => `<div class="table-wrap"><table><thead><tr>${head.map((h, i) => `<th class="${i ? 'r' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

  async function viewDashboard(alive) {
    const r = state.range;
    const d = await api(`/api/dashboard?from=${r.from}&to=${r.to}`);
    if (!alive()) return;
    state.currency = d.currency || state.currency;
    const T = d.totals, P = d.previous;
    const noData = !T.clicks && !T.conversions;

    const kpi = (label, value, dl) => `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${dl || ''}</div></div>`;

    $('#view').innerHTML = `
      <div class="page-head"><h1>${t('nav_dashboard')}</h1>${rangeBar()}</div>
      ${d.truncated ? `<div class="notice warn" style="margin-bottom:12px">${t('truncated_warn')}</div>` : ''}
      <div class="kpis">
        <div class="kpi money">
          <div class="label">${t('earnings')}</div>
          <div class="value">${money(T.earnings)}</div>
          <div class="sub">${delta(T.earnings, P.earnings)}${delta(T.earnings, P.earnings) ? `<span>${t('vs_prev')}</span>` : ''}</div>
          <div class="sub"><span>${t('approved')}: ${money(T.approvedEarnings)}</span><span>${t('pending')}: ${money(T.pendingEarnings)}</span></div>
        </div>
        ${kpi(t('clicks'), fmtN(T.clicks), delta(T.clicks, P.clicks))}
        ${kpi(t('conversions'), fmtN(T.conversions), delta(T.conversions, P.conversions))}
        ${kpi(t('cr'), fmtP(T.cr), delta(T.cr, P.cr))}
        ${kpi(t('epc'), money(T.epc), delta(T.epc, P.epc))}
      </div>
      <div class="kpis kpis-2">
        ${kpi(t('unique'), fmtN(T.unique))}
        ${kpi(t('approved'), fmtN(T.approved))}
        ${kpi(t('pending'), fmtN(T.pending))}
        ${kpi(t('rejected'), fmtN(T.rejected))}
      </div>
      <div class="stack" style="margin-top:16px">
        ${noData
          ? `<div class="panel">${emptyBlock(t('no_data'), t('no_data_hint'), `<a class="btn primary" href="#/offers">${t('go_offers')}</a>`)}</div>`
          : `<div class="panel">
              <div class="panel-head"><h2>${t('chart_title')}</h2>
                <div class="chart-tabs" role="group">${['earnings', 'clicks', 'conversions'].map((m) => `<button type="button" data-metric="${m}" aria-pressed="${state.chartMetric === m}">${t(m)}</button>`).join('')}</div>
              </div>
              <div class="panel-body" id="chart">${barChart(d.daily, state.chartMetric)}</div>
            </div>
            <div class="grid-2">
              <div class="panel"><div class="panel-head"><h2>${t('top_offers')}</h2></div>${miniTable([t('g_offer'), t('clicks'), t('conversions'), t('earnings')],
                d.topOffers.map((o) => `<tr><td class="wrap"><strong>${esc(o.label || o.key)}</strong>${o.label ? ` <span class="muted">${esc(o.key)}</span>` : ''}</td><td class="r num">${fmtN(o.clicks)}</td><td class="r num">${fmtN(o.conversions)}</td><td class="r num">${money(o.earnings)}</td></tr>`))}</div>
              <div class="panel"><div class="panel-head"><h2>${t('top_countries')}</h2></div>${miniTable([t('g_country'), t('clicks'), t('conversions'), t('earnings')],
                d.topCountries.map((c) => `<tr><td>${esc(c.key)}</td><td class="r num">${fmtN(c.clicks)}</td><td class="r num">${fmtN(c.conversions)}</td><td class="r num">${money(c.earnings)}</td></tr>`))}</div>
            </div>`}
      </div>`;

    bindRange(() => render(viewDashboard));
    $$('[data-metric]').forEach((b) => {
      b.onclick = () => {
        state.chartMetric = b.dataset.metric;
        $('#chart').innerHTML = barChart(d.daily, state.chartMetric);
        $$('[data-metric]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      };
    });
  }

  /* ───────────── offers ───────────── */
  async function viewOffers(alive) {
    const f = { q: '', category: '', model: '', country: '', access: '', page: 1 };
    const cache = new Map();
    let reqId = 0, facetsDone = false;

    $('#view').innerHTML = `
      <div class="page-head"><h1>${t('nav_offers')}</h1><span class="muted" id="count"></span></div>
      <div class="filters">
        <input id="f-q" class="input" type="search" placeholder="${esc(t('search_offers'))}" aria-label="${esc(t('search_offers'))}">
        <select id="f-category" class="input" aria-label="${esc(t('all_categories'))}"><option value="">${t('all_categories')}</option></select>
        <select id="f-model" class="input" aria-label="${esc(t('model'))}"><option value="">${t('all_models')}</option></select>
        <select id="f-country" class="input" aria-label="${esc(t('country'))}"><option value="">${t('all_countries')}</option></select>
        <select id="f-access" class="input" aria-label="${esc(t('all_access'))}">
          <option value="">${t('all_access')}</option>
          ${['approved', 'pending', 'open'].map((a) => `<option value="${a}">${t('access_' + a)}</option>`).join('')}
        </select>
      </div>
      <div class="panel" id="offer-list"><div class="skeleton"></div></div>`;
    if (!alive()) return;

    const fillSelect = (id, items, label) => {
      const sel = $(id);
      sel.innerHTML = `<option value="">${label}</option>` + items.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
    };

    async function load() {
      const my = ++reqId;
      const box = $('#offer-list');
      try {
        const qs = new URLSearchParams({ ...f, page: String(f.page) });
        for (const [k, v] of [...qs]) if (!v) qs.delete(k);
        const d = await api('/api/offers?' + qs);
        if (my !== reqId || !alive()) return;
        if (!facetsDone) {
          facetsDone = true;
          fillSelect('#f-category', d.facets.categories, t('all_categories'));
          fillSelect('#f-model', d.facets.models, t('all_models'));
          fillSelect('#f-country', d.facets.countries, t('all_countries'));
        }
        $('#count').textContent = t('offers_found', { n: fmtN(d.total) });
        d.rows.forEach((o) => cache.set(o.id, o));
        const pages = Math.max(1, Math.ceil(d.total / d.perPage));
        box.innerHTML = d.rows.length
          ? d.rows.map(offerRow).join('') + (pages > 1 ? `<div class="pager"><button class="btn small" id="pg-prev" ${d.page <= 1 ? 'disabled' : ''}>${t('back')}</button><span>${t('page_of', { p: d.page, n: pages })}</span><button class="btn small" id="pg-next" ${d.page >= pages ? 'disabled' : ''}>${t('next')}</button></div>` : '')
          : emptyBlock(t('no_offers'));
        if (pages > 1) {
          $('#pg-prev').onclick = () => { f.page--; load(); };
          $('#pg-next').onclick = () => { f.page++; load(); };
        }
        $$('[data-open]', box).forEach((b) => {
          b.onclick = () => openOffer(cache.get(b.dataset.open), { onChange: load, focusBuilder: b.dataset.link === '1' });
        });
        $$('[data-req]', box).forEach((b) => {
          b.onclick = () => requestAccess(cache.get(b.dataset.req), b, load);
        });
      } catch (e) {
        if (my !== reqId || !alive()) return;
        box.innerHTML = emptyBlock(errText(e), '', `<button class="btn" id="retry-list">${t('retry')}</button>`);
        $('#retry-list').onclick = load;
      }
    }

    function offerRow(o) {
      const geo = o.geo.allow.slice(0, 4).map((g) => `<span class="chip">${esc(g)}</span>`).join('') + (o.geo.allow.length > 4 ? `<span class="chip">+${o.geo.allow.length - 4}</span>` : '');
      let act = `<button class="btn small" type="button" data-open="${esc(o.id)}">${t('details')}</button>`;
      if (o.access === 'approved') act = `<button class="btn small primary" type="button" data-open="${esc(o.id)}" data-link="1">${t('get_link')}</button>` + act;
      if (o.access === 'open') act = `<button class="btn small primary" type="button" data-req="${esc(o.id)}">${t('request_access')}</button>` + act;
      return `<div class="offer-row">
        <div class="offer-logo">${o.logo ? `<img src="${esc(o.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(initials(o.name))}</div>
        <div style="min-width:0"><div class="offer-name">${esc(o.name)}</div><div class="offer-meta"><span>ID ${esc(o.id)}</span>${o.categories.length ? `<span>${esc(o.categories.join(', '))}</span>` : ''}</div></div>
        <div class="hide-sm">${geo}</div>
        <div class="price">${fmtMoney(o.price, o.currency)} <small>${esc(o.model)}</small></div>
        <div class="hide-sm"><span class="badge ${o.access}">${t('access_' + o.access)}</span></div>
        <div class="actions">${act}</div>
      </div>`;
    }

    let timer;
    $('#f-q').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { f.q = e.target.value.trim(); f.page = 1; load(); }, 300); };
    for (const [id, key] of [['#f-category', 'category'], ['#f-model', 'model'], ['#f-country', 'country'], ['#f-access', 'access']]) {
      $(id).onchange = (e) => { f[key] = e.target.value; f.page = 1; load(); };
    }
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
    ['impressions', 'impressions', fmtN], ['clicks', 'clicks', fmtN], ['unique', 'unique', fmtN], ['conversions', 'conversions', fmtN],
    ['approved', 'approved', fmtN], ['pending', 'pending', fmtN], ['rejected', 'rejected', fmtN],
    ['earnings', 'earnings', (v) => money(v)], ['cr', 'cr', fmtP], ['epc', 'epc', (v) => money(v)],
  ];

  async function viewStats(alive) {
    const r = state.range;
    const [approved] = await Promise.all([loadApproved()]);
    if (!alive()) return;
    $('#view').innerHTML = `
      <div class="page-head"><h1>${t('nav_stats')}</h1>${rangeBar()}</div>
      <div class="range" style="margin-bottom:14px">
        <label class="field" style="grid-auto-flow:column;align-items:center;gap:8px"><span>${t('group_by')}</span>
          <select id="s-group" class="input" style="width:auto">${GROUP_KEYS.map((g) => `<option value="${g}" ${g === sv.group ? 'selected' : ''}>${t('g_' + g)}</option>`).join('')}</select></label>
        <select id="s-offer" class="input" style="width:auto;max-width:260px" aria-label="${esc(t('all_offers'))}">
          <option value="">${t('all_offers')}</option>${approved.map((o) => `<option value="${esc(o.id)}" ${o.id === sv.offer ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
        </select>
        <a class="btn" id="s-csv" href="#">${t('export_csv')}</a>
      </div>
      <div class="panel" id="stats-table"><div class="skeleton"></div></div>`;
    bindRange(() => render(viewStats));

    let reqId = 0, data = null;
    const qs = () => new URLSearchParams({ from: r.from, to: r.to, group: sv.group, ...(sv.offer ? { offer: sv.offer } : {}) });
    const paintTable = () => {
      const box = $('#stats-table');
      if (!data.rows.length) { box.innerHTML = emptyBlock(t('no_data'), t('no_data_hint')); return; }
      const rows = [...data.rows];
      if (sv.sort) rows.sort((a, b) => (a[sv.sort] - b[sv.sort]) * sv.dir);
      const first = (g) => (sv.group === 'offer' ? `<strong>${esc(g.label || g.key)}</strong>${g.label ? ` <span class="muted">${esc(g.key)}</span>` : ''}` : esc(g.key));
      const T = data.totals;
      box.innerHTML = `${data.truncated ? `<div class="notice warn" style="margin:12px">${t('truncated_warn')}</div>` : ''}
        <div class="table-wrap"><table>
          <thead><tr><th>${t('g_' + sv.group)}</th>${STAT_COLS.map(([k, l]) => `<th class="r sortable" data-sort="${k}" aria-sort="${sv.sort === k ? (sv.dir > 0 ? 'ascending' : 'descending') : 'none'}">${t(l)}${sv.sort === k ? (sv.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
          <tbody>${rows.map((g) => `<tr><td class="wrap">${first(g)}</td>${STAT_COLS.map(([k, , fm]) => `<td class="r num">${fm(g[k])}</td>`).join('')}</tr>`).join('')}</tbody>
          <tfoot><tr><td>${t('totals')}</td>${STAT_COLS.map(([k, , fm]) => `<td class="r num">${fm(T[k])}</td>`).join('')}</tr></tfoot>
        </table></div>`;
      $$('[data-sort]', box).forEach((th) => {
        th.onclick = () => {
          if (sv.sort === th.dataset.sort) sv.dir = -sv.dir; else { sv.sort = th.dataset.sort; sv.dir = -1; }
          paintTable();
        };
      });
    };
    async function load() {
      const my = ++reqId;
      $('#s-csv').href = '/api/stats/export.csv?' + qs();
      $('#stats-table').innerHTML = '<div class="skeleton"></div>';
      try {
        const d = await api('/api/stats?' + qs());
        if (my !== reqId || !alive()) return;
        state.currency = d.currency || state.currency;
        data = d;
        paintTable();
      } catch (e) {
        if (my !== reqId || !alive()) return;
        $('#stats-table').innerHTML = emptyBlock(errText(e), '', `<button class="btn" id="retry-s">${t('retry')}</button>`);
        $('#retry-s').onclick = load;
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
      <div class="page-head"><h1>${t('nav_conversions')}</h1>${rangeBar()}</div>
      <div class="range" style="margin-bottom:14px">
        <select id="c-status" class="input" style="width:auto" aria-label="${esc(t('status'))}">
          <option value="">${t('all_statuses')}</option>${['approved', 'pending', 'rejected'].map((s) => `<option value="${s}" ${cv.status === s ? 'selected' : ''}>${t(s)}</option>`).join('')}
        </select>
        <select id="c-offer" class="input" style="width:auto;max-width:260px" aria-label="${esc(t('all_offers'))}">
          <option value="">${t('all_offers')}</option>${approved.map((o) => `<option value="${esc(o.id)}" ${o.id === cv.offer ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
        </select>
        <span class="muted" id="c-count"></span>
      </div>
      <div class="panel" id="conv-table"><div class="skeleton"></div></div>`;
    bindRange(() => { cv.page = 1; render(viewConversions); });

    let reqId = 0;
    async function load() {
      const my = ++reqId;
      const box = $('#conv-table');
      try {
        const qs = new URLSearchParams({ from: r.from, to: r.to, page: String(cv.page), ...(cv.status ? { status: cv.status } : {}), ...(cv.offer ? { offer: cv.offer } : {}) });
        const d = await api('/api/conversions?' + qs);
        if (my !== reqId || !alive()) return;
        $('#c-count').textContent = `${t('conversions')}: ${fmtN(d.total)}`;
        const pages = Math.max(1, Math.ceil(d.total / d.perPage));
        if (!d.rows.length) { box.innerHTML = emptyBlock(t('no_conversions')); return; }
        box.innerHTML = `${d.truncated ? `<div class="notice warn" style="margin:12px">${t('truncated_warn')}</div>` : ''}<div class="table-wrap"><table>
          <thead><tr><th>${t('time')}</th><th>${t('g_offer')}</th><th>${t('event')}</th><th>${t('status')}</th><th class="r">${t('payout')}</th><th>${t('g_country')}</th><th>${t('subs')}</th><th>${t('click_id')}</th></tr></thead>
          <tbody>${d.rows.map((x) => {
            const subs = [x.sub1, x.sub2, x.sub3, x.sub4, x.sub5].filter(Boolean).join(', ');
            return `<tr><td class="num">${esc(x.time)}</td><td class="wrap"><strong>${esc(x.offerName || x.offerId)}</strong>${x.offerName ? ` <span class="muted">${esc(x.offerId)}</span>` : ''}</td>
              <td>${esc(x.event)}</td><td><span class="badge ${esc(x.status)}">${t(x.status)}</span></td><td class="r num">${fmtMoney(x.price, x.currency || state.currency)}</td>
              <td>${esc(x.country)}</td><td class="wrap">${esc(subs)}</td><td class="muted">${esc(x.clickId)}</td></tr>`;
          }).join('')}</tbody></table></div>
          ${pages > 1 ? `<div class="pager"><button class="btn small" id="c-prev" ${d.page <= 1 ? 'disabled' : ''}>${t('back')}</button><span>${t('page_of', { p: d.page, n: pages })}</span><button class="btn small" id="c-next" ${d.page >= pages ? 'disabled' : ''}>${t('next')}</button></div>` : ''}`;
        if (pages > 1) {
          $('#c-prev').onclick = () => { cv.page--; load(); };
          $('#c-next').onclick = () => { cv.page++; load(); };
        }
      } catch (e) {
        if (my !== reqId || !alive()) return;
        box.innerHTML = emptyBlock(errText(e), '', `<button class="btn" id="retry-c">${t('retry')}</button>`);
        $('#retry-c').onclick = load;
      }
    }
    $('#c-status').onchange = (e) => { cv.status = e.target.value; cv.page = 1; load(); };
    $('#c-offer').onchange = (e) => { cv.offer = e.target.value; cv.page = 1; load(); };
    await load();
  }

  /* ───────────── links ───────────── */
  async function viewLinks(alive) {
    const list = await loadApproved();
    if (!alive()) return;
    if (!list.length) {
      $('#view').innerHTML = `<div class="page-head"><h1>${t('nav_links')}</h1></div>
        <div class="panel">${emptyBlock(t('no_approved'), '', `<a class="btn primary" href="#/offers">${t('go_offers')}</a>`)}</div>`;
      return;
    }
    $('#view').innerHTML = `
      <div class="page-head"><h1>${t('link_builder')}</h1></div>
      <div class="panel"><div class="panel-body stack">
        <label class="field"><span>${t('choose_offer')}</span><select id="l-offer" class="input">${list.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></label>
        <div id="l-builder"></div>
        <p class="hint">${t('link_help')}</p>
      </div></div>`;
    const paint = () => {
      const o = list.find((x) => x.id === $('#l-offer').value) || list[0];
      $('#l-builder').innerHTML = builderHTML(o.impressionUrl);
      bindBuilder($('#l-builder'), o.trackingUrl);
    };
    $('#l-offer').onchange = paint;
    paint();
  }

  /* ───────────── account ───────────── */
  async function viewAccount(alive) {
    const me = await api('/api/me');
    if (!alive()) return;
    state.me = { ...state.me, ...me };
    $('#view').innerHTML = `
      <div class="page-head"><h1>${t('nav_account')}</h1></div>
      <div class="stack" style="max-width:720px">
        <div class="panel"><div class="panel-body"><dl class="kv">
          <dt>${t('affiliate_id')}</dt><dd class="num">${esc(me.id)}</dd>
          <dt>${t('email')}</dt><dd>${esc(me.email)}</dd>
          ${me.name ? `<dt>${t('first_name')}</dt><dd>${esc(me.name)}</dd>` : ''}
          <dt>${t('language')}</dt><dd>${langSwitch()}</dd>
        </dl></div></div>
        <div class="panel"><div class="panel-head"><h2>${t('api_key')}</h2><span class="badge ${me.hasApiKey ? 'approved' : ''}">${me.hasApiKey ? t('key_connected') : t('key_missing')}</span></div>
          <div class="panel-body"><form class="form" id="key-form">
            <label class="field"><span>${t('api_key')}</span><input class="input" name="apiKey" type="password" autocomplete="off" maxlength="200"></label>
            <p class="hint">${t('api_key_help')}</p>
            <div class="actions" style="justify-content:flex-start"><button class="btn primary" type="submit">${t('save')}</button>${me.hasApiKey ? `<button class="btn" type="button" id="key-remove">${t('remove')}</button>` : ''}</div>
          </form></div></div>
        <p class="hint">${t('earnings_note')}</p>
        <div><button class="btn" type="button" id="logout2">${t('logout')}</button></div>
      </div>`;
    bindLang($('#view'));
    $('#logout2').onclick = logout;
    const saveKey = async (apiKey) => {
      try {
        const r = await api('/api/settings/api-key', { method: 'POST', body: { apiKey } });
        state.me.hasApiKey = r.hasApiKey;
        render(viewAccount);
      } catch (e) { toast(errText(e), true); }
    };
    $('#key-form').onsubmit = (e) => { e.preventDefault(); const v = e.target.elements.apiKey.value.trim(); if (v) saveKey(v); };
    const rm = $('#key-remove');
    if (rm) rm.onclick = () => saveKey('');
  }

  const VIEWS = { dashboard: viewDashboard, offers: viewOffers, stats: viewStats, conversions: viewConversions, links: viewLinks, account: viewAccount };

  /* ───────────── boot ───────────── */
  window.addEventListener('hashchange', () => { if (state.me) route(); });
  document.documentElement.lang = lang;
  api('/api/me').then((me) => { state.me = me; renderApp(); }, () => renderAuth('login'));
})();
