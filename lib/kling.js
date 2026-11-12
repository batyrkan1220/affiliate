'use strict';
/**
 * Раздел «Товары»: три агента Kling AI (Solution APIs).
 * Поля, значения и ограничения повторяют документацию Kling один к одному:
 *   https://kling.ai/document-api/api/ecommerce-replication/{video-commerce,goods-studio,apparel}
 * Ключ Agent Market (KLING_API_KEY) хранится только на сервере. Вебмастер его не видит и не вводит.
 * Расходы идут с баланса Kling владельца платформы, поэтому есть суточный лимит на вебмастера.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ApiError } = require('./errors');

const BASE = (process.env.KLING_BASE || 'https://api-singapore.klingai.com').replace(/\/+$/, '');
const KEY = process.env.KLING_API_KEY || '';
const DAILY = Math.max(1, Number(process.env.GOODS_DAILY_LIMIT) || 3);
const FILE = process.env.GOODS_FILE || path.join(__dirname, '..', 'data', 'goods.json');

const AVATARS = ['avatar_eva_female', 'avatar_oliver_male', 'avatar_elena_female', 'avatar_adam_male', 'avatar_anna_female', 'avatar_rajput_male', 'avatar_mia_female', 'avatar_river_male', 'avatar_marcus_male', 'avatar_vivian_female', 'avatar_lee_male', 'avatar_toto_cartoon'];
const VOICES_TALK = ['male_calm_informative', 'female_clear_rational', 'female_gentle_soothing', 'female_bright_engaging', 'male_crisp_persuasive', 'female_intelligent_narrative', 'male_clear_professional', 'male_energetic_sporty', 'female_warm_rich'];
const VOICES_APPAREL = ['energetic_sales_girl', 'gentle_sales_woman', 'crisp_sales_girl', 'mature_sales_woman', 'calm_sales_woman', 'soft_sales_woman', 'energetic_sales_boy', 'enthusiastic_sales_man', 'steady_sales_man', 'calm_sales_man'];
const MAX_IMG_BYTES = 6 * 1024 * 1024; // наш предел на загрузку (у Kling до 50 МБ)

const TOOLS = {
  talking_agent: { path: '/solutions/talking_agent' },
  goods_studio: { path: '/solutions/e-commerce/goods_studio' },
  clothing_dupe: { path: '/solutions/e-commerce/clothing_dupe' },
};

/* ───────── хранилище задач ───────── */
let db = null;
let chain = Promise.resolve();
function load() {
  if (db) return db;
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { db = null; }
  if (!db || !Array.isArray(db.tasks)) db = { tasks: [] };
  return db;
}
function persist() {
  const data = JSON.stringify(db, null, 2);
  chain = chain.then(async () => {
    await fs.promises.mkdir(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.' + process.pid + '.tmp';
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, FILE);
  }).catch((e) => console.error('[goods] save failed:', e.message));
  return chain;
}
const same = (a, b) => String(a) === String(b);
const mine = (aid) => load().tasks.filter((t) => same(t.affiliateId, aid)).sort((a, b) => b.createdAt - a.createdAt);
const usedToday = (aid) => mine(aid).filter((t) => t.createdAt > Date.now() - 86400000).length;

/* ───────── проверка входных данных (правила Kling) ───────── */
const bad = (msg) => new ApiError(msg, 400, 'goods_invalid');
const str = (v, max, name, required) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) { if (required) throw bad(`${name} is required`); return ''; }
  if ([...s].length > max) throw bad(`${name} exceeds ${max} characters`);
  return s;
};
const oneOf = (v, list, name, def) => {
  const x = v === undefined || v === '' || v === null ? def : v;
  if (!list.includes(x)) throw bad(`${name} is invalid`);
  return x;
};
const strList = (v, max, maxLen, name) => {
  const arr = (Array.isArray(v) ? v : []).map((x) => String(x || '').trim()).filter(Boolean);
  if (arr.length > max) throw bad(`${name}: at most ${max} items`);
  arr.forEach((x) => { if ([...x].length > maxLen) throw bad(`${name}: item exceeds ${maxLen} characters`); });
  return arr;
};
// Картинка приходит как data:image/...;base64,... (до 6 МБ; фронт заранее уменьшает снимок)
function image(v, name) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(v || ''));
  if (!m) throw bad(`${name}: only jpg, png or webp images`);
  if (Math.floor((m[2].length * 3) / 4) > MAX_IMG_BYTES) throw bad(`${name}: image is too large`);
  return m[2]; // Kling принимает чистый base64 в поле url
}
const images = (v, min, max, name) => {
  const arr = Array.isArray(v) ? v : [];
  if (arr.length < min) throw bad(`${name}: at least ${min} required`);
  if (arr.length > max) throw bad(`${name}: at most ${max} allowed`);
  return arr.map((x) => image(x, name));
};
function httpUrl(v, name, exts, required) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) { if (required) throw bad(`${name} is required`); return ''; }
  let u;
  try { u = new URL(s); } catch { throw bad(`${name}: invalid link`); }
  if (u.protocol !== 'https:' || s.length > 1024) throw bad(`${name}: https link required`);
  if (exts && !exts.some((e) => u.pathname.toLowerCase().endsWith(e))) throw bad(`${name}: unsupported format`);
  return s;
}

