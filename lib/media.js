'use strict';
/**
 * Offer photos and creatives. Production: Supabase Storage (public bucket "offer-media"), written
 * only by this server with the service key. Demo: memory, served at /media/<name>.
 * Only raster images are accepted (PNG, JPEG, WebP, GIF — checked by their bytes, not the name);
 * SVG is refused because it can carry scripts.
 */
const crypto = require('crypto');
const cfg = require('./config');
const { ApiError } = require('./errors');

const MAX = 3 * 1024 * 1024;
const demo = new Map();

function kindOf(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return ['image/png', 'png'];
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ['image/jpeg', 'jpg'];
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return ['image/webp', 'webp'];
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return ['image/gif', 'gif'];
  return null;
}

async function upload(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new ApiError('Файл пустой', 400, 'empty_file');
  if (buf.length > MAX) throw new ApiError('Файл больше 3 МБ', 413, 'file_too_large');
  const k = kindOf(buf);
  if (!k) throw new ApiError('Нужна картинка PNG, JPG, WebP или GIF', 415, 'bad_image');
  const name = `${new Date().toISOString().slice(0, 7)}/${crypto.randomBytes(12).toString('hex')}.${k[1]}`;
  if (cfg.demo) {
    demo.set(name.replace('/', '_'), { type: k[0], buf });
    return `/media/${name.replace('/', '_')}`;
  }
  let res;
  try {
    res = await fetch(`${cfg.supabase.url}/storage/v1/object/offer-media/${name}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.supabase.serviceKey}`, apikey: cfg.supabase.serviceKey, 'Content-Type': k[0], 'Cache-Control': 'max-age=31536000', 'x-upsert': 'false' },
      body: buf,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ApiError('Хранилище недоступно, повторите', 503, 'upstream_unavailable');
  }
  if (!res.ok) throw new ApiError('Не удалось сохранить файл', 502, 'upload_failed');
  return `${cfg.supabase.url}/storage/v1/object/public/offer-media/${name}`;
}

function demoFile(name) {
  return demo.get(name) || null;
}

// URL check for offer photos/creatives: https anywhere, or our own demo /media/ path.
const okUrl = (u) => /^https:\/\//.test(u) || (cfg.demo && /^\/media\/[A-Za-z0-9_.-]+$/.test(u));

module.exports = { upload, demoFile, okUrl, MAX };
