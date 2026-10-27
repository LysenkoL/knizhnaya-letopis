// Синхронизация с Google Drive через ваш личный Google Apps Script.
// Скрипт (apps-script/Code.gs) пишет книги в Google Таблицу,
// а обложки и голосовые записи — в папку «Книжная летопись» на Google Drive.

import * as db from './db.js';

const CFG_KEY = 'letopis.cfg';

export function getCfg() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch (e) { return {}; }
}

export function setCfg(cfg) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
}

export function isConfigured() {
  const c = getCfg();
  return !!(c.url && c.token);
}

// ---------- статус для значка в шапке ----------
export const status = { state: 'off', pending: 0, lastOk: null, error: '' };
function emit() { window.dispatchEvent(new CustomEvent('sync-status', { detail: status })); }
function setState(state, extra = {}) { Object.assign(status, { state }, extra); emit(); }

export async function countPending() {
  const [books, sessions] = await Promise.all([db.getAll('books'), db.getAll('sessions')]);
  return books.filter(b => b.dirty).length + sessions.filter(s => s.dirty).length;
}

export async function refreshStatus() {
  status.pending = await countPending();
  if (!isConfigured()) setState('off');
  else if (status.state === 'syncing') emit();
  else setState(status.pending ? 'pending' : (status.error ? 'error' : 'ok'));
}

// ---------- запрос к скрипту ----------
export async function call(payload, cfgOverride) {
  const cfg = cfgOverride || getCfg();
  if (!cfg.url || !cfg.token) throw new Error('Хранилище не настроено');
  let r;
  try {
    // text/plain — «простой» запрос, браузер не делает предварительную проверку CORS
    r = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, token: cfg.token }),
      redirect: 'follow',
    });
  } catch (e) {
    throw new Error('Нет связи с Google. Проверьте интернет и адрес скрипта.');
  }
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch (e) {
    throw new Error('Скрипт ответил не данными. Проверьте, что при публикации выбран доступ «Все» (Anyone).');
  }
  if (!j.ok) throw new Error(j.error || 'Ошибка скрипта');
  return j;
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function publicBook(b) {
  const { coverFile, audioFile, dirty, coverChanged, audioChanged, ...rest } = b;
  return rest;
}

async function downloadDriveFile(id) {
  const j = await call({ action: 'file', id });
  return base64ToBlob(j.base64, j.mime || 'application/octet-stream');
}

async function syncBook(book) {
  const payload = { action: 'upsertBook', book: publicBook(book) };
  const drive = book.drive || {};
  if (book.coverChanged || !drive.coverId) {
    if (book.coverFile) {
      const blob = await db.getFileBlob(book.coverFile);
      if (blob) payload.coverDataUrl = await blobToDataUrl(blob);
    }
    if (!payload.coverDataUrl && book.coverUrl) payload.coverUrl = book.coverUrl;
  }
  if (book.audioChanged || (!drive.audioId && book.audioFile)) {
    if (book.audioFile) {
      const blob = await db.getFileBlob(book.audioFile);
      if (blob) {
        payload.audioDataUrl = await blobToDataUrl(blob);
        payload.audioMime = blob.type || book.audioMime || 'audio/webm';
      }
    } else {
      payload.removeAudio = true;
    }
  }
  const res = await call(payload);

  // Перечитываем запись: вдруг её изменили, пока шла отправка.
  const fresh = await db.get('books', book.id);
  if (!fresh) return;
  fresh.drive = { coverId: res.coverId || '', audioId: res.audioId || '' };
  if (fresh.updatedAt === book.updatedAt) {
    fresh.dirty = false;
    fresh.coverChanged = false;
    fresh.audioChanged = false;
  }
  // Обложка из интернета: сохраним копию с Drive и в телефон.
  if (!fresh.coverFile && res.coverId) {
    try {
      const blob = await downloadDriveFile(res.coverId);
      fresh.coverFile = await db.saveFile(blob);
    } catch (e) { /* не страшно, попробуем в следующий раз */ }
  }
  await db.put('books', fresh);
}

async function syncSession(s) {
  const { dirty, ...pub } = s;
  await call({ action: 'upsertSession', session: pub });
  const fresh = await db.get('sessions', s.id);
  if (fresh) {
    fresh.dirty = false;
    await db.put('sessions', fresh);
  }
}

let running = null;
export function syncNow() {
  if (!isConfigured()) { refreshStatus(); return Promise.resolve({ skipped: true }); }
  if (running) return running;
  running = (async () => {
    setState('syncing', { error: '' });
    let errors = 0;
    let lastError = '';
    try {
      const books = (await db.getAll('books')).filter(b => b.dirty);
      for (const b of books) {
        try { await syncBook(b); } catch (e) { errors++; lastError = e.message; }
      }
      const sessions = (await db.getAll('sessions')).filter(s => s.dirty);
      for (const s of sessions) {
        try { await syncSession(s); } catch (e) { errors++; lastError = e.message; }
      }
      status.pending = await countPending();
      if (errors) setState('error', { error: lastError });
      else setState(status.pending ? 'pending' : 'ok', { lastOk: new Date().toISOString(), error: '' });
      return { errors, lastError };
    } finally {
      running = null;
    }
  })();
  return running;
}

// Восстановление на новом телефоне: забираем всё из Google Drive.
export async function restoreFromDrive(onProgress = () => {}) {
  onProgress('Загружаю список книг…');
  const j = await call({ action: 'list' });
  let added = 0;
  for (const rb of j.books || []) {
    const local = await db.get('books', rb.id);
    if (local && local.dirty) continue;
    if (local && (local.updatedAt || '') >= (rb.updatedAt || '')) continue;
    const merged = { ...rb, dirty: false, coverChanged: false, audioChanged: false };
    const sameCover = local && local.drive && rb.drive && local.drive.coverId === rb.drive.coverId;
    const sameAudio = local && local.drive && rb.drive && local.drive.audioId === rb.drive.audioId;
    merged.coverFile = sameCover ? local.coverFile : '';
    merged.audioFile = sameAudio ? local.audioFile : '';
    await db.put('books', merged);
    if (!local) added++;
  }
  for (const rs of j.sessions || []) {
    const local = await db.get('sessions', rs.id);
    if (!local) await db.put('sessions', { ...rs, dirty: false });
  }
  // Скачиваем обложки и записи, которых нет в телефоне.
  const books = await db.getAll('books');
  const need = books.filter(b => !b.deleted && b.drive && ((b.drive.coverId && !b.coverFile) || (b.drive.audioId && !b.audioFile)));
  let n = 0;
  for (const b of need) {
    n++;
    onProgress(`Скачиваю обложки и записи: ${n} из ${need.length}`);
    try {
      if (b.drive.coverId && !b.coverFile) b.coverFile = await db.saveFile(await downloadDriveFile(b.drive.coverId));
      if (b.drive.audioId && !b.audioFile) b.audioFile = await db.saveFile(await downloadDriveFile(b.drive.audioId));
      await db.put('books', b);
    } catch (e) { /* пропускаем, можно повторить */ }
  }
  await refreshStatus();
  return { added, total: (j.books || []).length };
}

export async function serverLookup(isbn) {
  if (!isConfigured()) return null;
  const j = await call({ action: 'lookup', isbn });
  return j.book || null;
}
