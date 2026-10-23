'use strict';
/**
 * The partner's offer: TrendMe (AI trend videos). One offer, always connected, with the
 * partner's personal Telegram bot link as the tracking link.
 */
const trendme = require('./trendme');

const today = () => new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);

async function forAffiliateList(code) {
  const d = today();
  const s = await trendme.summary(code, d, d);
  const p = s.partner || {};
  const links = s.links || {};
  const extra = [links.app && `Mini App: ${links.app}`, links.site && `Сайт: ${links.site}`].filter(Boolean).join('\n');
  return [{
    id: 'trendme',
    name: 'TrendMe — AI тренд-видео',
    logo: '',
    categories: ['AI video', 'Telegram'],
    currency: '%',
    price: Number(p.percent) || 0,
    model: 'RevShare',
    access: 'approved',
    start: '', end: '',
    previewUrl: links.site ? links.site.split('?')[0] : 'https://trendme.kz',
    description:
      `Клиент открывает бот по вашей ссылке, делает видео со своим лицом и оплачивает через Kaspi.\n` +
      `Вы получаете ${Number(p.percent) || 0}% с каждой его оплаты — не только первой. Клиент закрепляется за вами навсегда.\n` +
      (extra ? `\nДругие ссылки:\n${extra}` : ''),
    kpi: 'Только мотивированный трафик. Запрещены спам, мотивация «за деньги», вводящие в заблуждение обещания.',
    geo: { allow: ['KZ'], block: [] },
    os: [], device: [], browser: [],
    payouts: [{ price: Number(p.percent) || 0, model: 'RevShare', currency: '%', conditions: [] }],
    caps: [],
    events: [{ name: 'sale', token: 'sale' }],
    creatives: [],
    trackingUrl: links.bot || links.site || '',
    impressionUrl: '',
  }];
}

function bust() {}

module.exports = { forAffiliateList, bust };
