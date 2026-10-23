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

  const state = {
    tab: 'overview', from: ymd(Date.now() - 29 * 86400000), to: ymd(Date.now()), data: null, cpa: null, offers: null, advs: null,
    q: '', sort: ['earnedKzt', -1], payStatus: 'processing', convStatus: '', convCode: '',
    convSrc: 'cpa', cc: { status: '', offer: '', code: '', page: 1 }, ccData: null, pbLog: null, newKey: null,
  };
  const CSTAT = { approved: ['Подтверждена', 'ok'], pending: ['В ожидании', 'warn'], rejected: ['Отклонена', 'bad'] };
  const OSTAT = { active: ['Активен', 'ok'], paused: ['Пауза', 'warn'], archived: ['Архив', 'mute'] };
  const OACC = { open: 'Открытый', approval: 'По заявке', private: 'Приватный' };
  const goalMoney = (type, v) => (type === 'percent' ? `${esc(v)}%` : money(v));
  const uidOf = (p) => (p.teliks ? p.teliks.uid : '');
  const natOf = (p) => (state.cpa && state.cpa.users[uidOf(p)]) || { clicks: 0, approved: 0, pending: 0, rejected: 0, payout: 0, pendingPayout: 0, revenue: 0 };

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

  function cpaBlock() {
    const C = state.cpa;
    if (!C) return '';
    const T = C.totals;
    const conv = T.approved + T.pending + T.rejected;
    const offers = (state.offers ? state.offers.rows : []).filter((o) => o.stats).sort((a, b) => (b.stats.revenue + b.stats.pendingRevenue) - (a.stats.revenue + a.stats.pendingRevenue)).slice(0, 8);
    return `<h2 class="adm-h">CPA-офферы сети <span class="adm-muted">активных ${n(C.activeOffers)} из ${n(C.offers)}</span></h2>
      <dl class="adm-kpis">
        ${kpi('Клики', n(T.clicks), `уникальных ${n(T.uniq)}`)}
        ${kpi('Конверсии', n(conv), `CR ${pct(conv, T.clicks)} · ✓ ${n(T.approved)} · ⏳ ${n(T.pending)} · ✕ ${n(T.rejected)}`)}
        ${kpi('Доход от рекламодателей', money(T.revenue), `ожидает ${money(T.pendingRevenue)}`)}
        ${kpi('Выплаты партнёрам', money(T.payout), `ожидает ${money(T.pendingPayout)}`, 'is-gold')}
        ${kpi('Прибыль сети', money(T.revenue - T.payout), `с ожидающими ${money(T.revenue + T.pendingRevenue - T.payout - T.pendingPayout)}`)}
        ${kpi('EPC партнёра', T.clicks ? money((T.payout + T.pendingPayout) / T.clicks) : '—', `оборот клиентов ${money(T.sales)}`)}
      </dl>
      ${offers.length ? `<section class="adm-card"><h2>Офферы за период</h2>${offerStatsTable(offers)}</section>` : ''}`;
  }

  function offerStatsTable(list) {
    return `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Оффер</th><th class="r">Клики</th><th class="r">Конв.</th><th class="r">CR</th><th class="r">Доход</th><th class="r">Выплаты</th><th class="r">Прибыль</th><th class="r">Ожидает</th></tr></thead><tbody>
      ${list.map((o) => { const s = o.stats || {}; const cv = (s.approved || 0) + (s.pending || 0) + (s.rejected || 0); return `<tr data-offer="${esc(o.id)}"><td>${esc(o.name)}<span class="adm-sub">${esc(o.id)} · ${esc(o.advertiser)}</span></td><td class="r">${n(s.clicks)}</td><td class="r">${n(cv)}</td><td class="r">${pct(cv, s.clicks)}</td><td class="r">${money(s.revenue)}</td><td class="r">${money(s.payout)}</td><td class="r"><b>${money((s.revenue || 0) - (s.payout || 0))}</b></td><td class="r">${money(s.pendingRevenue)}</td></tr>`; }).join('')}
    </tbody></table></div>`;
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
        ${kpi('К выплате (всем)', money(T.balanceKzt), 'TrendMe + CPA, подтверждённое')}
        ${kpi('Заявки в обработке', money(T.processingKzt), `${n(T.processingCount)} шт.`, T.processingCount ? 'is-warn' : '')}
        ${kpi('Партнёры', n(T.partners), `активных ${n(T.activePartners)} · новых за период ${n(T.newPartners)}`)}
        ${kpi('Доход сети', money(T.revenueKzt - T.earnedKzt), 'оборот − начисления')}
      </dl>
      ${cpaBlock()}
      <h2 class="adm-h">TrendMe (бот)</h2>
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
    ['cpaClicks', 'CPA клики', (p) => natOf(p).clicks], ['cpaConv', 'CPA конв.', (p) => natOf(p).approved + natOf(p).pending],
    ['cpaPay', 'CPA начислено', (p) => natOf(p).payout + natOf(p).pendingPayout],
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
        <td class="r">${money(p.lifetime.earnedKzt + p.native.approvedKzt)}</td><td class="r">${money(p.lifetime.paidOutKzt + p.native.paidKzt)}</td>
        <td class="r">${n(natOf(p).clicks)}</td><td class="r">${n(natOf(p).approved + natOf(p).pending)}</td><td class="r">${money(natOf(p).payout + natOf(p).pendingPayout)}</td>
        <td class="r">${money(p.processingKzt)}</td><td class="r"><b>${money(p.availableKzt)}</b></td>
        <td>${esc(p.teliks && p.teliks.payout ? p.teliks.payout : '—')}</td>
        <td>${!p.active ? pill(['Отключён в TrendMe', 'bad']) : p.teliks ? (p.teliks.active ? pill(['Активен', 'ok']) : pill(['Вход заблокирован', 'bad'])) : pill(['Без кабинета', 'mute'])}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>Итого</td><td></td><td class="r">${n(S((p) => p.period.visits))}</td><td class="r">${n(S((p) => p.period.users))}</td><td class="r">${n(S((p) => p.period.paidOrders))}</td><td></td>
        <td class="r">${money(S((p) => p.period.revenueKzt))}</td><td class="r">${money(S((p) => p.period.earnedKzt))}</td><td class="r">${money(S((p) => p.lifetime.earnedKzt + p.native.approvedKzt))}</td>
        <td class="r">${money(S((p) => p.lifetime.paidOutKzt + p.native.paidKzt))}</td><td class="r">${n(S((p) => natOf(p).clicks))}</td><td class="r">${n(S((p) => natOf(p).approved + natOf(p).pending))}</td><td class="r">${money(S((p) => natOf(p).payout + natOf(p).pendingPayout))}</td><td class="r">${money(S((p) => p.processingKzt))}</td><td class="r">${money(S((p) => p.availableKzt))}</td><td></td><td></td></tr></tfoot></table></div>` : '<p class="adm-empty">Ничего не найдено.</p>'}
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
        ${kpi('К выплате (всем)', money(d.totals.balanceKzt), 'TrendMe + CPA, подтверждённое', 'is-gold')}
        ${kpi('В холде (CPA)', money(d.partners.reduce((a, p) => a + p.native.pendingKzt, 0)), 'станет доступно после холда')}
        ${kpi('Партнёров с балансом', n(d.partners.filter((p) => p.availableKzt > 0).length))}
      </dl>
      <section class="adm-card">
        <div class="adm-card-head"><h2>Заявки на выплату</h2>
          <div class="adm-period">${[['processing', 'В обработке'], ['paid', 'Выплачено'], ['rejected', 'Отклонено'], ['', 'Все']].map(([k, t]) => `<button class="chip" type="button" data-pay-status="${k}" aria-pressed="${state.payStatus === k}">${t}</button>`).join('')}
          <a class="btn" href="/api/admin/requests.csv${state.payStatus ? '?status=' + state.payStatus : ''}">CSV</a></div></div>
        ${requestRows(list)}
      </section>
      <section class="adm-card"><h2>Балансы партнёров</h2>${(() => {
        const rows = d.partners.filter((p) => p.lifetime.earnedKzt > 0 || p.native.approvedKzt > 0 || p.native.pendingKzt > 0).sort((a, b) => b.availableKzt - a.availableKzt);
        return rows.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Партнёр</th><th class="r">TrendMe начислено</th><th class="r">CPA подтверждено</th><th class="r">CPA в холде</th><th class="r">Выплачено</th><th class="r">В заявках</th><th class="r">Доступно</th><th>Реквизиты</th></tr></thead><tbody>
          ${rows.map((p) => `<tr data-code="${esc(p.code)}"><td>${esc(p.name)}<span class="adm-sub">${esc(p.code)}</span></td><td class="r">${money(p.lifetime.earnedKzt)}</td><td class="r">${money(p.native.approvedKzt)}</td><td class="r">${money(p.native.pendingKzt)}</td><td class="r">${money(p.lifetime.paidOutKzt + p.native.paidKzt)}</td><td class="r">${money(p.processingKzt)}</td><td class="r"><b>${money(p.availableKzt)}</b></td><td>${esc(p.teliks && p.teliks.payout ? p.teliks.payout : '—')}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="adm-empty">Начислений пока нет.</p>';
      })()}</section>`;
  }

  function conversions(d) {
    const sw = `<div class="adm-period adm-switch">${[['cpa', 'CPA-офферы'], ['trendme', 'TrendMe']].map(([k, t]) => `<button class="chip" type="button" data-conv-src="${k}" aria-pressed="${state.convSrc === k}">${t}</button>`).join('')}</div>`;
    return sw + (state.convSrc === 'cpa' ? cpaConversions(d) : tmConversions(d));
  }

  function cpaConversions(d) {
    const c = state.cc, D = state.ccData;
    const offers = state.offers ? state.offers.rows : [];
    const qs = new URLSearchParams({ from: state.from, to: state.to, ...(c.status && { status: c.status }), ...(c.offer && { offer: c.offer }), ...(c.code && { code: c.code }) });
    const pages = D ? Math.max(1, Math.ceil(D.total / D.perPage)) : 1;
    return `<section class="adm-card">
      <div class="adm-card-head"><h2>Конверсии CPA ${D ? `(${n(D.total)})` : ''}</h2>
        <div class="adm-period">
          ${[['', 'Все'], ['pending', 'В ожидании'], ['approved', 'Подтверждены'], ['rejected', 'Отклонены']].map(([k, t]) => `<button class="chip" type="button" data-cc-status="${k}" aria-pressed="${c.status === k}">${t}</button>`).join('')}
          <select class="input adm-search" id="cc-offer"><option value="">Все офферы</option>${offers.map((o) => `<option value="${esc(o.id)}"${c.offer === o.id ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
          <select class="input adm-search" id="cc-code"><option value="">Все партнёры</option>${d.partners.filter((p) => p.teliks).map((p) => `<option value="${esc(p.code)}"${c.code === p.code ? ' selected' : ''}>${esc(p.name)} (${esc(p.code)})</option>`).join('')}</select>
          <a class="btn" href="/api/admin/cpa/conversions.csv?${qs}">CSV</a>
        </div></div>
      ${!D ? '<p class="adm-muted">Загрузка…</p>' : D.rows.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Время</th><th>Оффер</th><th>Партнёр</th><th>Цель</th><th>txid / click_id</th><th class="r">Сумма</th><th class="r">Доход</th><th class="r">Выплата</th><th>Статус</th><th>Рекл.</th><th>sub1 · источник</th><th></th></tr></thead><tbody>
        ${D.rows.map((x) => `<tr><td>${esc(dt(x.time))}</td><td>${esc(x.offer)}<span class="adm-sub">${esc(x.advertiser)}</span></td><td>${esc(x.partner)}<span class="adm-sub">${esc(x.code)}</span></td><td>${esc(x.goal)}</td>
          <td><code class="adm-code">${esc(x.txid || '—')}</code><span class="adm-sub">${esc(x.click_id || '')}</span></td><td class="r">${x.sale == null ? '—' : money(x.sale)}</td><td class="r">${money(x.revenue)}</td><td class="r"><b>${money(x.payout)}</b></td>
          <td>${pill(CSTAT[x.status] || [x.status, 'mute'])}${x.hold_until && x.status === 'pending' ? `<span class="adm-sub">холд до ${esc(dt(x.hold_until))}</span>` : ''}${x.note ? `<span class="adm-sub">${esc(x.note)}</span>` : ''}</td>
          <td>${esc((CSTAT[x.adv_status] || ['—'])[0])}</td><td>${esc(x.sub1 || '—')}<span class="adm-sub">${esc(x.source || '')}${x.country ? ' · ' + esc(x.country) : ''}</span></td>
          <td><div class="adm-actions">${x.status !== 'approved' ? `<button class="btn btn-primary" type="button" data-cset="${esc(x.id)}" data-st="approved">Подтвердить</button>` : ''}${x.status !== 'rejected' ? `<button class="btn btn-danger-soft" type="button" data-cset="${esc(x.id)}" data-st="rejected">Отклонить</button>` : ''}</div></td></tr>`).join('')}
      </tbody></table></div>
      ${pages > 1 ? `<div class="adm-pager"><button class="btn" type="button" data-cc-page="${c.page - 1}"${c.page <= 1 ? ' disabled' : ''}>←</button><span>${c.page} / ${pages}</span><button class="btn" type="button" data-cc-page="${c.page + 1}"${c.page >= pages ? ' disabled' : ''}>→</button></div>` : ''}` : '<p class="adm-empty">Конверсий нет.</p>'}
    </section>`;
  }

  async function loadCC() {
    const c = state.cc;
    const qs = new URLSearchParams({ from: state.from, to: state.to, page: String(c.page), ...(c.status && { status: c.status }), ...(c.offer && { offer: c.offer }), ...(c.code && { code: c.code }) });
    state.ccData = null;
    if (state.tab === 'conversions') render();
    try { state.ccData = await api('/api/admin/cpa/conversions?' + qs); } catch (e) { $('#err').textContent = e.message; state.ccData = { total: 0, perPage: 100, rows: [] }; }
    if (state.tab === 'conversions') render();
  }

  function tmConversions(d) {
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

  /* ───── offers ───── */
  function offersView() {
    const O = state.offers;
    if (!O) return '<p class="adm-muted">Загрузка…</p>';
    const reqs = O.rows.flatMap((o) => o.access_rows.filter((a) => a.status === 'pending').map((a) => ({ ...a, offerName: o.name })));
    return `
      ${reqs.length ? `<section class="adm-card adm-attn"><h2>Заявки на доступ (${reqs.length})</h2><div class="table-scroll"><table class="adm-table"><thead><tr><th>Дата</th><th>Партнёр</th><th>Оффер</th><th></th></tr></thead><tbody>
        ${reqs.map((a) => `<tr><td>${esc(dt(a.created_at))}</td><td>${esc(a.name)}<span class="adm-sub">${esc(a.code)}${a.email ? ' · ' + esc(a.email) : ''}</span></td><td>${esc(a.offerName)}<span class="adm-sub">${esc(a.offer_id)}</span></td>
          <td><div class="adm-actions"><button class="btn btn-primary" type="button" data-acc="${esc(a.offer_id)}" data-uid="${esc(a.user_id)}" data-st="approved">Одобрить</button><button class="btn btn-danger-soft" type="button" data-acc="${esc(a.offer_id)}" data-uid="${esc(a.user_id)}" data-st="rejected">Отклонить</button></div></td></tr>`).join('')}
      </tbody></table></div></section>` : ''}
      <section class="adm-card">
        <div class="adm-card-head"><h2>Офферы (${O.rows.length})</h2><div class="adm-actions"><a class="btn" href="/docs.html" target="_blank" rel="noopener">Документация API</a><button class="btn btn-primary" type="button" data-offer-new>+ Новый оффер</button></div></div>
        ${!O.advertisers.length ? '<p class="adm-empty">Сначала добавьте рекламодателя во вкладке «Рекламодатели».</p>' : ''}
        ${O.rows.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Оффер</th><th>Рекламодатель</th><th>Модель</th><th>Цели: партнёру / сети</th><th>Доступ</th><th>Холд · кап</th><th class="r">Клики</th><th class="r">Конв.</th><th class="r">Доход</th><th class="r">Выплаты</th><th class="r">Прибыль</th><th>Статус</th></tr></thead><tbody>
          ${O.rows.map((o) => { const s = o.stats || {}; return `<tr data-offer="${esc(o.id)}"><td>${esc(o.name)}<span class="adm-sub">${esc(o.id)}${o.geo.length ? ' · ' + esc(o.geo.join(', ')) : ''}</span></td><td>${esc(o.advertiser)}</td><td>${esc(o.model)}</td>
            <td>${o.goals.map((g) => `<span class="adm-goal">${esc(g.name)}: <b>${goalMoney(g.payout_type, g.payout)}</b> / ${goalMoney(g.revenue_type, g.revenue)}</span>`).join('')}</td>
            <td>${esc(OACC[o.access])}<span class="adm-sub">${n(o.access_rows.filter((a) => a.status === 'approved').length)} партн.</span></td><td>${n(o.hold_days)} дн.${o.daily_cap ? ' · ' + n(o.daily_cap) + '/день' : ''}</td>
            <td class="r">${n(s.clicks)}</td><td class="r">${n((s.approved || 0) + (s.pending || 0))}</td><td class="r">${money(s.revenue)}</td><td class="r">${money(s.payout)}</td><td class="r"><b>${money((s.revenue || 0) - (s.payout || 0))}</b></td><td>${pill(OSTAT[o.status])}</td></tr>`; }).join('')}
        </tbody></table></div>` : '<p class="adm-empty">Офферов пока нет. Нажмите «Новый оффер».</p>'}
      </section>`;
  }

  const MACROS = '{click_id} — обязателен; {aff_id}, {offer_id}, {sub1}…{sub5}, {source}, {sub_aff_id}';
  function goalRow(g = {}) {
    return `<div class="adm-goalrow" data-goal>
      <input class="input" data-g="code" placeholder="код: lead" value="${esc(g.code || '')}" maxlength="32" aria-label="Код цели">
      <input class="input" data-g="name" placeholder="Название: Заявка" value="${esc(g.name || '')}" maxlength="60" aria-label="Название цели">
      <label class="adm-mini">Партнёру<span><input class="input" data-g="payout" type="number" min="0" step="0.01" value="${esc(g.payout ?? '')}"><select class="input" data-g="payout_type"><option value="fixed"${g.payout_type !== 'percent' ? ' selected' : ''}>₸</option><option value="percent"${g.payout_type === 'percent' ? ' selected' : ''}>%</option></select></span></label>
      <label class="adm-mini">От рекламодателя<span><input class="input" data-g="revenue" type="number" min="0" step="0.01" value="${esc(g.revenue ?? '')}"><select class="input" data-g="revenue_type"><option value="fixed"${g.revenue_type !== 'percent' ? ' selected' : ''}>₸</option><option value="percent"${g.revenue_type === 'percent' ? ' selected' : ''}>%</option></select></span></label>
      <button class="btn btn-icon" type="button" data-goal-del aria-label="Удалить цель">✕</button>
    </div>`;
  }

  function openOfferForm(id) {
    const O = state.offers;
    const o = id ? O.rows.find((x) => x.id === id) : null;
    const f = o || { status: 'active', access: 'approval', model: 'CPA', goals: [{ code: 'lead', name: 'Заявка', payout_type: 'fixed', payout: '', revenue_type: 'fixed', revenue: '' }], geo: ['KZ'], categories: [], hold_days: 0 };
    const opt = (list, v) => list.map(([k, t]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(t)}</option>`).join('');
    const partnersWithout = state.data ? state.data.partners.filter((p) => p.teliks && !(o && o.access_rows.some((a) => a.user_id === p.teliks.uid && a.status === 'approved'))) : [];
    openDrawer(`
      <h2 id="dr-title">${o ? 'Оффер: ' + esc(o.name) : 'Новый оффер'}</h2>
      <form class="adm-form" id="offer-form" novalidate>
        <div class="adm-fgrid">
          <label class="field"><span>ID (в ссылке)</span><input class="input input-mono" name="id" required pattern="[a-z0-9][a-z0-9_-]{1,31}" maxlength="32" value="${esc(f.id || '')}" ${o ? 'disabled' : ''} placeholder="kaspi-card"></label>
          <label class="field"><span>Рекламодатель</span><select class="input" name="advertiser_id" required><option value="">—</option>${opt(O.advertisers.map((a) => [a.id, a.name + (a.status === 'paused' ? ' (пауза)' : '')]), f.advertiser_id)}</select></label>
          <label class="field adm-span2"><span>Название</span><input class="input" name="name" required maxlength="120" value="${esc(f.name || '')}"></label>
          <label class="field"><span>Статус</span><select class="input" name="status">${opt([['active', 'Активен'], ['paused', 'Пауза'], ['archived', 'Архив']], f.status)}</select></label>
          <label class="field"><span>Доступ партнёров</span><select class="input" name="access">${opt([['approval', 'По заявке (одобряет админ)'], ['open', 'Открытый (всем сразу)'], ['private', 'Приватный (только выданным)']], f.access)}</select></label>
          <label class="field"><span>Модель</span><select class="input" name="model">${opt(['CPA', 'CPL', 'CPS', 'CPI', 'RevShare'].map((m) => [m, m]), f.model)}</select></label>
          <label class="field"><span>Холд, дней</span><input class="input" name="hold_days" type="number" min="0" max="90" value="${esc(f.hold_days || 0)}"></label>
          <label class="field"><span>Кап, конверсий в день</span><input class="input" name="daily_cap" type="number" min="1" value="${esc(f.daily_cap || '')}" placeholder="без лимита"></label>
          <label class="field"><span>ГЕО (через запятую)</span><input class="input" name="geo" value="${esc((f.geo || []).join(', '))}" placeholder="KZ, UZ"></label>
          <label class="field adm-span2"><span>Целевая ссылка рекламодателя</span><input class="input input-mono" name="target_url" required value="${esc(f.target_url || '')}" placeholder="https://advertiser.kz/land?click_id={click_id}&aff={aff_id}&sub1={sub1}"><small class="hint">Макросы: ${esc(MACROS)}</small></label>
          <label class="field"><span>Превью (лендинг для партнёров)</span><input class="input" name="preview_url" value="${esc(f.preview_url || '')}" placeholder="https://"></label>
          <label class="field"><span>Логотип (https)</span><input class="input" name="logo_url" value="${esc(f.logo_url || '')}" placeholder="https://…/logo.png"></label>
          <label class="field adm-span2"><span>Категории (через запятую)</span><input class="input" name="categories" value="${esc((f.categories || []).join(', '))}" placeholder="Финансы, Банки"></label>
          <label class="field adm-span2"><span>Описание для партнёров</span><textarea class="input" name="description" rows="4" maxlength="5000">${esc(f.description || '')}</textarea></label>
          <label class="field adm-span2"><span>KPI и правила трафика</span><textarea class="input" name="kpi" rows="3" maxlength="3000">${esc(f.kpi || '')}</textarea></label>
        </div>
        <section class="adm-card"><div class="adm-card-head"><h2>Цели и выплаты</h2><button class="btn" type="button" data-goal-add>+ Цель</button></div>
          <p class="adm-muted">«Партнёру» — сколько получает партнёр, «От рекламодателя» — сколько платит рекламодатель (доход сети). % считается от суммы <code>amount</code> из постбэка.</p>
          <div id="goals">${(f.goals || []).map(goalRow).join('')}</div></section>
        <p class="error" id="form-err" role="alert"></p>
        <div class="adm-actions"><button class="btn btn-primary" type="submit">${o ? 'Сохранить' : 'Создать оффер'}</button></div>
      </form>
      ${o ? `<section class="adm-card"><h2>Интеграция</h2>
        <p class="adm-muted">Ссылка партнёра: <code class="adm-code">${esc(location.origin)}/c/${esc(o.id)}/&lt;код партнёра&gt;?sub1=…</code></p>
        <p class="adm-muted">Постбэк рекламодателя:</p>
        <code class="adm-block">${esc(location.origin)}/postback?key=КЛЮЧ&click_id={click_id}&goal=${esc((o.goals[0] || {}).code || 'lead')}&status=approved&txid={order_id}&amount={sum}</code></section>
      <section class="adm-card"><h2>Партнёры с доступом</h2>
        ${o.access_rows.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Партнёр</th><th>Статус</th><th>Дата</th><th></th></tr></thead><tbody>
          ${o.access_rows.map((a) => `<tr><td>${esc(a.name)}<span class="adm-sub">${esc(a.code)}</span></td><td>${pill({ approved: ['Одобрен', 'ok'], pending: ['Заявка', 'warn'], rejected: ['Отклонён', 'bad'] }[a.status])}</td><td>${esc(dt(a.decided_at || a.created_at))}</td>
            <td><div class="adm-actions">${a.status !== 'approved' ? `<button class="btn btn-primary" type="button" data-acc="${esc(o.id)}" data-uid="${esc(a.user_id)}" data-st="approved">Одобрить</button>` : ''}${a.status !== 'rejected' ? `<button class="btn btn-danger-soft" type="button" data-acc="${esc(o.id)}" data-uid="${esc(a.user_id)}" data-st="rejected">Закрыть доступ</button>` : ''}</div></td></tr>`).join('')}
        </tbody></table></div>` : `<p class="adm-empty">${o.access === 'open' ? 'Оффер открытый — доступ есть у всех.' : 'Пока никого.'}</p>`}
        ${partnersWithout.length ? `<div class="adm-actions"><select class="input adm-search" id="grant-uid">${partnersWithout.map((p) => `<option value="${esc(p.teliks.uid)}">${esc(p.name)} (${esc(p.code)})</option>`).join('')}</select><button class="btn" type="button" data-grant="${esc(o.id)}">Выдать доступ</button></div>` : ''}
      </section>` : ''}`);
    const form = $('#offer-form');
    $('[data-goal-add]').onclick = () => $('#goals').insertAdjacentHTML('beforeend', goalRow({}));
    $('#goals').onclick = (e) => { const b = e.target.closest('[data-goal-del]'); if (b) b.closest('[data-goal]').remove(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = Object.fromEntries(fd.entries());
      body.goals = $$('[data-goal]', form).map((r) => Object.fromEntries($$('[data-g]', r).map((i) => [i.dataset.g, i.value])));
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true; $('#form-err').textContent = '';
      try {
        await api(o ? '/api/admin/offers/' + encodeURIComponent(o.id) : '/api/admin/offers', { method: 'POST', body });
        closeDrawer();
        await load();
      } catch (err) { $('#form-err').textContent = err.message; btn.disabled = false; }
    };
  }

  /* ───── advertisers ───── */
  function advertisersView() {
    const A = state.advs;
    if (!A) return '<p class="adm-muted">Загрузка…</p>';
    const L = state.pbLog;
    return `
      ${state.newKey ? `<section class="adm-card adm-attn"><h2>Ключ API рекламодателя «${esc(state.newKey.name)}»</h2>
        <p class="adm-muted">Скопируйте и передайте рекламодателю — ключ показывается только один раз. Хранится у нас только его хэш.</p>
        <div class="adm-link"><code>${esc(state.newKey.key)}</code><button class="btn" type="button" data-copy="${esc(state.newKey.key)}">Копировать</button></div>
        <p class="adm-muted">Постбэк: <code class="adm-code">${esc(A.postbackUrl)}?key=${esc(state.newKey.key)}&click_id={click_id}&goal=lead&status=approved&txid={order_id}&amount={sum}</code></p>
        <div class="adm-actions"><button class="btn" type="button" data-key-hide>Я сохранил ключ</button></div></section>` : ''}
      <section class="adm-card">
        <div class="adm-card-head"><h2>Рекламодатели (${A.rows.length})</h2><div class="adm-actions"><a class="btn" href="/docs.html" target="_blank" rel="noopener">Документация API</a><button class="btn btn-primary" type="button" data-adv-new>+ Рекламодатель</button></div></div>
        <p class="adm-muted">Постбэк: <code class="adm-code">${esc(A.postbackUrl)}</code> · API: <code class="adm-code">${esc(A.apiUrl)}</code></p>
        ${A.rows.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Рекламодатель</th><th>Контакты</th><th>Офферы</th><th>Ключ</th><th>Статус</th><th></th></tr></thead><tbody>
          ${A.rows.map((a) => `<tr><td>${esc(a.name)}<span class="adm-sub">${esc(a.company || '')}${a.website ? ' · ' + esc(a.website) : ''}</span></td>
            <td>${esc(a.email || '—')}<span class="adm-sub">${esc(a.telegram || '')}</span></td>
            <td>${a.offers.length ? a.offers.map((o) => `<span class="adm-goal">${esc(o.name)} ${pill(OSTAT[o.status])}</span>`).join('') : '—'}</td>
            <td><code class="adm-code">${esc(a.keyPrefix ? a.keyPrefix + '…' : '—')}</code></td><td>${pill(a.status === 'active' ? ['Активен', 'ok'] : ['Пауза', 'warn'])}</td>
            <td><div class="adm-actions"><button class="btn" type="button" data-adv-edit="${esc(a.id)}">Изменить</button><button class="btn" type="button" data-adv-key="${esc(a.id)}">Новый ключ</button></div></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="adm-empty">Рекламодателей пока нет.</p>'}
      </section>
      <section class="adm-card"><h2>Журнал постбэков</h2>
        ${!L ? '<p class="adm-muted">Загрузка…</p>' : L.rows.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Время</th><th>Направление</th><th>Кто</th><th>Запрос</th><th>Результат</th></tr></thead><tbody>
          ${L.rows.map((l) => `<tr><td>${esc(dt(l.created_at))}</td><td>${l.direction === 'in' ? 'от рекламодателя' : 'партнёру'}</td><td>${esc(l.direction === 'in' ? l.advertiser : l.partner)}</td><td><code class="adm-code">${esc(l.summary || '')}</code></td><td>${pill(l.ok ? ['OK', 'ok'] : ['Ошибка', 'bad'])}<span class="adm-sub">${esc(l.message || '')}</span></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="adm-empty">Постбэков пока не было.</p>'}
      </section>`;
  }

  function openAdvForm(id) {
    const a = id ? state.advs.rows.find((x) => x.id === id) : null;
    const f = a || { status: 'active' };
    openDrawer(`
      <h2 id="dr-title">${a ? esc(a.name) : 'Новый рекламодатель'}</h2>
      <form class="adm-form" id="adv-form" novalidate>
        <div class="adm-fgrid">
          <label class="field"><span>Название (бренд)</span><input class="input" name="name" required maxlength="100" value="${esc(f.name || '')}"></label>
          <label class="field"><span>Юрлицо</span><input class="input" name="company" maxlength="120" value="${esc(f.company || '')}" placeholder="ТОО «…»"></label>
          <label class="field"><span>Email</span><input class="input" name="email" type="email" maxlength="254" value="${esc(f.email || '')}"></label>
          <label class="field"><span>Telegram</span><input class="input" name="telegram" maxlength="64" value="${esc(f.telegram || '')}" placeholder="@manager"></label>
          <label class="field"><span>Сайт</span><input class="input" name="website" maxlength="300" value="${esc(f.website || '')}" placeholder="https://"></label>
          <label class="field"><span>Статус</span><select class="input" name="status"><option value="active"${f.status === 'active' ? ' selected' : ''}>Активен</option><option value="paused"${f.status === 'paused' ? ' selected' : ''}>Пауза (постбэки не принимаются)</option></select></label>
          <label class="field adm-span2"><span>Заметки (договор, условия оплаты, контакты)</span><textarea class="input" name="notes" rows="4" maxlength="2000">${esc(f.notes || '')}</textarea></label>
        </div>
        <p class="error" id="form-err" role="alert"></p>
        <div class="adm-actions"><button class="btn btn-primary" type="submit">${a ? 'Сохранить' : 'Создать и выдать ключ'}</button></div>
      </form>`);
    const form = $('#adv-form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(form).entries());
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true; $('#form-err').textContent = '';
      try {
        const r = await api(a ? '/api/admin/advertisers/' + a.id : '/api/admin/advertisers', { method: 'POST', body });
        if (r.apiKey) state.newKey = { name: r.advertiser.name, key: r.apiKey };
        closeDrawer();
        await load();
      } catch (err) { $('#form-err').textContent = err.message; btn.disabled = false; }
    };
  }

  function openDrawer(html) {
    $('#drawer-body').innerHTML = html;
    $('#drawer').hidden = false;
    document.body.classList.add('locked');
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
          ${kpi('Выплачено', money(L.paidOutKzt))}${kpi('В заявках', money(proc))}${kpi('Доступно (TrendMe)', money(Math.max(0, (L.earnedKzt || 0) - (L.paidOutKzt || 0))), '')}
        </dl>
        ${(() => { const p = state.data.partners.find((x) => x.code === code); if (!p) return ''; const N = natOf(p); return `<h3 class="adm-h">CPA-офферы</h3><dl class="adm-kpis">
          ${kpi('Клики', n(N.clicks))}${kpi('Конверсии', n(N.approved + N.pending), `отклонено ${n(N.rejected)}`)}${kpi('Начислено (период)', money(N.payout), `ожидает ${money(N.pendingPayout)}`, 'is-gold')}
          ${kpi('Подтверждено всего', money(p.native.approvedKzt))}${kpi('В холде', money(p.native.pendingKzt))}${kpi('Доступно всего', money(p.availableKzt), 'TrendMe + CPA', 'is-gold')}
        </dl>`; })()}
        <h3 class="adm-h">TrendMe</h3>
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
    $('#view').innerHTML = { overview, partners, payouts, conversions, offers: offersView, advertisers: advertisersView }[state.tab](d);
    $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
    const q = $('#q');
    if (q) q.oninput = () => { state.q = q.value; const pos = q.selectionStart; render(); const q2 = $('#q'); q2.focus(); q2.setSelectionRange(pos, pos); };
    const cc = $('#conv-code');
    if (cc) cc.onchange = () => { state.convCode = cc.value; render(); };
    const co = $('#cc-offer'), cp = $('#cc-code');
    if (co) co.onchange = () => { state.cc.offer = co.value; state.cc.page = 1; loadCC(); };
    if (cp) cp.onchange = () => { state.cc.code = cp.value; state.cc.page = 1; loadCC(); };
  }

  async function load() {
    $('#err').textContent = '';
    $('#from').value = state.from; $('#to').value = state.to;
    try {
      const q = `from=${state.from}&to=${state.to}`;
      const [d, c, o, a] = await Promise.all([api('/api/admin/dashboard?' + q), api('/api/admin/cpa/overview?' + q), api('/api/admin/offers?' + q), api('/api/admin/advertisers')]);
      state.data = d; state.cpa = c; state.offers = o; state.advs = a;
      const pend = o.rows.reduce((x, r) => x + r.access_rows.filter((y) => y.status === 'pending').length, 0);
      $('#cnt-acc').textContent = pend || '';
      if (state.tab === 'conversions' && state.convSrc === 'cpa') loadCC();
      if (state.tab === 'advertisers') loadLog();
      $('#updated').textContent = 'Обновлено ' + new Date().toLocaleTimeString('ru-RU', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' });
      render();
    } catch (e) {
      $('#err').textContent = e.message;
      if (!state.data) $('#view').innerHTML = '';
    }
  }

  async function loadLog() {
    try { state.pbLog = await api('/api/admin/postbacks'); } catch (e) { state.pbLog = { rows: [] }; $('#err').textContent = e.message; }
    if (state.tab === 'advertisers') render();
  }

  function setDays(days) {
    state.to = ymd(Date.now());
    state.from = ymd(Date.now() - (days - 1) * 86400000);
    $$('[data-days]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days)));
    load();
  }

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('button, tr[data-code], tr[data-offer], [data-close]');
    if (!el) return;
    if (el.matches('[data-close]')) return closeDrawer();
    if (el.matches('tr[data-code]')) return openPartner(el.dataset.code);
    if (el.matches('tr[data-offer]')) return openOfferForm(el.dataset.offer);
    const b = el;
    $('#err').textContent = '';
    if (b.dataset.tab) {
      state.tab = b.dataset.tab;
      render();
      if (state.tab === 'conversions' && state.convSrc === 'cpa' && !state.ccData) loadCC();
      if (state.tab === 'advertisers') loadLog();
      return;
    }
    if ('offerNew' in b.dataset) return openOfferForm(null);
    if ('advNew' in b.dataset) return openAdvForm(null);
    if (b.dataset.advEdit) return openAdvForm(b.dataset.advEdit);
    if ('keyHide' in b.dataset) { state.newKey = null; return render(); }
    if (b.dataset.convSrc) { state.convSrc = b.dataset.convSrc; render(); if (state.convSrc === 'cpa') loadCC(); return; }
    if ('ccStatus' in b.dataset) { state.cc.status = b.dataset.ccStatus; state.cc.page = 1; return loadCC(); }
    if (b.dataset.ccPage) { state.cc.page = Number(b.dataset.ccPage); return loadCC(); }
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
      } else if (b.dataset.cset) {
        if (!window.confirm(b.dataset.st === 'approved' ? 'Подтвердить конверсию вручную? Партнёр получит выплату сразу, без холда.' : 'Отклонить конверсию? Выплата партнёру будет снята.')) return;
        b.disabled = true;
        await api('/api/admin/cpa/conversions/' + b.dataset.cset, { method: 'POST', body: { status: b.dataset.st } });
        await Promise.all([loadCC(), load()]);
      } else if (b.dataset.acc || b.dataset.grant) {
        b.disabled = true;
        const body = b.dataset.grant ? { offer_id: b.dataset.grant, user_id: $('#grant-uid').value, status: 'approved' } : { offer_id: b.dataset.acc, user_id: b.dataset.uid, status: b.dataset.st };
        await api('/api/admin/access', { method: 'POST', body });
        await load();
        if (!$('#drawer').hidden && $('#offer-form')) openOfferForm(body.offer_id);
      } else if (b.dataset.advKey) {
        const a = state.advs.rows.find((x) => x.id === b.dataset.advKey);
        if (!window.confirm(`Выпустить новый ключ для «${a.name}»? Старый ключ сразу перестанет работать.`)) return;
        b.disabled = true;
        const r = await api(`/api/admin/advertisers/${a.id}/key`, { method: 'POST' });
        state.newKey = { name: a.name, key: r.apiKey };
        await load();
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
