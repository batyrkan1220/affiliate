'use strict';
/**
 * Заявки вебмастеров на офферы (для админа).
 *   npm run requests              список ожидающих заявок, сгруппированных по офферам
 *   npm run requests -- --done ID отметить заявку выполненной (достаточно первых символов ID)
 *   npm run requests -- --all     показать и выполненные
 */
const requests = require('../lib/requests');

(async () => {
  const args = process.argv.slice(2);
  const di = args.indexOf('--done');
  if (di !== -1) {
    const r = await requests.markDone(String(args[di + 1] || ''));
    console.log(r ? `Готово: вебмастер ${r.affiliateId} → оффер ${r.offerId}` : 'Заявка не найдена');
    return;
  }
  const rows = requests.list(args.includes('--all') ? '' : 'pending');
  if (!rows.length) { console.log('Заявок нет.'); return; }
  const byOffer = new Map();
  for (const r of rows) {
    if (!byOffer.has(r.offerId)) byOffer.set(r.offerId, []);
    byOffer.get(r.offerId).push(r);
  }
  for (const [offerId, list] of byOffer) {
    console.log(`\nОффер ${offerId} ${list[0].offerName}`);
    for (const r of list) {
      console.log(`  вебмастер ${String(r.affiliateId).padEnd(8)} ${String(r.email).padEnd(32)} ${r.createdAt.slice(0, 16).replace('T', ' ')}  [${r.status}]  id ${r.id.slice(0, 8)}`);
    }
  }
  console.log('\nНазначьте вебмастера на оффер в панели Offer18 (Offer → Assign Affiliates), затем: npm run requests -- --done <id>');
})();
