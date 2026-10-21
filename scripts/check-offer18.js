'use strict';
/**
 * Sanity check for your Offer18 network credentials.
 *   npm run check:offer18
 * Prints what Offer18 actually returns (secrets are never printed) so you can verify
 * field names and the registration/login body format before going live.
 */
process.env.DEMO = '0';
const cfg = require('../lib/config');
const api = require('../lib/offer18');

const iso = (d) => d.toISOString().slice(0, 10);

(async () => {
  console.log('Base URL:', cfg.o18.base, '| MID:', cfg.o18.mid, '| body format:', cfg.o18.bodyFormat);

  const offers = await api.listOffers({ page: 1, limit: 5 });
  const ids = Object.keys(offers);
  console.log(`\nOffers API OK — ${ids.length} offer(s) on page 1`);
  if (ids[0]) {
    const o = offers[ids[0]];
    console.log('Sample offer keys:', Object.keys(o).join(', '));
    console.log('Has "affiliates" map (needed for tracking links):', Boolean(o.affiliates));
  }

  const to = new Date();
  const from = new Date(Date.now() - 6 * 86400000);
  const aid = process.argv[2];
  if (!aid) {
    console.log('\nTip: pass an affiliate id to test reports:  npm run check:offer18 -- 1234');
    return;
  }
  const rep = await api.getReport({
    affiliate: aid, date_from: iso(from), date_end: iso(to), timezone: cfg.reportTz, results: 5, page: 0,
  });
  console.log(`\nReports API OK — ${rep.records.length} row(s) returned for affiliate ${aid}`);
  if (rep.records[0]) console.log('Sample row keys:', Object.keys(rep.records[0]).join(', '));
})().catch((e) => {
  console.error('\nFAILED:', e.message, e.code || '');
  process.exit(1);
});
