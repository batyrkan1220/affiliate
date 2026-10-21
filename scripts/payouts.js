'use strict';
/**
 * Запросы вебмастеров на выплату (для админа).
 *   npm run payouts                 список ожидающих запросов
 *   npm run payouts -- --paid ID    отметить выплаченным (достаточно первых символов ID)
 *   npm run payouts -- --reject ID  отклонить (сумма вернётся на баланс вебмастера)
 *   npm run payouts -- --all        показать все
 */
const payouts = require('../lib/payouts');

(async () => {
  const args = process.argv.slice(2);
  for (const [flag, status, text] of [['--paid', 'paid', 'Выплачено'], ['--reject', 'rejected', 'Отклонено']]) {
    const i = args.indexOf(flag);
    if (i === -1) continue;
    const p = await payouts.mark(String(args[i + 1] || ''), status);
    console.log(p ? `${text}: вебмастер ${p.affiliateId}, ${p.amount}` : 'Запрос не найден или уже обработан');
    return;
  }
  const rows = payouts.listAll(args.includes('--all') ? '' : 'pending');
  if (!rows.length) { console.log('Запросов нет.'); return; }
  for (const p of rows) {
    console.log(`${p.createdAt.slice(0, 16).replace('T', ' ')}  вебмастер ${String(p.affiliateId).padEnd(6)} ${String(p.email).padEnd(28)} ${String(p.amount).padStart(9)}  ${p.method}: ${p.details}  [${p.status}]  id ${p.id.slice(0, 8)}`);
  }
  console.log('\nПереведите деньги по реквизитам, затем: npm run payouts -- --paid <id>');
})();