function buildTalking(b) {
  const contents = [];
  const hasId = !!b.avatarId;
  const hasImg = !!b.avatarImage;
  if (hasId === hasImg) throw bad('Exactly one avatar source is required');
  const settings = {
    resolution: oneOf(b.resolution, ['720p', '1080p'], 'resolution', '720p'),
    aspect_ratio: oneOf(b.aspectRatio, ['9:16', '16:9'], 'aspect_ratio', '9:16'),
    allow_polish: !!b.allowPolish,
    bgm_enabled: !!b.bgm,
  };
  if (hasId) contents.push({ type: 'avatar_id', text: oneOf(b.avatarId, AVATARS, 'avatar', '') });
  else {
    contents.push({ type: 'avatar_image', url: image(b.avatarImage, 'avatar') });
    settings.voice_id = oneOf(b.voiceId, VOICES_TALK, 'voice', ''); // обязателен вместе с avatar_image
  }
  const refs = images(b.productImages, 0, 5, 'product image');
  const title = str(b.goodsTitle, 500, 'goods_title', false);
  const price = str(b.goodsPrice, 256, 'goods_price', false);
  const audience = strList(b.audience, 20, 200, 'goods_target_audience');
  const points = strList(b.sellingPoints, 20, 500, 'goods_selling_point');
  const product = refs.length || title || price || audience.length || points.length;
  if (product) {
    if (!refs.length) throw bad('Product image is missing');
    if (!title) throw bad('goods_title is required when product content is provided');
    refs.forEach((u) => contents.push({ type: 'ref_image', url: u }));
    contents.push({ type: 'goods_title', text: title });
    if (price) contents.push({ type: 'goods_price', text: price });
    audience.forEach((x) => contents.push({ type: 'goods_target_audience', text: x }));
    points.forEach((x) => contents.push({ type: 'goods_selling_point', text: x }));
  } else if (b.speechRate !== undefined && b.speechRate !== '') {
    settings.speech_rate = Number(oneOf(Number(b.speechRate), [0.8, 1, 1.2], 'speech_rate', 1)); // только без товара
  }
  contents.push({ type: 'speech_script', text: str(b.script, 2000, 'speech_script', true) });
  const action = str(b.actionPrompt, 2500, 'action_prompt', false);
  if (action) settings.action_prompt = action;
  return { contents, settings, title: title || str(b.script, 60, 'speech_script', true) };
}

function buildGoods(b) {
  const refs = images(b.productImages, 1, 5, 'product image');
  const title = str(b.goodsTitle, 200, 'goods_title', true);
  const desc = str(b.goodsDescription, 2000, 'goods_description', false);
  const contents = refs.map((u) => ({ type: 'ref_image', url: u }));
  contents.push({ type: 'goods_title', text: title });
  if (desc) contents.push({ type: 'goods_description', text: desc });
  const settings = {
    resolution: oneOf(b.resolution, ['720p', '1080p'], 'resolution', ''),
    aspect_ratio: oneOf(b.aspectRatio, ['9:16', '1:1', '16:9'], 'aspect_ratio', ''),
    duration: oneOf(Number(b.duration), [15, 30, 60], 'duration', ''),
  };
  return { contents, settings, title };
}

