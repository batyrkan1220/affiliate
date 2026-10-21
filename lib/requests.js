'use strict';
/**
 * Заявки вебмастеров на доступ к офферам.
 * Запрос оффера через Offer18 требует личный API-ключ вебмастера, а вебмастера ключи не вводят.
 * Поэтому заявка сохраняется локально, админ видит её командой `npm run requests`
 * и назначает вебмастера на оффер в панели Offer18.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.REQUESTS_FILE || path.join(__dirname, '..', 'data', 'access-requests.json');

let items = null;
let chain = Promise.resolve();

function load() {
  if (items) return items;
  try {
    items = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!Array.isArray(items)) items = [];
  } catch {
    items = [];
  }
  return items;
}

function persist() {
  const data = JSON.stringify(items, null, 2);
  chain = chain.then(async () => {
    await fs.promises.mkdir(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.' + process.pid + '.tmp';
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, FILE);
  }).catch((e) => console.error('[requests] save failed:', e.message));
  return chain;
}

const same = (a, b) => String(a) === String(b);

function has(affiliateId, offerId) {
  return load().some((r) => r.status === 'pending' && same(r.affiliateId, affiliateId) && same(r.offerId, offerId));
}

async function add({ affiliateId, email, offerId, offerName }) {
  if (has(affiliateId, offerId)) return false;
  load().push({
    id: crypto.randomUUID(),
    affiliateId,
    email,
    offerId: String(offerId),
    offerName: offerName || '',
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  await persist();
  return true;
}

function list(status = 'pending') {
  return load().filter((r) => !status || r.status === status);
}

async function markDone(id) {
  const r = load().find((x) => x.id === id || x.id.startsWith(id));
  if (!r) return null;
  r.status = 'done';
  r.doneAt = new Date().toISOString();
  await persist();
  return r;
}

module.exports = { has, add, list, markDone, FILE };
