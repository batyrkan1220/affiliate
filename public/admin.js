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
  const STATUS = { processing: ['В обработке', 'warn'], paid: ['Выплачено', 'ok'], rejected: ['Отклонено', 'bad'], cancelled: ['Отменено партнёром', 'mute'] };
  const CONV = { earned: ['Начислено', 'ok'], reversed: ['Отменено (возврат)', 'bad'] };
  const pill = ([t, c]) => `<span class="adm-pill ${c}">${esc(t)}</span>`;

  const state = {
    tab: 'overview', from: ymd(Date.now() - 29 * 86400000), to: ymd(Date.now()), data: null, cpa: null, offers: null, advs: null,
    q: '', sort: ['earnedKzt', -1], payStatus: 'processing', convStatus: '', convCode: '',
    convSrc: 'cpa', rep: { group: 'date', source: '', offer: '', code: '' }, repData: null, of: { q: '', status: '', adv: '' }, cc: { status: '', offer: '', code: '', source: '', page: 1 }, ccData: null, pbLog: null, newKey: null,
  };
  const CSTAT = { approved: ['Подтверждена', 'ok'], pending: ['В ожидании', 'warn'], rejected: ['Отклонена', 'bad'] };
  const OSTAT = { active: ['Активен', 'ok'], paused: ['Пауза', 'warn'], archived: ['Архив', 'mute'] };
  const OACC = { open: 'Открытый', approval: 'По заявке', private: 'Приватный' };
  const MACROS = '{click_id} — обязателен; {aff_id}, {offer_id}, {sub1}…{sub5}, {source}, {sub_aff_id}';
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

  /* ───── network block (TrendMe + CPA) ───── */
  function networkBlock(d) {
    const C = state.cpa, O = state.offers;
    if (!C || !O) return '';
    const T = d.totals, K = C.totals;
    const clicks = T.visits + K.clicks;
    const convs = T.paidOrders + K.approved + K.pending;
    const income = T.revenueKzt + K.revenue;
    const payout = T.earnedKzt + K.payout;
    const list = [
      ...(O.builtin || []).map((b) => ({ id: b.id, name: b.name, adv: b.advertiser, clicks: b.stats.clicks, conv: b.stats.conversions, income: b.stats.revenue, payout: b.stats.payout, builtin: true })),
      ...O.rows.map((o) => { const s = o.stats || {}; return { id: o.id, name: o.name, adv: o.advertiser, clicks: s.clicks || 0, conv: (s.approved || 0) + (s.pending || 0), income: s.revenue || 0, payout: s.payout || 0 }; }),
    ].sort((a, b) => b.income - a.income || b.clicks - a.clicks).slice(0, 8);
    const advs = advStats().filter((a) => a.clicks || a.income).sort((a, b) => b.income - a.income).slice(0, 6);
    return `<h2 class="adm-h">Вся сеть <span class="adm-muted">TrendMe + CPA-офферы</span></h2>
      <dl class="adm-kpis">
        ${kpi('Клики / переходы', n(clicks), `TrendMe ${n(T.visits)} · CPA ${n(K.clicks)}`)}
        ${kpi('Конверсии', n(convs), `CR ${pct(convs, clicks)} · ожидают ${n(K.pending)}`)}
        ${kpi('Доход сети', money(income), 'оборот TrendMe + оплаты рекламодателей')}
        ${kpi('Выплаты партнёрам', money(payout), `ожидает ${money(K.pendingPayout)}`, 'is-gold')}
        ${kpi('Прибыль', money(income - payout), `маржа ${pct(income - payout, income)}`)}
        ${kpi('EPC сети', clicks ? money(payout / clicks) : '—', 'выплата партнёру за клик')}
        ${kpi('Офферы', n((O.builtin || []).length + C.offers), `активных ${n((O.builtin || []).length + C.activeOffers)}`)}
        ${kpi('Рекламодатели', n(state.advs ? state.advs.rows.length : 0), '')}
      </dl>
      <div class="adm-grid2">
        <section class="adm-card"><h2>Топ офферов</h2>${list.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Оффер</th><th class="r">Клики</th><th class="r">Конв.</th><th class="r">Доход</th><th class="r">Прибыль</th></tr></thead><tbody>
          ${list.map((o) => `<tr ${o.builtin ? 'data-builtin="trendme"' : `data-offer="${esc(o.id)}"`}><td>${esc(o.name)}<span class="adm-sub">${esc(o.adv)}</span></td><td class="r">${n(o.clicks)}</td><td class="r">${n(o.conv)}</td><td class="r">${money(o.income)}</td><td class="r"><b>${money(o.income - o.payout)}</b></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="adm-empty">Нет данных.</p>'}</section>
        <section class="adm-card"><h2>Топ рекламодателей</h2>${advs.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Рекламодатель</th><th class="r">Офферы</th><th class="r">Конв.</th><th class="r">Доход</th><th class="r">Прибыль</th></tr></thead><tbody>
          ${advs.map((a) => `<tr><td>${esc(a.name)}</td><td class="r">${n(a.offers)}</td><td class="r">${n(a.conv)}</td><td class="r">${money(a.income)}</td><td class="r"><b>${money(a.income - a.payout)}</b></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="adm-empty">Нет данных.</p>'}</section>
      </div>`;
  }

  // per-advertiser numbers for the period, from the offers list (+ TrendMe built-in)
  function advStats() {
    const O = state.offers, A = state.advs;
    if (!O || !A) return [];
    return A.rows.map((a) => {
      const g = { id: a.id, name: a.name, offers: 0, clicks: 0, conv: 0, rejected: 0, income: 0, payout: 0, pendingIncome: 0, pendingPayout: 0 };
      if (a.integration === 'trendme') for (const b of O.builtin || []) { g.offers++; g.clicks += b.stats.clicks; g.conv += b.stats.conversions; g.income += b.stats.revenue; g.payout += b.stats.payout; }
      for (const o of O.rows) {
        if (o.advertiser_id !== a.id) continue;
        const s = o.stats || {};
        g.offers++; g.clicks += s.clicks || 0; g.conv += (s.approved || 0) + (s.pending || 0); g.rejected += s.rejected || 0;
        g.income += s.revenue || 0; g.payout += s.payout || 0; g.pendingIncome += s.pendingRevenue || 0; g.pendingPayout += s.pendingPayout || 0;
      }
      return g;
    });
  }

  /* ───── reports ───── */
  function reportsView(d) {
    const R = state.rep, D = state.repData;
    const groups = D ? D.groups : { date: 'Дата', offer: 'Оффер', partner: 'Партнёр', advertiser: 'Рекламодатель' };
    const offers = [{ id: 'trendme', name: 'TrendMe — AI тренд-видео' }, ...(state.offers ? state.offers.rows : [])];
    const qs = new URLSearchParams({ from: state.from, to: state.to, group: R.group, ...(R.source && { source: R.source }), ...(R.offer && { offer: R.offer }), ...(R.code && { code: R.code }) });
    const T = D && D.totals;
    const line = (x, tag = 'td', cls = '') => `<${tag} class="r ${cls}">${n(x.clicks)}</${tag}><${tag} class="r">${n(x.uniq)}</${tag}><${tag} class="r">${n(x.conversions)}</${tag}><${tag} class="r">${n(x.approved)}</${tag}><${tag} class="r">${n(x.pending)}</${tag}><${tag} class="r">${n(x.rejected)}</${tag}>
      <${tag} class="r">${pct(x.conversions, x.clicks)}</${tag}><${tag} class="r">${pct(x.approved, x.approved + x.rejected)}</${tag}><${tag} class="r">${money(x.sales)}</${tag}><${tag} class="r">${money(x.revenue)}</${tag}><${tag} class="r">${money(x.payout)}</${tag}>
      <${tag} class="r"><b>${money(x.revenue - x.payout)}</b></${tag}><${tag} class="r">${money(x.pendingPayout)}</${tag}><${tag} class="r">${x.clicks ? money(x.payout / x.clicks) : '—'}</${tag}>`;
    return `<section class="adm-card">
      <div class="adm-card-head"><h2>Отчёт</h2><a class="btn" href="/api/admin/report.csv?${qs}">CSV</a></div>
      <div class="adm-period" role="group" aria-label="Группировка"><span class="adm-muted">Группировка:</span>
        ${Object.entries(groups).map(([k, t]) => `<button class="chip" type="button" data-rep-group="${k}" aria-pressed="${R.group === k}">${esc(t)}</button>`).join('')}</div>
      <div class="adm-period">
        ${[['', 'Все источники'], ['trendme', 'TrendMe'], ['cpa', 'CPA-офферы']].map(([k, t]) => `<button class="chip" type="button" data-rep-source="${k}" aria-pressed="${R.source === k}">${t}</button>`).join('')}
        <select class="input adm-search" id="rep-offer"><option value="">Все офферы</option>${offers.map((o) => `<option value="${esc(o.id)}"${R.offer === o.id ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
        <select class="input adm-search" id="rep-code"><option value="">Все партнёры</option>${d.partners.map((p) => `<option value="${esc(p.code)}"${R.code === p.code ? ' selected' : ''}>${esc(p.name)} (${esc(p.code)})</option>`).join('')}</select>
      </div>
      ${D && D.note ? `<p class="adm-muted">${esc(D.note)}</p>` : ''}
      ${!D ? '<p class="adm-muted">Загрузка…</p>' : D.rows.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>${esc(groups[D.group])}</th><th class="r">Клики</th><th class="r">Уник.</th><th class="r">Конв.</th><th class="r">Подтв.</th><th class="r">Ожид.</th><th class="r">Откл.</th><th class="r">CR</th><th class="r">Аппрув</th><th class="r">Продажи</th><th class="r">Доход</th><th class="r">Выплаты</th><th class="r">Прибыль</th><th class="r">Ожидает выплат</th><th class="r">EPC</th></tr></thead><tbody>
        ${D.rows.map((x) => `<tr><td>${esc(x.label)}</td>${line(x)}</tr>`).join('')}
      </tbody><tfoot><tr><td>Итого</td>${line(T)}</tr></tfoot></table></div>` : '<p class="adm-empty">Нет данных за период.</p>'}
      <p class="adm-muted">CR — конверсии / клики. Аппрув — подтверждённые / (подтверждённые + отклонённые). EPC — выплата партнёрам за клик. Доход по TrendMe — оборот оплат, по CPA — оплата рекламодателя.</p>
    </section>`;
  }

  async function loadRep() {
    const R = state.rep;
    const qs = new URLSearchParams({ from: state.from, to: state.to, group: R.group, ...(R.source && { source: R.source }), ...(R.offer && { offer: R.offer }), ...(R.code && { code: R.code }) });
    state.repData = null;
    if (state.tab === 'reports') render();
    try { state.repData = await api('/api/admin/report?' + qs); } catch (e) { $('#err').textContent = e.message; state.repData = { groups: {}, group: R.group, totals: {}, rows: [] }; }
    if (state.tab === 'reports') render();
  }

  /* ───── views ───── */
  function overview(d) {
    const T = d.totals;
    const top = [...d.partners].sort((a, b) => b.period.earnedKzt - a.period.earnedKzt || b.period.visits - a.period.visits).slice(0, 8);
    return `
      ${networkBlock(d)}
      <h2 class="adm-h">TrendMe (бот) и выплаты</h2>
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
      <h2 class="adm-h">TrendMe по дням</h2>
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
        <td>${esc(r.method)}</td><td><code class="adm-code">${esc(r.details)}</code></td><td>${pill(STATUS[r.status] || [r.status, 'mute'])}${r.ref ? `<span class="adm-sub">платёж: ${esc(r.ref)}</span>` : ''}${r.note && r.status !== 'paid' ? `<span class="adm-sub">${esc(r.note)}</span>` : ''}</td><td>${esc(dt(r.processedAt))}${r.processedBy ? `<span class="adm-sub">${esc(r.processedBy)}</span>` : ''}</td>
        ${withActions ? `<td>${r.status === 'processing' ? `<div class="adm-actions"><button class="btn btn-primary" type="button" data-pay="${esc(r.id)}">Проверить и выплатить</button><button class="btn btn-danger-soft" type="button" data-reject="${esc(r.id)}">Отклонить</button></div>` : ''}</td>` : ''}</tr>`).join('')}
      </tbody></table></div>`;
  }

  async function openPayCheck(id) {
    openDrawer('<p class="adm-muted">Проверяем баланс партнёра…</p>');
    let x;
    try { x = await api(`/api/admin/requests/${id}/check`); } catch (e) { $('#drawer-body').innerHTML = `<h2 id="dr-title">Проверка выплаты</h2><p class="error">${esc(e.message)}</p><p class="adm-muted">Если TrendMe просыпается — повторите через минуту.</p>`; return; }
    const r = x.request, c = x.check;
    if (!c) { $('#drawer-body').innerHTML = `<h2 id="dr-title">Заявка уже обработана</h2>`; return; }
    $('#drawer-body').innerHTML = `
      <h2 id="dr-title">Выплата ${money(r.amount)} <span class="adm-muted">${esc(c.partner.name)} · ${esc(c.partner.code)}</span></h2>
      <section class="adm-card ${c.enough ? '' : 'adm-attn'}"><h2>${c.enough ? '✓ Баланса достаточно' : '⚠ Баланса недостаточно'}</h2>
        <dl class="adm-kv">
          <dt>Доступно сейчас</dt><dd><b>${money(c.available)}</b> (без этой заявки)</dd>
          <dt>TrendMe</dt><dd>начислено ${money(c.tm.earned)} − выплачено ${money(c.tm.paid)} = <b>${money(c.tm.available)}</b></dd>
          <dt>CPA-офферы</dt><dd>подтверждено ${money(c.cpa.approved)} − выплачено ${money(c.cpa.paid)} = <b>${money(c.cpa.available)}</b>${c.cpa.pending ? ` · в холде ${money(c.cpa.pending)} (не входит)` : ''}</dd>
          ${c.otherOpen ? `<dt>Другие заявки</dt><dd>${money(c.otherOpen)}</dd>` : ''}
          <dt>Партнёр</dt><dd>${c.partner.active ? pill(['Активен', 'ok']) : pill(['Вход заблокирован', 'bad'])} ${esc(c.partner.email)}</dd>
        </dl></section>
      <section class="adm-card"><h2>Куда отправить</h2>
        <div class="adm-link"><span class="adm-muted">${esc(r.method)}</span><code>${esc(r.details)}</code><button class="btn" type="button" data-copy="${esc(r.details)}">Копировать</button></div>
        <div class="adm-link"><span class="adm-muted">Сумма</span><code>${esc(r.amount)}</code><button class="btn" type="button" data-copy="${esc(r.amount)}">Копировать</button></div>
        ${c.detailsChanged ? `<p class="adm-muted">⚠ Партнёр уже сменил реквизиты на: <code class="adm-code">${esc(c.partner.payout)}</code>. Отправляйте по реквизитам из заявки или уточните у партнёра.</p>` : ''}
        <p class="adm-muted">Создана ${esc(dt(r.createdAt))}</p></section>
      <form class="adm-card adm-form" id="pay-form">
        <h2>Подтвердить выплату</h2>
        <p class="adm-muted">Сначала отправьте деньги партнёру, затем отметьте здесь. TrendMe-часть (${money(Math.min(r.amount, c.tm.available))}) запишется в TrendMe, остальное — по CPA-офферам.</p>
        <label class="field"><span>Номер платежа / квитанции (видит партнёр)</span><input class="input" name="ref" maxlength="200" placeholder="Kaspi перевод №… или txid"></label>
        <label class="field"><span>Комментарий (необязательно)</span><input class="input" name="note" maxlength="300"></label>
        ${c.enough ? '' : '<label class="adm-check"><input type="checkbox" name="force"> Всё равно отметить выплаченной (баланс уйдёт в минус)</label>'}
        <p class="error" id="pay-err" role="alert"></p>
        <div class="adm-actions"><button class="btn btn-primary" type="submit">Деньги отправлены — отметить «Выплачено»</button><button class="btn btn-danger-soft" type="button" data-reject="${esc(r.id)}">Отклонить</button></div>
      </form>`;
    $('#pay-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const btn = e.target.querySelector('[type=submit]');
      if (!c.enough && !f.get('force')) { $('#pay-err').textContent = 'Баланса недостаточно. Отклоните заявку или отметьте галочку.'; return; }
      if (!window.confirm(`Подтвердить: ${money(r.amount)} отправлено партнёру ${c.partner.name} (${r.method} ${r.details})?`)) return;
      btn.disabled = true; $('#pay-err').textContent = '';
      try {
        await api('/api/admin/requests/' + r.id, { method: 'POST', body: { action: 'paid', ref: String(f.get('ref') || ''), note: String(f.get('note') || ''), force: !!f.get('force') } });
        closeDrawer(); await load();
      } catch (err) { $('#pay-err').textContent = err.message; btn.disabled = false; }
    };
  }

  function openReject(id) {
    const r = state.data.requests.find((x) => x.id === id);
    openDrawer(`
      <h2 id="dr-title">Отклонить заявку <span class="adm-muted">${esc(r.name)} · ${money(r.amount)}</span></h2>
      <form class="adm-card adm-form" id="rej-form">
        <p class="adm-muted">Сумма вернётся в доступный баланс партнёра. Причину партнёр увидит в истории выплат.</p>
        <label class="field"><span>Причина отказа</span><textarea class="input" name="note" rows="3" maxlength="300" required placeholder="Например: неверные реквизиты — исправьте и запросите снова"></textarea></label>
        <div class="adm-period">${['Неверные реквизиты — исправьте и запросите снова', 'Конверсии отменены рекламодателем', 'Подозрение на фрод — свяжитесь с менеджером'].map((t) => `<button class="chip" type="button" data-reason="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <p class="error" id="rej-err" role="alert"></p>
        <div class="adm-actions"><button class="btn btn-danger-soft" type="submit">Отклонить заявку</button><button class="btn" type="button" data-close>Отмена</button></div>
      </form>`);
    const form = $('#rej-form');
    form.onclick = (e) => { const b = e.target.closest('[data-reason]'); if (b) form.note.value = b.dataset.reason; };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const note = form.note.value.trim();
      if (note.length < 3) { $('#rej-err').textContent = 'Укажите причину.'; return; }
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try { await api('/api/admin/requests/' + r.id, { method: 'POST', body: { action: 'rejected', note } }); closeDrawer(); await load(); }
      catch (err) { $('#rej-err').textContent = err.message; btn.disabled = false; }
    };
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
          <div class="adm-period">${[['processing', 'В обработке'], ['paid', 'Выплачено'], ['rejected', 'Отклонено'], ['cancelled', 'Отменено'], ['', 'Все']].map(([k, t]) => `<button class="chip" type="button" data-pay-status="${k}" aria-pressed="${state.payStatus === k}">${t}</button>`).join('')}
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
    const c = state.cc, D = state.ccData;
    const offers = [{ id: 'trendme', name: 'TrendMe — AI тренд-видео' }, ...(state.offers ? state.offers.rows : [])];
    const qs = new URLSearchParams({ from: state.from, to: state.to, ...(c.status && { status: c.status }), ...(c.offer && { offer: c.offer }), ...(c.code && { code: c.code }), ...(c.source && { source: c.source }) });
    const pages = D ? Math.max(1, Math.ceil(D.total / D.perPage)) : 1;
    const K = D ? D.counts : {};
    const chip = (attr, k, t, cur) => `<button class="chip" type="button" ${attr}="${k}" aria-pressed="${cur === k}">${t}</button>`;
    return `${D ? `<dl class="adm-kpis">
        ${kpi('Конверсии', n(K.all), 'все статусы за период')}${kpi('Подтверждены', n(K.approved), `CR ${pct(K.approved, K.all)}`)}${kpi('В ожидании', n(K.pending), 'ждут оплаты / холд')}${kpi('Отклонены', n(K.rejected), 'неоплата, отмена, возврат')}
        ${kpi('Начислено партнёрам', money(D.sums.approvedPayout), 'подтверждённые', 'is-gold')}${kpi('Ожидает начисления', money(D.sums.pendingPayout), 'если подтвердятся')}</dl>` : ''}
      <section class="adm-card">
      <div class="adm-card-head"><h2>Журнал конверсий ${D ? `(${n(D.total)})` : ''}</h2>
        <div class="adm-period">
          ${[['', 'Все'], ['pending', 'В ожидании'], ['approved', 'Подтверждены'], ['rejected', 'Отклонены']].map(([k, t]) => chip('data-cc-status', k, t, c.status)).join('')}
        </div></div>
      <div class="adm-period">
        ${[['', 'Все источники'], ['trendme', 'TrendMe'], ['cpa', 'CPA-офферы']].map(([k, t]) => chip('data-cc-source', k, t, c.source)).join('')}
        <select class="input adm-search" id="cc-offer"><option value="">Все офферы</option>${offers.map((o) => `<option value="${esc(o.id)}"${c.offer === o.id ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
        <select class="input adm-search" id="cc-code"><option value="">Все партнёры</option>${d.partners.map((p) => `<option value="${esc(p.code)}"${c.code === p.code ? ' selected' : ''}>${esc(p.name)} (${esc(p.code)})</option>`).join('')}</select>
        <a class="btn" href="/api/admin/conversions.csv?${qs}">CSV</a>
      </div>
      ${D && D.trendmeUnavailable ? '<p class="adm-muted">TrendMe сейчас просыпается — его заказы появятся через минуту.</p>' : ''}
      ${!D ? '<p class="adm-muted">Загрузка…</p>' : D.rows.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Время</th><th>Оффер</th><th>Партнёр</th><th>Цель</th><th>Заказ / txid</th><th class="r">Сумма</th><th class="r">Доход сети</th><th class="r">Партнёру</th><th>Статус</th><th>У рекламодателя</th><th>sub1 · источник</th><th></th></tr></thead><tbody>
        ${D.rows.map((x) => `<tr><td>${esc(dt(x.time))}</td><td>${esc(x.offer)}<span class="adm-sub">${esc(x.advertiser)}</span></td><td>${esc(x.partner)}<span class="adm-sub">${esc(x.code)}</span></td><td>${esc(x.goal)}${x.percent ? `<span class="adm-sub">${esc(x.percent)}%</span>` : ''}</td>
          <td><code class="adm-code">${esc(x.txid || '—')}</code>${x.click_id ? `<span class="adm-sub">${esc(x.click_id)}</span>` : ''}</td><td class="r">${x.sale == null ? '—' : money(x.sale)}</td><td class="r">${money(x.revenue)}</td><td class="r"><b>${money(x.payout)}</b></td>
          <td>${pill(CSTAT[x.status] || [x.status, 'mute'])}${x.hold_until && x.status === 'pending' ? `<span class="adm-sub">холд до ${esc(dt(x.hold_until))}</span>` : ''}${x.note ? `<span class="adm-sub">${esc(x.note)}</span>` : ''}</td>
          <td>${esc(x.adv_label || '—')}</td><td>${esc(x.sub1 || '—')}<span class="adm-sub">${esc(x.source_traffic || '')}${x.country ? ' · ' + esc(x.country) : ''}</span></td>
          <td>${x.source === 'cpa' ? `<div class="adm-actions">${x.status !== 'approved' ? `<button class="btn btn-primary" type="button" data-cset="${esc(x.id)}" data-st="approved">Подтвердить</button>` : ''}${x.status !== 'rejected' ? `<button class="btn btn-danger-soft" type="button" data-cset="${esc(x.id)}" data-st="rejected">Отклонить</button>` : ''}</div>` : '<span class="adm-sub">статус из TrendMe</span>'}</td></tr>`).join('')}
      </tbody></table></div>
      ${pages > 1 ? `<div class="adm-pager"><button class="btn" type="button" data-cc-page="${c.page - 1}"${c.page <= 1 ? ' disabled' : ''}>←</button><span>${c.page} / ${pages}</span><button class="btn" type="button" data-cc-page="${c.page + 1}"${c.page >= pages ? ' disabled' : ''}>→</button></div>` : ''}` : '<p class="adm-empty">Конверсий за период нет. Как только клиент по ссылке партнёра создаст заказ, он появится здесь «в ожидании».</p>'}
    </section>`;
  }

  async function loadCC() {
    const c = state.cc;
    const qs = new URLSearchParams({ from: state.from, to: state.to, page: String(c.page), ...(c.status && { status: c.status }), ...(c.offer && { offer: c.offer }), ...(c.code && { code: c.code }), ...(c.source && { source: c.source }) });
    state.ccData = null;
    if (state.tab === 'conversions') render();
    try { state.ccData = await api('/api/admin/conversions?' + qs); } catch (e) { $('#err').textContent = e.message; state.ccData = { total: 0, perPage: 100, rows: [] }; }
    if (state.tab === 'conversions') render();
  }

  /* ───── offers ───── */
  function offersView() {
    const O = state.offers;
    if (!O) return '<p class="adm-muted">Загрузка…</p>';
    const F = state.of;
    const reqs = O.rows.flatMap((o) => o.access_rows.filter((a) => a.status === 'pending').map((a) => ({ ...a, offerName: o.name })));
    const q = F.q.trim().toLowerCase();
    const list = O.rows.filter((o) => (!F.status || o.status === F.status) && (!F.adv || o.advertiser_id === F.adv)
      && (!q || [o.id, o.name, o.advertiser, (o.categories || []).join(' '), (o.geo || []).join(' ')].join(' ').toLowerCase().includes(q)));
    const cnt = (st) => O.rows.filter((o) => o.status === st).length;
    const showBuiltin = (!F.status || F.status === 'active') && (!F.adv) && (!q || 'trendme тренд видео'.includes(q) || q.includes('trendme'));
    const builtin = showBuiltin ? (O.builtin || []) : [];
    const T = list.reduce((t, o) => { const s = o.stats || {}; t.clicks += s.clicks || 0; t.conv += (s.approved || 0) + (s.pending || 0); t.rev += s.revenue || 0; t.pay += s.payout || 0; return t; }, { clicks: 0, conv: 0, rev: 0, pay: 0 });
    const act = (o) => `<div class="adm-actions adm-row-actions">
      <button class="btn" type="button" data-ofa="edit" data-id="${esc(o.id)}">Изменить</button>
      <button class="btn" type="button" data-ofa="copy" data-id="${esc(o.id)}" title="Создать копию">Копия</button>
      ${o.status === 'active' ? `<button class="btn" type="button" data-ofa="paused" data-id="${esc(o.id)}">Пауза</button>` : `<button class="btn btn-primary" type="button" data-ofa="active" data-id="${esc(o.id)}">Запустить</button>`}
      ${o.status !== 'archived' ? `<button class="btn" type="button" data-ofa="archived" data-id="${esc(o.id)}">В архив</button>` : ''}
      <button class="btn btn-danger-soft" type="button" data-ofa="delete" data-id="${esc(o.id)}">Удалить</button></div>`;
    return `
      ${reqs.length ? `<section class="adm-card adm-attn"><h2>Заявки на доступ (${reqs.length})</h2><div class="table-scroll"><table class="adm-table"><thead><tr><th>Дата</th><th>Партнёр</th><th>Оффер</th><th></th></tr></thead><tbody>
        ${reqs.map((a) => `<tr><td>${esc(dt(a.created_at))}</td><td>${esc(a.name)}<span class="adm-sub">${esc(a.code)}${a.email ? ' · ' + esc(a.email) : ''}</span></td><td>${esc(a.offerName)}<span class="adm-sub">${esc(a.offer_id)}</span></td>
          <td><div class="adm-actions"><button class="btn btn-primary" type="button" data-acc="${esc(a.offer_id)}" data-uid="${esc(a.user_id)}" data-st="approved">Одобрить</button><button class="btn btn-danger-soft" type="button" data-acc="${esc(a.offer_id)}" data-uid="${esc(a.user_id)}" data-st="rejected">Отклонить</button></div></td></tr>`).join('')}
      </tbody></table></div></section>` : ''}
      <dl class="adm-kpis">
        ${kpi('Офферы', n(O.rows.length + (O.builtin || []).length), `активных ${n(cnt('active') + (O.builtin || []).length)} · пауза ${n(cnt('paused'))} · архив ${n(cnt('archived'))}`)}
        ${kpi('Клики', n(T.clicks), 'CPA-офферы за период')}${kpi('Конверсии', n(T.conv), `CR ${pct(T.conv, T.clicks)}`)}
        ${kpi('Доход', money(T.rev), 'от рекламодателей')}${kpi('Выплаты', money(T.pay), 'партнёрам')}${kpi('Прибыль', money(T.rev - T.pay), '', 'is-gold')}
      </dl>
      <section class="adm-card">
        <div class="adm-card-head"><h2>Офферы (${list.length + builtin.length})</h2><div class="adm-actions"><a class="btn" href="/docs.html#offer" target="_blank" rel="noopener">Как добавить оффер</a><button class="btn btn-primary" type="button" data-offer-new>+ Новый оффер</button></div></div>
        <div class="adm-period">
          <input class="input adm-search" id="of-q" type="search" placeholder="Поиск: название, ID, категория, ГЕО" value="${esc(F.q)}">
          ${[['', 'Все'], ['active', 'Активные'], ['paused', 'Пауза'], ['archived', 'Архив']].map(([k, t]) => `<button class="chip" type="button" data-of-status="${k}" aria-pressed="${F.status === k}">${t}</button>`).join('')}
          <select class="input adm-search" id="of-adv"><option value="">Все рекламодатели</option>${O.advertisers.map((a) => `<option value="${esc(a.id)}"${F.adv === a.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
        </div>
        ${!O.advertisers.length ? '<p class="adm-empty">Чтобы добавить оффер, сначала создайте рекламодателя во вкладке «Рекламодатели».</p>' : ''}
        ${list.length || builtin.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Оффер</th><th>Рекламодатель</th><th>Модель</th><th>Цели: партнёру / сети</th><th>Доступ</th><th>Холд · кап</th><th class="r">Клики</th><th class="r">Конв.</th><th class="r">Доход</th><th class="r">Выплаты</th><th class="r">Прибыль</th><th>Статус</th></tr></thead><tbody>
          ${builtin.map((b) => { const s = b.stats; const pr = b.percentMin == null ? '% партнёра' : b.percentMin === b.percentMax ? `${b.percentMin}%` : `${b.percentMin}–${b.percentMax}%`; const u = b.unavailable; return `<tr data-builtin="${esc(b.id)}"><td>${esc(b.name)}<span class="adm-sub">${esc(b.id)} · KZ · встроенный · настройки в TrendMe</span></td><td>${esc(b.advertiser)}</td><td>${esc(b.model)}</td>
            <td><span class="adm-goal">Оплата заказа: <b>${esc(pr)}</b> / оборот</span></td>
            <td>Все партнёры<span class="adm-sub">${n(b.activePartners)} партн.</span></td><td>—</td>
            <td class="r">${u ? '…' : n(s.clicks)}</td><td class="r">${u ? '…' : n(s.conversions)}</td><td class="r">${u ? '…' : money(s.revenue)}</td><td class="r">${u ? '…' : money(s.payout)}</td><td class="r"><b>${u ? '…' : money(s.revenue - s.payout)}</b></td><td>${pill(['Встроенный', 'ok'])}</td></tr>`; }).join('')}
          ${list.map((o) => { const s = o.stats || {}; const ended = o.ends_on && ymd(Date.now()) > String(o.ends_on).slice(0, 10); return `<tr data-offer="${esc(o.id)}"><td>${o.logo_url ? `<img class="adm-logo" src="${esc(o.logo_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}${esc(o.name)}<span class="adm-sub">${esc(o.id)}${o.geo.length ? ' · ' + esc(o.geo.join(', ')) : ''}${o.ends_on ? ' · до ' + esc(String(o.ends_on).slice(0, 10)) : ''}</span>${act(o)}</td><td>${esc(o.advertiser)}</td><td>${esc(o.model)}</td>
            <td>${o.goals.map((g) => `<span class="adm-goal">${esc(g.name)}: <b>${goalMoney(g.payout_type, g.payout)}</b> / ${goalMoney(g.revenue_type, g.revenue)}</span>`).join('')}</td>
            <td>${esc(OACC[o.access])}<span class="adm-sub">${n(o.access_rows.filter((a) => a.status === 'approved').length)} партн.</span></td><td>${n(o.hold_days)} дн.${o.daily_cap ? ' · ' + n(o.daily_cap) + '/день' : ''}</td>
            <td class="r">${n(s.clicks)}</td><td class="r">${n((s.approved || 0) + (s.pending || 0))}</td><td class="r">${money(s.revenue)}</td><td class="r">${money(s.payout)}</td><td class="r"><b>${money((s.revenue || 0) - (s.payout || 0))}</b></td><td>${pill(OSTAT[o.status])}${ended ? pill(['Срок истёк', 'warn']) : ''}</td></tr>`; }).join('')}
        </tbody></table></div>` : '<p class="adm-empty">Ничего не найдено.</p>'}
      </section>`;
  }

  // Offer card (view): everything about one offer + stats for the period.
  async function openOfferCard(id) {
    openDrawer('<p class="adm-muted">Загрузка…</p>');
    let d;
    try { d = await api(`/api/admin/offers/${encodeURIComponent(id)}?from=${state.from}&to=${state.to}`); } catch (e) { $('#drawer-body').innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
    const o = d.offer, T = d.totals, TR = (state.offers && state.offers.traffic) || {};
    const conv = T.approved + T.pending;
    const site = location.origin;
    const goalsT = `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Код</th><th>Цель</th><th class="r">Партнёру</th><th class="r">От рекламодателя</th><th class="r">Маржа</th></tr></thead><tbody>
      ${o.goals.map((g) => `<tr><td><code class="adm-code">${esc(g.code)}</code></td><td>${esc(g.name)}</td><td class="r"><b>${goalMoney(g.payout_type, g.payout)}</b></td><td class="r">${goalMoney(g.revenue_type, g.revenue)}</td><td class="r">${g.payout_type === g.revenue_type ? goalMoney(g.payout_type, Math.round((g.revenue - g.payout) * 100) / 100) : '—'}</td></tr>`).join('')}
      </tbody></table></div>`;
    $('#drawer-body').innerHTML = `
      <h2 id="dr-title">${o.logo_url ? `<img class="adm-logo" src="${esc(o.logo_url)}" alt="" referrerpolicy="no-referrer">` : ''}${esc(o.name)} <span class="adm-muted">${esc(o.id)}</span></h2>
      <div class="adm-actions">${pill(OSTAT[o.status])}${d.live ? '' : pill(['Вне срока — трафик не принимается', 'warn'])}
        <button class="btn btn-primary" type="button" data-ofa="edit" data-id="${esc(o.id)}">Изменить</button>
        <button class="btn" type="button" data-ofa="copy" data-id="${esc(o.id)}">Копия</button>
        ${o.status === 'active' ? `<button class="btn" type="button" data-ofa="paused" data-id="${esc(o.id)}">Пауза</button>` : `<button class="btn" type="button" data-ofa="active" data-id="${esc(o.id)}">Запустить</button>`}
        ${o.status !== 'archived' ? `<button class="btn" type="button" data-ofa="archived" data-id="${esc(o.id)}">В архив</button>` : ''}
        <button class="btn btn-danger-soft" type="button" data-ofa="delete" data-id="${esc(o.id)}"${d.convTotal ? ' title="Есть конверсии — удаление недоступно"' : ''}>Удалить</button></div>
      <dl class="adm-kpis">
        ${kpi('Клики', n(T.clicks), `уник. ${n(T.uniq)}`)}${kpi('Конверсии', n(conv), `CR ${pct(conv, T.clicks)} · откл. ${n(T.rejected)}`)}${kpi('Сумма продаж', money(T.sales))}
        ${kpi('Доход', money(T.revenue), `ожидает ${money(T.pendingRevenue)}`)}${kpi('Выплаты', money(T.payout), `ожидает ${money(T.pendingPayout)}`)}${kpi('Прибыль', money(T.revenue - T.payout), `EPC ${T.clicks ? money(Math.round(T.payout / T.clicks)) : '—'}`, 'is-gold')}
      </dl>
      <section class="adm-card"><h2>Параметры</h2><dl class="adm-kv">
        <dt>Рекламодатель</dt><dd>${esc(d.advertiser ? d.advertiser.name : '—')}</dd>
        <dt>Модель</dt><dd>${esc(o.model)}</dd>
        <dt>Доступ</dt><dd>${esc(OACC[o.access])}</dd>
        <dt>ГЕО</dt><dd>${esc((o.geo || []).join(', ') || 'любое')}</dd>
        <dt>Категории</dt><dd>${esc((o.categories || []).join(', ') || '—')}</dd>
        <dt>Холд</dt><dd>${n(o.hold_days)} дн.</dd>
        <dt>Кап</dt><dd>${o.daily_cap ? n(o.daily_cap) + ' конв./день' : 'без лимита'}</dd>
        <dt>Срок</dt><dd>${o.starts_on || o.ends_on ? `${esc(o.starts_on ? String(o.starts_on).slice(0, 10) : '…')} — ${esc(o.ends_on ? String(o.ends_on).slice(0, 10) : 'бессрочно')}` : 'бессрочно'}</dd>
        <dt>Создан / изменён</dt><dd>${esc(dt(o.created_at))} / ${esc(dt(o.updated_at))}</dd>
        <dt>Конверсий всего</dt><dd>${n(d.convTotal)}</dd>
      </dl></section>
      <section class="adm-card"><h2>Цели и выплаты</h2>${goalsT}</section>
      ${(o.traffic_allowed || []).length || (o.traffic_banned || []).length ? `<section class="adm-card"><h2>Источники трафика</h2>
        ${(o.traffic_allowed || []).length ? `<p>${o.traffic_allowed.map((k) => pill([TR[k] || k, 'ok'])).join(' ')}</p>` : ''}
        ${(o.traffic_banned || []).length ? `<p>${o.traffic_banned.map((k) => pill([TR[k] || k, 'bad'])).join(' ')}</p>` : ''}</section>` : ''}
      ${o.description || o.kpi ? `<section class="adm-card">${o.description ? `<h2>Описание</h2><p class="pre">${esc(o.description)}</p>` : ''}${o.kpi ? `<h2>KPI и правила</h2><p class="pre">${esc(o.kpi)}</p>` : ''}</section>` : ''}
      ${(o.creatives || []).length ? `<section class="adm-card"><h2>Креативы и материалы</h2><ul class="adm-list">${o.creatives.map((c) => `<li><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.name)}</a></li>`).join('')}</ul></section>` : ''}
      ${o.notes ? `<section class="adm-card"><h2>Заметки (видит только админ)</h2><p class="pre">${esc(o.notes)}</p></section>` : ''}
      <section class="adm-card"><h2>Интеграция</h2>
        <p class="adm-muted">Целевая ссылка рекламодателя:</p><code class="adm-block">${esc(o.target_url)}</code>
        <p class="adm-muted">Ссылка партнёра:</p><code class="adm-block">${esc(site)}/c/${esc(o.id)}/&lt;код партнёра&gt;?sub1=…&amp;sub2=…</code>
        <p class="adm-muted">Постбэк рекламодателя (для каждой цели — свой <code>goal</code>):</p>
        ${o.goals.map((g) => `<code class="adm-block">${esc(site)}/postback?key=КЛЮЧ&amp;click_id={click_id}&amp;goal=${esc(g.code)}&amp;status=approved&amp;txid={order_id}${g.payout_type === 'percent' || g.revenue_type === 'percent' ? '&amp;amount={sum}' : ''}</code>`).join('')}
        ${o.preview_url ? `<p><a class="btn" href="${esc(o.preview_url)}" target="_blank" rel="noopener noreferrer">Открыть превью лендинга</a></p>` : ''}</section>
      <section class="adm-card"><h2>Партнёры за период</h2>${d.partners.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Партнёр</th><th class="r">Клики</th><th class="r">Конв.</th><th class="r">CR</th><th class="r">Откл.</th><th class="r">Выплата</th><th class="r">Ожидает</th><th class="r">Прибыль</th></tr></thead><tbody>
        ${d.partners.map((p) => `<tr data-code="${esc(p.code)}"><td>${esc(p.name)}<span class="adm-sub">${esc(p.code)}</span></td><td class="r">${n(p.clicks)}</td><td class="r">${n(p.approved + p.pending)}</td><td class="r">${pct(p.approved + p.pending, p.clicks)}</td><td class="r">${n(p.rejected)}</td><td class="r"><b>${money(p.payout)}</b></td><td class="r">${money(p.pendingPayout)}</td><td class="r">${money(p.revenue - p.payout)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="adm-empty">Трафика за период нет.</p>'}</section>
      <section class="adm-card"><h2>По дням</h2>${d.daily.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Дата</th><th class="r">Клики</th><th class="r">Конв.</th><th class="r">Откл.</th><th class="r">Доход</th><th class="r">Выплаты</th></tr></thead><tbody>
        ${d.daily.map((x) => `<tr><td>${esc(x.day)}</td><td class="r">${n(x.clicks)}</td><td class="r">${n(x.approved + x.pending)}</td><td class="r">${n(x.rejected)}</td><td class="r">${money(x.revenue)}</td><td class="r">${money(x.payout)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="adm-empty">Нет данных.</p>'}</section>
      ${accessBlock(o, d.access)}`;
  }

  function accessBlock(o, rows) {
    const without = state.data ? state.data.partners.filter((p) => p.teliks && !rows.some((a) => a.user_id === p.teliks.uid && a.status === 'approved')) : [];
    return `<section class="adm-card"><h2>Доступ партнёров</h2>
      ${o.access === 'open' ? '<p class="adm-muted">Оффер открытый — ссылка есть у всех партнёров без заявки.</p>' : ''}
      ${rows.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Партнёр</th><th>Статус</th><th>Дата</th><th></th></tr></thead><tbody>
        ${rows.map((a) => `<tr><td>${esc(a.name)}<span class="adm-sub">${esc(a.code)}${a.email ? ' · ' + esc(a.email) : ''}</span></td><td>${pill({ approved: ['Одобрен', 'ok'], pending: ['Заявка', 'warn'], rejected: ['Отклонён', 'bad'] }[a.status])}</td><td>${esc(dt(a.decided_at || a.created_at))}</td>
          <td><div class="adm-actions">${a.status !== 'approved' ? `<button class="btn btn-primary" type="button" data-acc="${esc(o.id)}" data-uid="${esc(a.user_id)}" data-st="approved">Одобрить</button>` : ''}${a.status !== 'rejected' ? `<button class="btn btn-danger-soft" type="button" data-acc="${esc(o.id)}" data-uid="${esc(a.user_id)}" data-st="rejected">Закрыть доступ</button>` : ''}</div></td></tr>`).join('')}
      </tbody></table></div>` : (o.access === 'open' ? '' : '<p class="adm-empty">Пока никого.</p>')}
      ${o.access !== 'open' && without.length ? `<div class="adm-actions"><select class="input adm-search" id="grant-uid">${without.map((p) => `<option value="${esc(p.teliks.uid)}">${esc(p.name)} (${esc(p.code)})</option>`).join('')}</select><button class="btn" type="button" data-grant="${esc(o.id)}">Выдать доступ</button></div>` : ''}
    </section>`;
  }

  function creativeRow(c = {}) {
    return `<div class="adm-goalrow adm-crow" data-creative>
      <input class="input" data-c="name" placeholder="Название: Баннер 1080×1080" value="${esc(c.name || '')}" maxlength="80" aria-label="Название">
      <input class="input" data-c="url" placeholder="https://… (картинка, видео, папка с материалами)" value="${esc(c.url || '')}" maxlength="1000" aria-label="Ссылка">
      <button class="btn btn-icon" type="button" data-row-del aria-label="Удалить">✕</button></div>`;
  }

  // Editor: new offer, edit, or copy of an existing one.
  function openOfferForm(id, { copy = false } = {}) {
    const O = state.offers;
    const src = id ? O.rows.find((x) => x.id === id) : null;
    const o = copy ? null : src;
    const f = src ? { ...src, ...(copy ? { id: src.id.slice(0, 26) + '-copy', name: src.name + ' (копия)', status: 'paused' } : {}) }
      : { status: 'active', access: 'approval', model: 'CPA', goals: [{ code: 'lead', name: 'Заявка', payout_type: 'fixed', payout: '', revenue_type: 'fixed', revenue: '' }], geo: ['KZ'], categories: [], hold_days: 0, creatives: [], traffic_allowed: [], traffic_banned: [] };
    const opt = (list, v) => list.map(([k, t]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(t)}</option>`).join('');
    const TR = O.traffic || {};
    const trState = (k) => ((f.traffic_allowed || []).includes(k) ? 'allowed' : (f.traffic_banned || []).includes(k) ? 'banned' : '');
    openDrawer(`
      <h2 id="dr-title">${o ? 'Изменить оффер: ' + esc(o.name) : copy ? 'Копия оффера' : 'Новый оффер'}</h2>
      <form class="adm-form" id="offer-form" novalidate>
        <section class="adm-card"><h2>Основное</h2><div class="adm-fgrid">
          <label class="field"><span>ID (в ссылке партнёра)</span><input class="input input-mono" name="id" required pattern="[a-z0-9][a-z0-9_-]{1,31}" maxlength="32" value="${esc(f.id || '')}" ${o ? 'disabled' : ''} placeholder="kaspi-card"><small class="hint">${o ? 'ID не меняется — он в ссылках партнёров' : 'латиница, цифры, - и _'}</small></label>
          <label class="field"><span>Рекламодатель</span><select class="input" name="advertiser_id" required><option value="">—</option>${opt(O.advertisers.map((a) => [a.id, a.name + (a.status === 'paused' ? ' (пауза)' : '')]), f.advertiser_id)}</select></label>
          <label class="field adm-span2"><span>Название</span><input class="input" name="name" required maxlength="120" value="${esc(f.name || '')}" placeholder="Kaspi — кредитная карта"></label>
          <label class="field"><span>Статус</span><select class="input" name="status">${opt([['active', 'Активен'], ['paused', 'Пауза'], ['archived', 'Архив']], f.status)}</select></label>
          <label class="field"><span>Модель</span><select class="input" name="model">${opt([['CPA', 'CPA — за действие'], ['CPL', 'CPL — за заявку'], ['CPS', 'CPS — % от продажи'], ['CPI', 'CPI — за установку'], ['RevShare', 'RevShare — доля дохода']], f.model)}</select></label>
          <label class="field"><span>Доступ партнёров</span><select class="input" name="access">${opt([['approval', 'По заявке (одобряет админ)'], ['open', 'Открытый (всем сразу)'], ['private', 'Приватный (только выданным)']], f.access)}</select></label>
          <label class="field"><span>ГЕО (через запятую)</span><input class="input" name="geo" value="${esc((f.geo || []).join(', '))}" placeholder="KZ, UZ"></label>
          <label class="field adm-span2"><span>Категории (через запятую)</span><input class="input" name="categories" value="${esc((f.categories || []).join(', '))}" placeholder="Финансы, Банки"></label>
        </div></section>

        <section class="adm-card"><div class="adm-card-head"><h2>Цели и выплаты</h2><button class="btn" type="button" data-goal-add>+ Цель</button></div>
          <p class="adm-muted">«Партнёру» — сколько получает партнёр, «От рекламодателя» — сколько платит рекламодатель (доход сети). % считается от суммы <code>amount</code> из постбэка. Код цели рекламодатель передаёт в <code>goal=</code>.</p>
          <div id="goals">${(f.goals || []).map(goalRow).join('')}</div></section>

        <section class="adm-card"><h2>Условия</h2><div class="adm-fgrid">
          <label class="field"><span>Холд, дней</span><input class="input" name="hold_days" type="number" min="0" max="90" value="${esc(f.hold_days || 0)}"><small class="hint">после подтверждения рекламодателем</small></label>
          <label class="field"><span>Кап, конверсий в день</span><input class="input" name="daily_cap" type="number" min="1" value="${esc(f.daily_cap || '')}" placeholder="без лимита"></label>
          <label class="field"><span>Начало</span><input class="input" name="starts_on" type="date" value="${esc(f.starts_on ? String(f.starts_on).slice(0, 10) : '')}"></label>
          <label class="field"><span>Окончание</span><input class="input" name="ends_on" type="date" value="${esc(f.ends_on ? String(f.ends_on).slice(0, 10) : '')}"><small class="hint">пусто — бессрочно</small></label>
        </div>
          <h3 class="adm-h3">Источники трафика</h3>
          <div class="adm-traffic">${Object.entries(TR).map(([k, t]) => `<label class="adm-tr"><span>${esc(t)}</span><select class="input" data-tr="${esc(k)}">${opt([['', '—'], ['allowed', 'Разрешён'], ['banned', 'Запрещён']], trState(k))}</select></label>`).join('')}</div>
        </section>

        <section class="adm-card"><h2>Ссылки</h2><div class="adm-fgrid">
          <label class="field adm-span2"><span>Целевая ссылка рекламодателя</span><input class="input input-mono" name="target_url" required value="${esc(f.target_url || '')}" placeholder="https://advertiser.kz/land?click_id={click_id}&aff={aff_id}&sub1={sub1}"><small class="hint">Макросы: ${esc(MACROS)}</small></label>
          <label class="field"><span>Превью (лендинг для партнёров)</span><input class="input" name="preview_url" value="${esc(f.preview_url || '')}" placeholder="https://"></label>
          <label class="field"><span>Логотип (https)</span><input class="input" name="logo_url" value="${esc(f.logo_url || '')}" placeholder="https://…/logo.png"></label>
        </div></section>

        <section class="adm-card"><h2>Описание для партнёров</h2><div class="adm-fgrid">
          <label class="field adm-span2"><span>Описание</span><textarea class="input" name="description" rows="4" maxlength="5000" placeholder="Что за продукт, кто целевая аудитория, что должен сделать клиент">${esc(f.description || '')}</textarea></label>
          <label class="field adm-span2"><span>KPI и правила трафика</span><textarea class="input" name="kpi" rows="3" maxlength="3000" placeholder="Например: клиент 18+, одобрение заявки, запрещён фрод">${esc(f.kpi || '')}</textarea></label>
        </div></section>

        <section class="adm-card"><div class="adm-card-head"><h2>Креативы и материалы</h2><button class="btn" type="button" data-creative-add>+ Материал</button></div>
          <p class="adm-muted">Ссылки на баннеры, видео, тексты (https). Партнёры видят их в карточке оффера.</p>
          <div id="creatives">${(f.creatives || []).map(creativeRow).join('')}</div></section>

        <section class="adm-card"><h2>Заметки</h2>
          <label class="field"><span>Видит только админ: контакты менеджера, условия договора, ставки</span><textarea class="input" name="notes" rows="3" maxlength="2000">${esc(f.notes || '')}</textarea></label></section>

        <p class="error" id="form-err" role="alert"></p>
        <div class="adm-actions adm-sticky"><button class="btn btn-primary" type="submit">${o ? 'Сохранить изменения' : 'Создать оффер'}</button>${o ? `<button class="btn" type="button" data-ofa="open" data-id="${esc(o.id)}">Отмена</button>` : `<button class="btn" type="button" data-close>Отмена</button>`}</div>
      </form>`);
    const form = $('#offer-form');
    $('[data-goal-add]').onclick = () => $('#goals').insertAdjacentHTML('beforeend', goalRow({}));
    $('[data-creative-add]').onclick = () => $('#creatives').insertAdjacentHTML('beforeend', creativeRow({}));
    $('#goals').onclick = (e) => { const b = e.target.closest('[data-goal-del]'); if (b) b.closest('[data-goal]').remove(); };
    $('#creatives').onclick = (e) => { const b = e.target.closest('[data-row-del]'); if (b) b.closest('[data-creative]').remove(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(form).entries());
      body.goals = $$('[data-goal]', form).map((r) => Object.fromEntries($$('[data-g]', r).map((i) => [i.dataset.g, i.value])));
      body.creatives = $$('[data-creative]', form).map((r) => Object.fromEntries($$('[data-c]', r).map((i) => [i.dataset.c, i.value.trim()]))).filter((c) => c.url);
      body.traffic_allowed = $$('[data-tr]', form).filter((s) => s.value === 'allowed').map((s) => s.dataset.tr);
      body.traffic_banned = $$('[data-tr]', form).filter((s) => s.value === 'banned').map((s) => s.dataset.tr);
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true; $('#form-err').textContent = '';
      try {
        const r = await api(o ? '/api/admin/offers/' + encodeURIComponent(o.id) : '/api/admin/offers', { method: 'POST', body });
        await load();
        openOfferCard(r.offer.id);
      } catch (err) { $('#form-err').textContent = err.message; btn.disabled = false; }
    };
  }

  function goalRow(g = {}) {
    return `<div class="adm-goalrow" data-goal>
      <input class="input" data-g="code" placeholder="код: lead" value="${esc(g.code || '')}" maxlength="32" aria-label="Код цели">
      <input class="input" data-g="name" placeholder="Название: Заявка" value="${esc(g.name || '')}" maxlength="60" aria-label="Название цели">
      <label class="adm-mini">Партнёру<span><input class="input" data-g="payout" type="number" min="0" step="0.01" value="${esc(g.payout ?? '')}"><select class="input" data-g="payout_type"><option value="fixed"${g.payout_type !== 'percent' ? ' selected' : ''}>₸</option><option value="percent"${g.payout_type === 'percent' ? ' selected' : ''}>%</option></select></span></label>
      <label class="adm-mini">От рекламодателя<span><input class="input" data-g="revenue" type="number" min="0" step="0.01" value="${esc(g.revenue ?? '')}"><select class="input" data-g="revenue_type"><option value="fixed"${g.revenue_type !== 'percent' ? ' selected' : ''}>₸</option><option value="percent"${g.revenue_type === 'percent' ? ' selected' : ''}>%</option></select></span></label>
      <button class="btn btn-icon" type="button" data-goal-del aria-label="Удалить цель">✕</button>
    </div>`;
  }

  function openBuiltin() {
    const b = (state.offers.builtin || [])[0];
    if (!b) return;
    const s = b.stats;
    openDrawer(`
      <h2 id="dr-title">${esc(b.name)} <span class="adm-muted">встроенный оффер</span></h2>
      <dl class="adm-kv">
        <dt>Рекламодатель</dt><dd>TrendMe (trendme.kz, @Trendmekzbot)</dd>
        <dt>Модель</dt><dd>RevShare: партнёр получает % от каждой оплаты привлечённого клиента (пожизненно, первый переход)</dd>
        <dt>% партнёров</dt><dd>${b.percentMin == null ? '—' : b.percentMin === b.percentMax ? esc(b.percentMin) + '%' : esc(b.percentMin) + '–' + esc(b.percentMax) + '%'} · меняется в админке TrendMe → Партнёры</dd>
        <dt>Доступ</dt><dd>Все партнёры Teliks, подключается автоматически при регистрации</dd>
        <dt>Холд</dt><dd>Нет. Возврат оплаты в TrendMe отменяет начисление</dd>
        <dt>Учёт</dt><dd>Переходы, клиенты, оплаты и начисления считает TrendMe и передаёт в Teliks по API — постбэк не нужен</dd>
      </dl>
      <div class="adm-links">${Object.entries(b.links).map(([k, v]) => `<div class="adm-link"><span class="adm-muted">${{ bot: 'Бот', app: 'Mini App', site: 'Сайт' }[k]}</span><code>${esc(v)}</code></div>`).join('')}</div>
      ${b.unavailable ? '<p class="adm-muted">TrendMe сейчас просыпается — цифры появятся через минуту.</p>' : `<dl class="adm-kpis">${kpi('Переходы', n(s.clicks))}${kpi('Клиенты', n(s.users))}${kpi('Оплаты', n(s.conversions), 'CR ' + pct(s.conversions, s.users))}${kpi('Оборот', money(s.revenue))}${kpi('Начислено партнёрам', money(s.payout), '', 'is-gold')}${kpi('Доход сети', money(s.revenue - s.payout))}</dl>`}
      <p class="adm-muted">Статистика по партнёрам — во вкладке «Партнёры», по оплатам — «Конверсии → TrendMe».</p>`);
  }
  /* ───── advertisers ───── */
  function advertisersView() {
    const A = state.advs;
    if (!A) return '<p class="adm-muted">Загрузка…</p>';
    const L = state.pbLog;
    const ST = new Map(advStats().map((g) => [g.id, g]));
    return `
      ${state.newKey ? `<section class="adm-card adm-attn"><h2>Ключ API рекламодателя «${esc(state.newKey.name)}»</h2>
        <p class="adm-muted">Скопируйте и передайте рекламодателю — ключ показывается только один раз. Хранится у нас только его хэш.</p>
        <div class="adm-link"><code>${esc(state.newKey.key)}</code><button class="btn" type="button" data-copy="${esc(state.newKey.key)}">Копировать</button></div>
        <p class="adm-muted">Постбэк: <code class="adm-code">${esc(A.postbackUrl)}?key=${esc(state.newKey.key)}&click_id={click_id}&goal=lead&status=approved&txid={order_id}&amount={sum}</code></p>
        <div class="adm-actions"><button class="btn" type="button" data-key-hide>Я сохранил ключ</button></div></section>` : ''}
      <section class="adm-card">
        <div class="adm-card-head"><h2>Рекламодатели (${A.rows.length})</h2><div class="adm-actions"><a class="btn" href="/docs.html" target="_blank" rel="noopener">Документация API</a><button class="btn btn-primary" type="button" data-adv-new>+ Рекламодатель</button></div></div>
        <p class="adm-muted">Постбэк: <code class="adm-code">${esc(A.postbackUrl)}</code> · API: <code class="adm-code">${esc(A.apiUrl)}</code></p>
        ${A.rows.length ? `<div class="table-scroll"><table class="adm-table"><thead><tr><th>Рекламодатель</th><th>Контакты</th><th>Офферы</th><th class="r">Клики</th><th class="r">Конв.</th><th class="r">Доход</th><th class="r">Выплаты</th><th class="r">Прибыль</th><th>Ключ</th><th>Статус</th></tr></thead><tbody>
          ${A.rows.map((a) => { const g = ST.get(a.id) || {}; return `<tr><td>${esc(a.name)}<span class="adm-sub">${esc(a.company || '')}${a.website ? ' · ' + esc(a.website) : ''}</span><div class="adm-actions adm-row-actions"><button class="btn" type="button" data-adv-edit="${esc(a.id)}">Изменить</button>${a.integration ? '' : `<button class="btn" type="button" data-adv-key="${esc(a.id)}">Новый ключ</button><button class="btn" type="button" data-adv-st="${esc(a.id)}">${a.status === 'active' ? 'Пауза' : 'Запустить'}</button><button class="btn btn-danger-soft" type="button" data-adv-del="${esc(a.id)}">Удалить</button>`}</div></td>
            <td>${esc(a.email || '—')}<span class="adm-sub">${esc(a.telegram || '')}</span></td>
            <td>${a.offers.length ? a.offers.map((o) => `<span class="adm-goal">${esc(o.name)} ${o.builtin ? pill(['Встроенный', 'ok']) : pill(OSTAT[o.status])}</span>`).join('') : '—'}</td>
            <td class="r">${n(g.clicks)}</td><td class="r">${n(g.conv)}${g.pendingIncome ? '' : ''}</td><td class="r">${money(g.income)}</td><td class="r">${money(g.payout)}</td><td class="r"><b>${money((g.income || 0) - (g.payout || 0))}</b></td>
            <td>${a.integration ? '<span class="adm-sub">интеграция по API</span>' : `<code class="adm-code">${esc(a.keyPrefix ? a.keyPrefix + '…' : '—')}</code>`}</td><td>${pill(a.status === 'active' ? ['Активен', 'ok'] : ['Пауза', 'warn'])}</td>
</tr>`; }).join('')}
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
    $('#view').innerHTML = { overview, partners, payouts, conversions, offers: offersView, advertisers: advertisersView, reports: reportsView }[state.tab](d);
    $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
    const q = $('#q');
    if (q) q.oninput = () => { state.q = q.value; const pos = q.selectionStart; render(); const q2 = $('#q'); q2.focus(); q2.setSelectionRange(pos, pos); };
    const cc = $('#conv-code');
    if (cc) cc.onchange = () => { state.convCode = cc.value; render(); };
    const ro = $('#rep-offer'), rc = $('#rep-code');
    if (ro) ro.onchange = () => { state.rep.offer = ro.value; loadRep(); };
    if (rc) rc.onchange = () => { state.rep.code = rc.value; loadRep(); };
    const oq = $('#of-q');
    if (oq) oq.oninput = () => { state.of.q = oq.value; const pos = oq.selectionStart; render(); const o2 = $('#of-q'); o2.focus(); o2.setSelectionRange(pos, pos); };
    const oa = $('#of-adv');
    if (oa) oa.onchange = () => { state.of.adv = oa.value; render(); };
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
      if (state.tab === 'conversions') loadCC();
      if (state.tab === 'reports') loadRep();
      if (state.tab === 'advertisers') loadLog();
      $('#updated').textContent = 'Обновлено ' + new Date().toLocaleTimeString('ru-RU', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' });
      render();
      if (d.trendmeUnavailable) $('#err').textContent = 'TrendMe сейчас просыпается (бесплатный тариф Render) — его цифры не показаны. Обновите страницу через минуту.';
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
    const el = e.target.closest('button, tr[data-code], tr[data-offer], tr[data-builtin], [data-close]');
    if (!el) return;
    if (el.matches('[data-close]')) return closeDrawer();
    if (el.matches('tr[data-code]')) return openPartner(el.dataset.code);
    if (el.matches('tr[data-offer]')) return openOfferCard(el.dataset.offer);
    if (el.matches('tr[data-builtin]')) return openBuiltin();
    const b = el;
    $('#err').textContent = '';
    if (b.dataset.tab) {
      state.tab = b.dataset.tab;
      render();
      if (state.tab === 'conversions' && !state.ccData) loadCC();
      if (state.tab === 'reports' && !state.repData) loadRep();
      if (state.tab === 'advertisers') loadLog();
      return;
    }
    if ('offerNew' in b.dataset) return openOfferForm(null);
    if ('ofStatus' in b.dataset) { state.of.status = b.dataset.ofStatus; return render(); }
    if (b.dataset.repGroup) { state.rep.group = b.dataset.repGroup; return loadRep(); }
    if ('repSource' in b.dataset) { state.rep.source = b.dataset.repSource; return loadRep(); }
    if (b.dataset.ofa === 'open') return openOfferCard(b.dataset.id);
    if (b.dataset.ofa === 'edit') return openOfferForm(b.dataset.id);
    if (b.dataset.ofa === 'copy') return openOfferForm(b.dataset.id, { copy: true });
    if ('advNew' in b.dataset) return openAdvForm(null);
    if (b.dataset.advEdit) return openAdvForm(b.dataset.advEdit);
    if ('keyHide' in b.dataset) { state.newKey = null; return render(); }
    if (b.dataset.convSrc) { state.convSrc = b.dataset.convSrc; render(); if (state.convSrc === 'cpa') loadCC(); return; }
    if ('ccStatus' in b.dataset) { state.cc.status = b.dataset.ccStatus; state.cc.page = 1; return loadCC(); }
    if ('ccSource' in b.dataset) { state.cc.source = b.dataset.ccSource; state.cc.page = 1; return loadCC(); }
    if (b.dataset.ccPage) { state.cc.page = Number(b.dataset.ccPage); return loadCC(); }
    if (b.dataset.days) return setDays(Number(b.dataset.days));
    if (b.dataset.sort) { const k = b.dataset.sort; state.sort = [k, state.sort[0] === k ? -state.sort[1] : k === 'name' ? 1 : -1]; return render(); }
    if ('payStatus' in b.dataset) { state.payStatus = b.dataset.payStatus; return render(); }
    if ('convStatus' in b.dataset) { state.convStatus = b.dataset.convStatus; return render(); }
    if (b.dataset.copy) { try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = '✓'; } catch { /* ignore */ } return; }
    try {
      if (b.dataset.pay || b.dataset.reject) {
        return b.dataset.pay ? openPayCheck(b.dataset.pay) : openReject(b.dataset.reject);
      } else if (['active', 'paused', 'archived'].includes(b.dataset.ofa)) {
        const msg = { active: 'Запустить оффер? Партнёрские ссылки снова начнут вести на лендинг.', paused: 'Поставить оффер на паузу? Ссылки партнёров перестанут работать (будут вести на превью), постбэки по старым кликам принимаются.', archived: 'Перенести оффер в архив? Он пропадёт из каталога партнёров, статистика сохранится.' }[b.dataset.ofa];
        if (!window.confirm(msg)) return;
        b.disabled = true;
        await api(`/api/admin/offers/${encodeURIComponent(b.dataset.id)}/status`, { method: 'POST', body: { status: b.dataset.ofa } });
        await load();
        if (!$('#drawer').hidden) openOfferCard(b.dataset.id);
      } else if (b.dataset.ofa === 'delete') {
        const typed = window.prompt(`Удалить оффер навсегда? Клики и доступы партнёров удалятся. Удалить можно только оффер без конверсий.\n\nВведите ID оффера для подтверждения: ${b.dataset.id}`);
        if (typed === null) return;
        b.disabled = true;
        await api(`/api/admin/offers/${encodeURIComponent(b.dataset.id)}/delete`, { method: 'POST', body: { confirm: typed.trim() } });
        closeDrawer();
        await load();
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
        if (!$('#drawer').hidden && $('#dr-title')) openOfferCard(body.offer_id);
      } else if (b.dataset.advSt) {
        const a = state.advs.rows.find((x) => x.id === b.dataset.advSt);
        const next = a.status === 'active' ? 'paused' : 'active';
        if (!window.confirm(next === 'paused' ? `Поставить «${a.name}» на паузу? Его постбэки и API перестанут приниматься.` : `Запустить «${a.name}»?`)) return;
        b.disabled = true;
        await api('/api/admin/advertisers/' + a.id, { method: 'POST', body: { name: a.name, company: a.company || '', email: a.email || '', telegram: a.telegram || '', website: a.website || '', notes: a.notes || '', status: next } });
        await load();
      } else if (b.dataset.advDel) {
        const a = state.advs.rows.find((x) => x.id === b.dataset.advDel);
        if (!window.confirm(`Удалить рекламодателя «${a.name}»? Удалить можно только рекламодателя без офферов.`)) return;
        b.disabled = true;
        await api(`/api/admin/advertisers/${a.id}/delete`, { method: 'POST' });
        await load();
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