function buildApparel(b) {
  const info = str(b.productInfo, 2500, 'product_info', true);
  const contents = [
    { type: 'product_info', text: info },
    { type: 'source_video', url: httpUrl(b.sourceVideo, 'source_video', ['.mp4', '.mov'], true) },
  ];
  images(b.productImages, 1, 5, 'product image').forEach((u) => contents.push({ type: 'product_image', url: u }));
  images(b.modelImages, 0, 5, 'model image').forEach((u) => contents.push({ type: 'model_image', url: u }));
  const bgm = httpUrl(b.bgmUrl, 'bgm', ['.mp3', '.m4a', '.wav', '.wave'], false);
  if (bgm) contents.push({ type: 'bgm', url: bgm });
  if (b.voiceId) contents.push({ type: 'voice', voice_id: oneOf(b.voiceId, VOICES_APPAREL, 'voice', '') });
  const settings = { resolution: oneOf(b.resolution, ['720p', '1080p'], 'resolution', '720p') };
  if (b.aspectRatio) settings.aspect_ratio = oneOf(b.aspectRatio, ['9:16', '2:3', '3:4', '1:1', '4:3', '3:2', '16:9', '21:9'], 'aspect_ratio', '');
  return { contents, settings, title: info.slice(0, 60) };
}
const BUILDERS = { talking_agent: buildTalking, goods_studio: buildGoods, clothing_dupe: buildApparel };

/* ───────── вызовы Kling ───────── */
async function call(method, urlPath, body) {
  let r;
  try {
    r = await fetch(BASE + urlPath, {
      method,
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
    });
  } catch { throw new ApiError('Kling is unreachable', 502, 'goods_unavailable'); }
  let j = null;
  try { j = await r.json(); } catch { /* пустой ответ */ }
  if (!r.ok || !j || j.code !== 0) {
    const msg = String((j && j.message) || r.status);
    console.error('[goods] kling error', r.status, j && j.code, msg);
    if (j && j.code === 1201) throw new ApiError(msg, 400, /risk control/i.test(msg) ? 'goods_rejected' : 'goods_invalid');
    throw new ApiError(msg, 502, 'goods_unavailable');
  }
  return j.data;
}

const available = (demo) => demo || !!KEY;

async function create(aid, tool, body, demo) {
  if (!TOOLS[tool]) throw new ApiError('Unknown tool', 404, 'not_found');
  if (!available(demo)) throw new ApiError('Not configured', 503, 'goods_unavailable');
  const built = BUILDERS[tool](body || {}); // сначала проверка, потом лимит
  if (usedToday(aid) >= DAILY) throw new ApiError('Daily limit', 429, 'goods_limit');
  const id = crypto.randomBytes(8).toString('hex');
  const { title, ...payload } = built;
  payload.options = { external_task_id: `tl_${id}`, watermark: { enabled: false } };
  if (tool === 'clothing_dupe') { payload.options.watermark_info = payload.options.watermark; delete payload.options.watermark; }
  let klingId;
  if (demo) klingId = 'demo-' + id;
  else klingId = (await call('POST', TOOLS[tool].path, payload)).id;
  const task = { id, klingId, affiliateId: String(aid), tool, title, status: 'submitted', createdAt: Date.now(), outputs: [], message: '' };
  load().tasks.push(task);
  await persist();
  return pub(task);
}

const pub = (t) => ({ id: t.id, tool: t.tool, title: t.title, status: t.status, createdAt: t.createdAt, outputs: t.outputs, message: t.message, demo: String(t.klingId).startsWith('demo-') });
const final = (t) => t.status === 'succeeded' || t.status === 'failed';

async function list(aid, demo) {
  const tasks = mine(aid).slice(0, 30);
  const open = tasks.filter((t) => !final(t));
  const real = open.filter((t) => !String(t.klingId).startsWith('demo-'));
  for (let i = 0; i < real.length && KEY; i += 20) {
    const chunk = real.slice(i, i + 20);
    try {
      const rows = await call('GET', '/solutions?task_ids=' + chunk.map((t) => t.klingId).join(','));
      for (const r of rows || []) {
        const t = chunk.find((x) => x.klingId === r.id);
        if (!t) continue;
        t.status = ['submitted', 'processing', 'succeeded', 'failed'].includes(r.status) ? r.status : t.status;
        t.message = r.status === 'failed' ? String(r.message || '') : '';
        t.outputs = (r.outputs || []).filter((o) => o && o.url).map((o) => ({ type: o.type, url: o.url, duration: o.duration }));
      }
    } catch (e) { console.error('[goods] refresh failed:', e.message); }
  }
  for (const t of open.filter((x) => String(x.klingId).startsWith('demo-'))) {
    const age = Date.now() - t.createdAt;
    t.status = age < 3000 ? 'submitted' : age < 8000 ? 'processing' : 'succeeded';
  }
  if (open.length) await persist();
  return tasks.map(pub);
}

const config = (aid, demo) => ({
  enabled: available(demo),
  demo: !!demo,
  dailyLimit: DAILY,
  left: Math.max(0, DAILY - usedToday(aid)),
  avatars: AVATARS,
  voices: { talking_agent: VOICES_TALK, clothing_dupe: VOICES_APPAREL },
});

module.exports = { create, list, config, FILE };
