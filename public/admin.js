'use strict';
/* Teliks network admin: overview, partners, payouts, conversions (data: TrendMe API + Teliks DB). */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nf = new Intl.NumberFormat('ru-RU');
  const n = (v) => nf.format(Math.round(v || 0));
  const money = (v) => n(v) + ' ₸';
  const pct = (a, b) => (b ? (Math.round((a / b) * 1000) / 10).toLocaleString('ru-RU') + '%' : '—');
  const ALM = 5 * 3600000;
  const ymd = (ms) => new Date(ms + ALM).toISOString().slice(0, 10);
  const dt = (s) => (s ? new Date(s).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const day = (s) => new Date(s + 'T00:00:00Z').toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', weekday: 'short', timeZone: 'UTC' });
  const STATUS = { processing: ['В обработке', 'warn'], paid: ['Выплачено', 'ok'], rejected: ['Отклонено', 'mute'] };
  const CONV = { earned: ['Начислено', 'ok'], reversed: ['Отменено (возврат)', 'bad'] };
  const pill = ([t, c]) => `<span class="adm-pill ${c}">${esc(t)}</span>`;

  const state = { tab: 'overview', from: ymd(Date.now() - 29 * 86400000), to: ymd(Date.now()), data: null, q: '', sort: ['earnedKzt', -1], payStatus: 'processing', convStatus: '', convCode: '' };

  async function api(path, opts = {}) {
    const r = await fetch(path, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
    if (r.status === 401) { location.href = '/'; throw new Error('unauthorized'); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 403) throw new Error('Нет прав администратора.');
    if (!r.ok) throw new Error(j.error === 'upstream_unavailable' || j.error === 'upstream_error' ? 'TrendMe не ответил. Повторите через минуту.' : j.message || j.error || 'Ошибка');
    return j;
  }

  /* ───── charts ───── */
  function chart(daily) {
    const rows = [...daily].sort((a, b) => (a.day < b.day ? -1 : 1));
    if (!rows.length) return '<p class="adm-empty">Нет данных за период.</p>';
    const W = 640, H = 170, pad = 22, bw = (W - pad) / rows.length;
    const maxV = Math.max(1, ...rows.map((r) => r.visits));
    const maxP = Math.max(1, ...rows.map((r) => r.paidOrders));
    const bars = rows.map((r, i) => {
      const x = pad + i * bw;
      const h1 = ((H - 30) * r.visits) / maxV, h2 = ((H - 30) * r.paidOrders) / maxP;
      return `<rect class="bar" x="${x + bw * 0.12}" y="${H - 18 - h1}" width="${Math.max(1, bw * 0.38)}" height="${h1}"><title>${esc(r.day)}: ${r.visits} переходов</title></rect>` +
        `<rect class="bar2" x="${x + bw * 0.52}" y="${H - 18 - h2}" width="${Math.max(1, bw * 0.38)}" height="${h2}"><title>${esc(r.day)}: ${r.paidOrders} оплат, ${money(r.revenueKzt)}</title></rect>` +
        (rows.length <= 31 && (i % Math.ceil(rows.length / 10) === 0) ? `<text x="${x + bw / 2}" y="${H - 4}" text-anchor="middle">${esc(r.day.slice(8))}.${esc(r.day.slice(5, 7))}</text>` : '');
    }).join('');
    return `<svg class="adm-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Переходы и оплаты по дням">${bars}</svg>
      <div class="adm-legend"><span><i class="l1"></i>Переходы</span><span><i class="l2"></i>Оплаты</span></div>`;
  }

  const kpi = (label, value, sub = '', cls = '') => `<div class="adm-kpi ${cls}"><dt>${esc(label)}</dt><dd>${value}</dd>${sub ? `<small>${sub}</small>` : ''}</div>`;

  /* ───── views ───── */
  function overview(d) {
    const T = d.totals;
    const top = [...d.partners].sort((a, b) => b.period.earnedKzt - a.period.earnedKzt || b.period.visits - a.period.visits).slice(0, 8);
    return `
      <dl class="adm-kpis">
        ${kpi('Переходы', n(T.visits), 'открыли бот по ссылке')}
        ${kpi('Новые клиенты', n(T.users), `CR переход → клиент ${pct(T.users, T.visits)}`)}
        ${kpi('Оплаты', n(T.paidOrders), `покупателей: ${n(T.buyers)} · CR ${pct(T.buyers, T.users)}`)}
        ${kpi('Оборот', money(T.revenueKzt), `средний чек ${T.paidOrders ? money(T.revenueKzt / T.paidOrders) : '—'}`)}
        ${kpi('Начислено партнёрам', money(T.earnedKzt), `EPC ${T.visits ? money(T.earnedKzt / T.visits) : '—'}${T.reversedKzt ? ` · отменено ${money(T.reversedKzt)}` : ''}`, 'is-gold')}
        ${kpi('Выплачено за период', money(T.paidOutKzt), 'по заявкам Teliks')}
        ${kpi('К выплате (всем)', money(T.balanceKzt), 'начислено − выплачено')}
        ${kpi('Заявки в обработке', money(T.processingKzt), `${n(T.processingCount)} шт.`, T.processingCount ? 'is-warn' : '')}
        ${kpi('Партнёры', n(T.partners), `активных ${n(T.activePartners)} · новых за период ${n(T.newPartners)}`)}
        ${kpi('Доход сети', money(T.revenueKzt - T.earnedKzt), 'оборот − начисления')}
      </dl>
      <div class="adm-grid2">
        <section class="adm-card"><h2>По дням</h2>${chart(d.daily)}</section>
        <section class="adm-card"><h2>Топ партнёров</h2>${top.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Партнёр</th><th class="r">Переходы</th><th class="r">Оплаты</th><th class="r">Начислено</th></tr></thead><tbody>
          ${top.map((p) => `<tr data-code="${esc(p.code)}"><td>${esc(p.name)}<span class="adm-sub">${esc(p.code)}</span></td><td class="r">${n(p.period.visits)}</td><td class="r">${n(p.period.paidOrders)}</td><td class="r">${money(p.period.earnedKzt)}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="adm-empty">Партнёров нет.</p>'}</section>
      </div>
      <section class="adm-card"><h2>Статистика по дням</h2>${dailyTable(d.daily)}</section>`;
  }

  function dailyTable(daily) {
    const rows = daily.filter((r) => r.visits || r.users || r.paidOrders);
    if (!rows.length) return '<p class="adm-empty">Нет данных за период.</p>';
    const S = (k) => rows.reduce((a, r) => a + r[k], 0);
    return `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Дата</th><th class="r">Переходы</th><th class="r">Клиенты</th><th class="r">Оплаты</th><th class="r">CR</th><th class="r">Оборот</th><th class="r">Начислено</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(day(r.day))}</td><td class="r">${n(r.visits)}</td><td class="r">${n(r.users)}</td><td class="r">${n(r.paidOrders)}</td><td class="r">${pct(r.paidOrders, r.users)}</td><td class="r">${money(r.revenueKzt)}</td><td class="r">${money(r.earnedKzt)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>Итого</td><td class="r">${n(S('visits'))}</td><td class="r">${n(S('users'))}</td><td class="r">${n(S('paidOrders'))}</td><td class="r">${pct(S('paidOrders'), S('users'))}</td><td class="r">${money(S('revenueKzt'))}</td><td class="r">${money(S('earnedKzt'))}</td></tr></tfoot></table></div>`;
  }

  const PCOLS = [
    ['name', 'Партнёр', (p) => p.name], ['percent', '%', (p) => p.percent], ['visits', 'Переходы', (p) => p.period.visits],
    ['users', 'Клиенты', (p) => p.period.users], ['paidOrders', 'Оплаты', (p) => p.period.paidOrders], ['cr', 'CR', (p) => (p.period.users ? p.period.paidOrders / p.period.users : 0)],
    ['revenueKzt', 'Оборот', (p) => p.period.revenueKzt], ['earnedKzt', 'Начислено', (p) => p.period.earnedKzt],
    ['life', 'Всего начислено', (p) => p.lifetime.earnedKzt], ['paid', 'Выплачено', (p) => p.lifetime.paidOutKzt],
    ['proc', 'В заявках', (p) => p.processingKzt], ['avail', 'Доступно', (p) => p.availableKzt],
  ];

  function partners(d) {
    const q = state.q.trim().toLowerCase();
    const [key, dir] = state.sort;
    const col = PCOLS.find((c) => c[0] === key) || PCOLS[7];
    const rows = d.partners
      .filter((p) => !q || [p.name, p.code, p.telegram, p.teliks && p.teliks.email].some((x) => String(x || '').toLowerCase().includes(q)))
      .sort((a, b) => { const x = col[2](a), y = col[2](b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir; });
    const S = (f) => rows.reduce((a, p) => a + f(p), 0);
    return `<section class="adm-card">
      <div class="adm-card-head"><h2>Партнёры (${rows.length})</h2><input class="input adm-search" id="q" type="search" placeholder="Поиск: имя, код, email, Telegram" value="${esc(state.q)}"></div>
      ${rows.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr>${PCOLS.map(([k, t]) => `<th data-sort="${k}" class="${k === 'name' ? '' : 'r'}"${k === key ? ` aria-sort="${dir < 0 ? 'descending' : 'ascending'}"` : ''}>${t}</th>`).join('')}<th>Реквизиты</th><th>Статус</th></tr></thead><tbody>
      ${rows.map((p) => `<tr data-code="${esc(p.code)}">
        <td>${esc(p.name)}<span class="adm-sub">${esc(p.code)}${p.teliks && p.teliks.email ? ' · ' + esc(p.teliks.email) : ''}${p.telegram ? ' · @' + esc(p.telegram) : ''}</span></td>
        <td class="r">${esc(p.percent)}%</td><td class="r">${n(p.period.visits)}</td><td class="r">${n(p.period.users)}</td><td class="r">${n(p.period.paidOrders)}</td>
        <td class="r">${pct(p.period.paidOrders, p.period.users)}</td><td class="r">${money(p.period.revenueKzt)}</td><td class="r">${money(p.period.earnedKzt)}</td>
        <td class="r">${money(p.lifetime.earnedKzt)}</td><td class="r">${money(p.lifetime.paidOutKzt)}</td><td class="r">${money(p.processingKzt)}</td><td class="r"><b>${money(p.availableKzt)}</b></td>
        <td>${esc(p.teliks && p.teliks.payout ? p.teliks.payout : '—')}</td>
        <td>${!p.active ? pill(['Отключён в TrendMe', 'bad']) : p.teliks ? (p.teliks.active ? pill(['Активен', 'ok']) : pill(['Вход заблокирован', 'bad'])) : pill(['Без кабинета', 'mute'])}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>Итого</td><td></td><td class="r">${n(S((p) => p.period.visits))}</td><td class="r">${n(S((p) => p.period.users))}</td><td class="r">${n(S((p) => p.period.paidOrders))}</td><td></td>
        <td class="r">${money(S((p) => p.period.revenueKzt))}</td><td class="r">${money(S((p) => p.period.earnedKzt))}</td><td class="r">${money(S((p) => p.lifetime.earnedKzt))}</td>
        <td class="r">${money(S((p) => p.lifetime.paidOutKzt))}</td><td class="r">${money(S((p) => p.processingKzt))}</td><td class="r">${money(S((p) => p.availableKzt))}</td><td></td><td></td></tr></tfoot></table></div>` : '<p class="adm-empty">Ничего не найдено.</p>'}
    </section>`;
  }

  function requestRows(list, withActions = true) {
    if (!list.length) return '<p class="adm-empty">Заявок нет.</p>';
    return `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Создана</th><th>Партнёр</th><th class="r">Сумма</th><th>Способ</th><th>Реквизиты</th><th>Статус</th><th>Обработана</th>${withActions ? '<th></th>' : ''}</tr></thead><tbody>
      ${list.map((r) => `<tr><td>${esc(dt(r.createdAt))}</td><td>${esc(r.name)}<span class="adm-sub">${esc(r.code)}${r.email ? ' · ' + esc(r.email) : ''}</span></td><td class="r"><b>${money(r.amount)}</b></td>
        <td>${esc(r.method)}</td><td>${esc(r.details)}</td><td>${pill(STATUS[r.status] || [r.status, 'mute'])}</td><td>${esc(dt(r.processedAt))}</td>
        ${withActions ? `<td>${r.status === 'processing' ? `<div class="adm-actions"><button class="btn btn-primary" type="button" data-pay="${esc(r.id)}">Выплачено</button><button class="btn btn-danger-soft" type="button" data-reject="${esc(r.id)}">Отклонить</button></div>` : ''}</td>` : ''}</tr>`).join('')}
      </tbody></table></div>`;
  }

  function payouts(d) {
    const all = d.requests;
    const S = (st) => all.filter((r) => r.status === st);
    const sum = (a) => a.reduce((x, r) => x + r.amount, 0);
    const list = state.payStatus ? S(state.payStatus) : all;
    return `
      <dl class="adm-kpis">
        ${kpi('В обработке', money(sum(S('processing'))), `${S('processing').length} заявок`, S('processing').length ? 'is-warn' : '')}
        ${kpi('Выплачено за период', money(d.totals.paidOutKzt))}
        ${kpi('Выплачено всего', money(sum(S('paid'))), `${S('paid').length} заявок`)}
        ${kpi('Отклонено', money(sum(S('rejected'))), `${S('rejected').length} заявок`)}
        ${kpi('К выплате (всем)', money(d.totals.balanceKzt), 'начислено − выплачено', 'is-gold')}
        ${kpi('Партнёров с балансом', n(d.partners.filter((p) => p.availableKzt > 0).length))}
      </dl>
      <section class="adm-card">
        <div class="adm-card-head"><h2>Заявки на выплату</h2>
          <div class="adm-period">${[['processing', 'В обработке'], ['paid', 'Выплачено'], ['rejected', 'Отклонено'], ['', 'Все']].map(([k, t]) => `<button class="chip" type="button" data-pay-status="${k}" aria-pressed="${state.payStatus === k}">${t}</button>`).join('')}
          <a class="btn" href="/api/admin/requests.csv${state.payStatus ? '?status=' + state.payStatus : ''}">CSV</a></div></div>
        ${requestRows(list)}
      </section>
      <section class="adm-card"><h2>Балансы партнёров</h2>${(() => {
        const rows = d.partners.filter((p) => p.lifetime.earnedKzt > 0).sort((a, b) => b.availableKzt - a.availableKzt);
        return rows.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Партнёр</th><th class="r">Начислено</th><th class="r">Выплачено</th><th class="r">В заявках</th><th class="r">Доступно</th><th>Реквизиты</th></tr></thead><tbody>
          ${rows.map((p) => `<tr data-code="${esc(p.code)}"><td>${esc(p.name)}<span class="adm-sub">${esc(p.code)}</span></td><td class="r">${money(p.lifetime.earnedKzt)}</td><td class="r">${money(p.lifetime.paidOutKzt)}</td><td class="r">${money(p.processingKzt)}</td><td class="r"><b>${money(p.availableKzt)}</b></td><td>${esc(p.teliks && p.teliks.payout ? p.teliks.payout : '—')}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="adm-empty">Начислений пока нет.</p>';
      })()}</section>`;
  }

  function conversions(d) {
    const list = d.commissions.filter((c) => (!state.convStatus || c.status === state.convStatus) && (!state.convCode || c.code === state.convCode));
    const ok = list.filter((c) => c.status === 'earned');
    return `<section class="adm-card">
      <div class="adm-card-head"><h2>Конверсии (${list.length})</h2>
        <div class="adm-period">
          ${[['', 'Все'], ['earned', 'Начислено'], ['reversed', 'Отменено']].map(([k, t]) => `<button class="chip" type="button" data-conv-status="${k}" aria-pressed="${state.convStatus === k}">${t}</button>`).join('')}
          <select class="input adm-search" id="conv-code"><option value="">Все партнёры</option>${d.partners.map((p) => `<option value="${esc(p.code)}"${state.convCode === p.code ? ' selected' : ''}>${esc(p.name)} (${esc(p.code)})</option>`).join('')}</select>
        </div></div>
      <p class="adm-muted">Сумма оплат: <b>${money(ok.reduce((a, c) => a + c.amountKzt, 0))}</b> · начислено партнёрам: <b>${money(ok.reduce((a, c) => a + c.commissionKzt, 0))}</b></p>
      ${list.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Время</th><th>Партнёр</th><th>Заказ</th><th class="r">Сумма оплаты</th><th class="r">%</th><th class="r">Начисление</th><th>Статус</th></tr></thead><tbody>
        ${list.slice(0, 500).map((c) => `<tr data-code="${esc(c.code)}"><td>${esc(dt(c.time))}</td><td>${esc(c.name)}<span class="adm-sub">${esc(c.code)}</span></td><td>${esc(c.order)}</td><td class="r">${money(c.amountKzt)}</td><td class="r">${esc(c.percent)}%</td><td class="r"><b>${money(c.commissionKzt)}</b></td><td>${pill(CONV[c.status] || [c.status, 'mute'])}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="adm-empty">Конверсий за период нет.</p>'}
    </section>`;
  }

  /* ───── partner drawer ───── */
  async function openPartner(code) {
    const dr = $('#drawer');
    $('#drawer-body').innerHTML = '<p class="adm-muted">Загрузка…</p>';
    dr.hidden = false;
    document.body.classList.add('locked');
    try {
      const d = await api(`/api/admin/partner/${encodeURIComponent(code)}?from=${state.from}&to=${state.to}`);
      const s = d.summary, P = s.period || {}, L = s.lifetime || {}, t = d.teliks;
      const proc = d.requests.filter((r) => r.status === 'processing').reduce((a, r) => a + r.amount, 0);
      const links = Object.entries(s.links || {}).filter(([, v]) => v);
      $('#drawer-body').innerHTML = `
        <h2 id="dr-title">${esc(s.partner.name)} <span class="adm-muted">${esc(s.partner.code)} · ${esc(s.partner.percent)}%</span></h2>
        <dl class="adm-kv">
          <dt>Email</dt><dd>${esc(t && t.email ? t.email : '—')}</dd>
          <dt>Кабинет</dt><dd>${t ? (t.active ? pill(['Вход открыт', 'ok']) : pill(['Вход заблокирован', 'bad'])) : pill(['Нет кабинета Teliks', 'mute'])}${s.partner.active ? '' : ' ' + pill(['Отключён в TrendMe', 'bad'])}</dd>
          <dt>Реквизиты</dt><dd>${esc(t && t.payout ? t.payout : '—')}</dd>
          <dt>Зарегистрирован</dt><dd>${esc(t ? dt(t.registeredAt) : '—')}</dd>
        </dl>
        <div class="adm-links">${links.map(([k, v]) => `<div class="adm-link"><span class="adm-muted">${{ bot: 'Бот', app: 'Mini App', site: 'Сайт' }[k] || k}</span><code>${esc(v)}</code><button class="btn" type="button" data-copy="${esc(v)}">Копировать</button></div>`).join('')}</div>
        <dl class="adm-kpis">
          ${kpi('Переходы', n(P.visits))}${kpi('Клиенты', n(P.users))}${kpi('Оплаты', n(P.paidOrders), `CR ${pct(P.paidOrders, P.users)}`)}
          ${kpi('Оборот', money(P.revenueKzt))}${kpi('Начислено (период)', money(P.earnedKzt), '', 'is-gold')}${kpi('Всего начислено', money(L.earnedKzt))}
          ${kpi('Выплачено', money(L.paidOutKzt))}${kpi('В заявках', money(proc))}${kpi('Доступно', money(Math.max(0, (L.earnedKzt || 0) - (L.paidOutKzt || 0) - proc)), '', 'is-gold')}
        </dl>
        <section class="adm-card"><h2>По дням</h2>${dailyTable(s.daily || [])}</section>
        <section class="adm-card"><h2>Конверсии</h2>${(s.commissions || []).length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Время</th><th>Заказ</th><th class="r">Сумма</th><th class="r">Начисление</th><th>Статус</th></tr></thead><tbody>
          ${s.commissions.map((c) => `<tr><td>${esc(dt(c.time))}</td><td>${esc(c.order)}</td><td class="r">${money(c.amountKzt)}</td><td class="r">${money(c.commissionKzt)}</td><td>${pill(CONV[c.status] || [c.status, 'mute'])}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="adm-empty">Конверсий за период нет.</p>'}</section>
        <section class="adm-card"><h2>Заявки на выплату</h2>${requestRows(d.requests)}</section>
        ${t && !t.admin ? `<div><button class="btn ${t.active ? 'btn-danger-soft' : 'btn-primary'}" type="button" data-toggle="${esc(t.uid)}" data-active="${t.active ? '0' : '1'}">${t.active ? 'Заблокировать вход в кабинет' : 'Разблокировать вход'}</button></div>` : ''}`;
    } catch (e) {
      $('#drawer-body').innerHTML = `<p class="error">${esc(e.message)}</p>`;
    }
  }
  function closeDrawer() { $('#drawer').hidden = true; document.body.classList.remove('locked'); }

  /* ───── shell ───── */
  function render() {
    const d = state.data;
    if (!d) return;
    $('#cnt-proc').textContent = d.totals.processingCount || '';
    $('#view').innerHTML = { overview, partners, payouts, conversions }[state.tab](d);
    $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
    const q = $('#q');
    if (q) q.oninput = () => { state.q = q.value; const pos = q.selectionStart; render(); const q2 = $('#q'); q2.focus(); q2.setSelectionRange(pos, pos); };
    const cc = $('#conv-code');
    if (cc) cc.onchange = () => { state.convCode = cc.value; render(); };
  }

  async function load() {
    $('#err').textContent = '';
    $('#from').value = state.from; $('#to').value = state.to;
    try {
      state.data = await api(`/api/admin/dashboard?from=${state.from}&to=${state.to}`);
      $('#updated').textContent = 'Обновлено ' + new Date().toLocaleTimeString('ru-RU', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' });
      render();
    } catch (e) {
      $('#err').textContent = e.message;
      if (!state.data) $('#view').innerHTML = '';
    }
  }

  function setDays(days) {
    state.to = ymd(Date.now());
    state.from = ymd(Date.now() - (days - 1) * 86400000);
    $$('[data-days]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days)));
    load();
  }

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('button, tr[data-code], [data-close]');
    if (!el) return;
    if (el.matches('[data-close]')) return closeDrawer();
    if (el.matches('tr[data-code]')) return openPartner(el.dataset.code);
    const b = el;
    $('#err').textContent = '';
    if (b.dataset.tab) { state.tab = b.dataset.tab; return render(); }
    if (b.dataset.days) return setDays(Number(b.dataset.days));
    if (b.dataset.sort) { const k = b.dataset.sort; state.sort = [k, state.sort[0] === k ? -state.sort[1] : k === 'name' ? 1 : -1]; return render(); }
    if ('payStatus' in b.dataset) { state.payStatus = b.dataset.payStatus; return render(); }
    if ('convStatus' in b.dataset) { state.convStatus = b.dataset.convStatus; return render(); }
    if (b.dataset.copy) { try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = '✓'; } catch { /* ignore */ } return; }
    try {
      if (b.dataset.pay || b.dataset.reject) {
        const id = b.dataset.pay || b.dataset.reject;
        const r = state.data.requests.find((x) => x.id === id);
        if (!window.confirm(b.dataset.pay ? `Подтвердить выплату ${money(r.amount)} партнёру ${r.name} (${r.method} ${r.details})?` : `Отклонить заявку ${r.name} на ${money(r.amount)}?`)) return;
        b.disabled = true;
        await api('/api/admin/requests/' + id, { method: 'POST', body: { action: b.dataset.pay ? 'paid' : 'rejected' } });
        await load();
        if (!$('#drawer').hidden) closeDrawer();
      } else if (b.dataset.toggle) {
        b.disabled = true;
        await api('/api/admin/partners/' + b.dataset.toggle, { method: 'POST', body: { active: b.dataset.active === '1' } });
        closeDrawer();
        await load();
      }
    } catch (err) {
      $('#err').textContent = err.message;
      b.disabled = false;
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer(); });
  const onDate = () => {
    const f = $('#from').value, t = $('#to').value;
    if (!f || !t || f > t) return;
    if ((Date.parse(t) - Date.parse(f)) / 86400000 > 92) { $('#err').textContent = 'Период — не больше 92 дней.'; return; }
    state.from = f; state.to = t;
    $$('[data-days]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    load();
  };
  $('#from').onchange = onDate; $('#to').onchange = onDate;

  load();
})();
