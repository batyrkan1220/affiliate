'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (n) => new Intl.NumberFormat('ru-RU').format(n || 0) + ' ₸';
  const date = (s) => (s ? new Date(s).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty', dateStyle: 'short', timeStyle: 'short' }) : '—');
  const STATUS = { processing: 'в обработке', paid: 'выплачено', rejected: 'отклонено' };
  let status = 'processing';
  let data = null;

  async function api(path, opts = {}) {
    const r = await fetch(path, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
    if (r.status === 401) { location.href = '/'; throw new Error('unauthorized'); }
    if (r.status === 403) { $('#err').textContent = 'Нет прав администратора.'; throw new Error('forbidden'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || j.error || 'error');
    return j;
  }

  function render() {
    const rows = data.requests.filter((r) => r.status === status);
    $('#req').innerHTML = rows.length ? `<thead><tr><th>Дата</th><th>Партнёр</th><th>Код</th><th>Сумма</th><th>Реквизиты</th><th>Статус</th><th></th></tr></thead><tbody>${rows.map((r) => `
      <tr><td>${esc(date(r.createdAt))}</td><td>${esc(r.name)}<br><span class="adm-muted">${esc(r.email)}</span></td><td>${esc(r.code)}</td>
      <td class="num">${money(r.amount)}</td><td>${esc(r.method)} ${esc(r.details)}</td><td>${esc(STATUS[r.status] || r.status)}${r.processedAt ? `<br><span class="adm-muted">${esc(date(r.processedAt))}</span>` : ''}</td>
      <td>${r.status === 'processing' ? `<div class="adm-actions"><button class="btn btn-primary" data-pay="${esc(r.id)}">Выплачено</button><button class="btn btn-danger-soft" data-reject="${esc(r.id)}">Отклонить</button></div>` : ''}</td></tr>`).join('')}</tbody>`
      : `<tbody><tr><td class="adm-empty">Заявок нет.</td></tr></tbody>`;
    $('#partners').innerHTML = `<thead><tr><th>Партнёр</th><th>Код</th><th>Реквизиты</th><th>С</th><th>Доступ</th></tr></thead><tbody>${data.partners.map((p) => `
      <tr><td>${esc(p.name)}${p.admin ? ' <span class="badge q-good">админ</span>' : ''}<br><span class="adm-muted">${esc(p.email)}</span></td><td>${esc(p.code)}</td><td>${esc(p.payout || '—')}</td><td>${esc(date(p.createdAt))}</td>
      <td>${p.admin ? '' : `<button class="btn ${p.active ? '' : 'btn-primary'}" data-toggle="${esc(p.uid)}" data-active="${p.active ? '0' : '1'}">${p.active ? 'Заблокировать' : 'Разблокировать'}</button>`}</td></tr>`).join('')}</tbody>`;
  }

  async function load() { data = await api('/api/admin/overview'); render(); }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $('#err').textContent = '';
    try {
      if (b.dataset.status) {
        status = b.dataset.status;
        document.querySelectorAll('[data-status]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        render();
      } else if (b.dataset.pay || b.dataset.reject) {
        const id = b.dataset.pay || b.dataset.reject;
        const r = data.requests.find((x) => x.id === id);
        const msg = b.dataset.pay ? `Подтвердить выплату ${money(r.amount)} партнёру ${r.name}?` : `Отклонить заявку на ${money(r.amount)}?`;
        if (!window.confirm(msg)) return;
        b.disabled = true;
        await api('/api/admin/requests/' + id, { method: 'POST', body: { action: b.dataset.pay ? 'paid' : 'rejected' } });
        await load();
      } else if (b.dataset.toggle) {
        b.disabled = true;
        await api('/api/admin/partners/' + b.dataset.toggle, { method: 'POST', body: { active: b.dataset.active === '1' } });
        await load();
      }
    } catch (err) {
      $('#err').textContent = err.message === 'upstream_unavailable' || err.message === 'upstream_error' ? 'TrendMe не ответил — выплата не отмечена. Повторите.' : 'Не удалось: ' + err.message;
      b.disabled = false;
    }
  });

  load().catch(() => {});
})();
