// Книжная летопись — семейный читательский дневник.
import * as db from './db.js';
import * as sync from './sync.js';
import { normalizeIsbn, lookupIsbn, searchByTitle, downloadImage, shrinkPhoto, probeImage } from './lookup.js';
import { startScanner, cameraAvailable } from './scanner.js';

// ===================== справочники =====================
const WHO = {
  alexandra: { label: 'Александра', short: 'А' },
  mama: { label: 'Мама', short: 'М' },
  together: { label: 'Вместе', short: 'М+А' },
};
const SOURCES = { library: 'Библиотека', own: 'Своя', gift: 'Подарок', school: 'Школа', other: 'Другое' };
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const FACES = [
  { v: 1, label: 'Не понравилось', mouth: 'M8.5 16.5c1.8-2 5.2-2 7 0' },
  { v: 2, label: 'Так себе', mouth: 'M8.5 15h7' },
  { v: 3, label: 'Понравилось', mouth: 'M8.5 14c1.8 2 5.2 2 7 0' },
  { v: 4, label: 'Очень понравилось', mouth: 'M7.5 13h9c-.6 3-2.4 4.5-4.5 4.5S8.1 16 7.5 13z' },
];
const COVER_COLORS = ['#3E7C6B', '#2D3E7A', '#B04A5A', '#8A6A2E', '#5B4A9E', '#2F6F8F', '#A0522D'];
const APP_VERSION = '2026-11-25.1';
const SCRIPT_VERSION_NEEDED = 5;
const REC_MAX_SECONDS = 180;

const ICONS = {
  back: '<path d="M15 6l-6 6 6 6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  barcode: '<path d="M4 5v14M7 5v14M10.5 5v14M13 5v14M16.5 5v14M20 5v14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9a4.5 4.5 0 0 0 1 9z"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};
const ic = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
const faceSvg = (f, attrs = 'aria-hidden="true"') => `<svg viewBox="0 0 24 24" ${attrs}><circle cx="12" cy="12" r="9"/><path d="${f.mouth}M9 9.5h.01M15 9.5h.01"/></svg>`;

// ===================== утилиты =====================
const view = document.getElementById('view');
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseDate(s) {
  const [y, m, d] = String(s || '').split('-').map(Number);
  return { y, m, d };
}

function fmtDate(s) {
  const { y, m, d } = parseDate(s);
  if (!y) return '';
  return `${d} ${MONTHS_GEN[m - 1]} ${y}`;
}

function fmtShort(s) {
  const { m, d } = parseDate(s);
  if (!m) return '';
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
const nBooks = (n) => `${n} ${plural(n, 'книга', 'книги', 'книг')}`;
const nPages = (n) => `${n.toLocaleString('ru-RU')} ${plural(n, 'страница', 'страницы', 'страниц')}`;
const nMin = (n) => `${n} мин`;

function colorFor(str) {
  let h = 0;
  for (const ch of String(str || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COVER_COLORS[h % COVER_COLORS.length];
}

function mmss(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function confirmModal({ title, text, ok = 'Да', cancel = 'Отмена', danger = false }) {
  return new Promise((resolve) => {
    const m = document.getElementById('modal');
    m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="mt">
      <h2 id="mt">${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}
      <div class="modal-btns"><button class="btn ghost" data-r="0">${esc(cancel)}</button>
      <button class="btn ${danger ? 'danger' : ''}" data-r="1">${esc(ok)}</button></div></div>`;
    m.hidden = false;
    const close = (v) => { m.hidden = true; m.innerHTML = ''; resolve(v); };
    m.onclick = (e) => {
      const b = e.target.closest('[data-r]');
      if (b) close(b.dataset.r === '1');
      else if (e.target === m) close(false);
    };
    $('[data-r="1"]', m).focus();
  });
}

function getPref(k, def) {
  try { const v = localStorage.getItem('letopis.' + k); return v == null ? def : v; } catch (e) { return def; }
}
function setPref(k, v) {
  try { localStorage.setItem('letopis.' + k, v); } catch (e) { /* ignore */ }
}

async function loadData() {
  const [books, sessions] = await Promise.all([db.getAll('books'), db.getAll('sessions')]);
  const live = books.filter(b => !b.deleted);
  live.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  return { books: live, sessions };
}

const forWho = (b, who) => who === 'all' || b.who === who || b.who === 'together';

// ===================== обложки =====================
function coverHtml(b, { badge = false, cls = '' } = {}) {
  const who = WHO[b.who] || WHO.mama;
  const src = !b.coverFile && b.coverUrl ? esc(b.coverUrl) : '';
  return `<div class="cover ${cls}" style="background:${colorFor(b.title)}">
    <span class="ph">${esc(b.title || '')}</span>
    <img alt="" hidden ${b.coverFile ? `data-file="${esc(b.coverFile)}"` : ''} ${src ? `data-src="${src}"` : ''} referrerpolicy="no-referrer">
    ${badge ? `<span class="badge who-${esc(b.who)}" aria-label="${esc(who.label)}">${esc(who.short)}</span>` : ''}
  </div>`;
}

// Подставляем картинки после отрисовки.
async function hydrateCovers(root = view) {
  for (const img of $$('img[data-file], img[data-src]', root)) {
    const show = () => { img.hidden = false; const ph = img.parentElement.querySelector('.ph'); if (ph) ph.hidden = true; };
    img.onload = show;
    img.onerror = () => { img.remove(); };
    if (img.dataset.file) {
      const url = await db.fileUrl(img.dataset.file);
      if (url) { img.src = url; continue; }
    }
    if (img.dataset.src) img.src = img.dataset.src;
  }
}

// ===================== навигация =====================
let cleanups = [];
function onLeave(fn) { cleanups.push(fn); }

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const parts = path.split('/');
  return { name: parts[0] || 'shelf', arg: parts[1] ? decodeURIComponent(parts[1]) : null, q: new URLSearchParams(qs || '') };
}

const routes = {};
async function route() {
  cleanups.forEach(f => { try { f(); } catch (e) { /* ignore */ } });
  cleanups = [];
  const r = parseHash();
  const fn = routes[r.name] || routes.shelf;
  const tab = r.name === 'book' ? 'shelf' : r.name;
  $$('.tab').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  $$('.tab').forEach(a => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  try {
    await fn(r);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card"><b>Что-то пошло не так</b><p class="muted small">${esc(e.message)}</p></div>`;
  }
  window.scrollTo(0, 0);
}

function syncDotHtml() {
  const s = sync.status;
  const map = {
    off: ['', 'Хранилище не подключено'],
    ok: ['ok', 'Сохранено в Google'],
    pending: ['pending', `Ждёт отправки: ${s.pending}`],
    syncing: ['pending', 'Сохраняю…'],
    error: ['error', 'Ошибка сохранения'],
  };
  const [cls, label] = map[s.state] || map.off;
  return `<a href="#/settings" class="sync-dot ${cls}" id="syncDot"><i></i>${esc(label)}</a>`;
}

window.addEventListener('sync-status', () => {
  const el = document.getElementById('syncDot');
  if (el) el.outerHTML = syncDotHtml();
});

// ===================== ПОЛКА =====================
routes.shelf = async () => {
  const { books, sessions } = await loadData();
  const filter = getPref('filter', 'all');
  const year = new Date().getFullYear();
  const inYear = (b) => parseDate(b.date).y === year;
  const mamaBooks = books.filter(b => forWho(b, 'mama'));
  const alexBooks = books.filter(b => forWho(b, 'alexandra'));
  const mamaPagesYear = mamaBooks.filter(inYear).reduce((s, b) => s + (Number(b.pages) || 0), 0);
  const alexPagesYear = alexBooks.filter(inYear).reduce((s, b) => s + (Number(b.pages) || 0), 0);

  const shown = books.filter(b => forWho(b, filter));
  const groups = new Map();
  for (const b of shown) {
    const { y, m } = parseDate(b.date);
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (!groups.has(key)) groups.set(key, { y, m, list: [] });
    groups.get(key).list.push(b);
  }

  const now = parseDate(todayStr());
  const memories = books.filter(b => { const d = parseDate(b.date); return d.m === now.m && d.d === now.d && d.y < now.y; });
  const mem = memories[0];

  view.innerHTML = `
    <div class="top">
      <h1 class="title-hand">Наша книжная летопись</h1>
    </div>
    <div class="row between">${syncDotHtml()}</div>
    <div class="grid2">
      <div class="card stat"><span class="who">Мама</span><span class="num">${nBooks(mamaBooks.length)}</span><span class="sub">${nPages(mamaPagesYear)} в ${year}</span></div>
      <div class="card stat"><span class="who" style="color:var(--alex)">Александра</span><span class="num">${nBooks(alexBooks.length)}</span><span class="sub">${nPages(alexPagesYear)} в ${year}</span></div>
    </div>
    <div class="seg" role="group" aria-label="Чьи книги показать">
      ${[['all', 'Все'], ['mama', 'Мама'], ['alexandra', 'Александра']].map(([k, l]) => `<button data-f="${k}" aria-pressed="${filter === k}">${l}</button>`).join('')}
    </div>
    ${mem ? `<a class="card memory" href="#/book/${encodeURIComponent(mem.id)}">
        ${coverHtml(mem)}
        <div class="stack" style="gap:2px"><span class="small muted" style="font-weight:800">В этот день, ${fmtDate(mem.date)}</span>
        <span style="font-weight:800">${esc(WHO[mem.who].label)} ${mem.who === 'together' ? 'читали' : (mem.who === 'mama' ? 'читала' : 'читала')} «${esc(mem.title)}»</span>
        ${mem.note ? `<span class="small muted">«${esc(mem.note.slice(0, 80))}${mem.note.length > 80 ? '…' : ''}»</span>` : ''}</div></a>` : ''}
    ${shown.length ? [...groups.values()].map(g => `
      <section class="stack">
        <div class="row between"><h2 class="h2">${MONTHS[g.m - 1]} ${g.y}</h2><span class="small muted">${nBooks(g.list.length)}</span></div>
        <div class="grid3 shelf">${g.list.map(b => `
          <a class="book-tile" href="#/book/${encodeURIComponent(b.id)}">
            ${coverHtml(b, { badge: true })}
            <span class="tile-title">${esc(b.title)}</span>
            <span class="tile-date">${fmtShort(b.date)}</span>
          </a>`).join('')}</div>
      </section>`).join('') : `
      <div class="card empty">
        <span class="title-hand" style="font-size:32px">Здесь будет ваша полка</span>
        <p>Нажмите на большой плюс внизу, отсканируйте штрихкод книги — и она появится здесь с обложкой.</p>
        <a class="btn accent" href="#/add">${ic('barcode')}Добавить первую книгу</a>
      </div>`}
  `;
  $$('[data-f]', view).forEach(b => b.onclick = () => { setPref('filter', b.dataset.f); route(); });
  hydrateCovers();
};

// ===================== ДОБАВЛЕНИЕ / ИЗМЕНЕНИЕ =====================
let draft = null;
function newDraft() {
  return {
    stage: 'find', editId: null, fromCatalog: false,
    title: '', author: '', pages: '', isbn: '', publisher: '', year: '', notFound: '',
    who: getPref('lastWho', 'alexandra'), date: todayStr(), source: getPref('lastSource', 'library'),
    rating: 0, note: '',
    candidates: [], cover: null, audio: null, audioRemoved: false, dupInfo: '',
  };
}

routes.add = async (r) => {
  if (pendingIsbn) {
    const isbn = pendingIsbn;
    pendingIsbn = null;
    draft = newDraft();
    findByIsbn(isbn);
    return;
  }
  const editId = r.q.get('edit');
  if (editId) {
    if (!draft || draft.editId !== editId) {
      const b = await db.get('books', editId);
      if (!b) { location.hash = '#/shelf'; return; }
      draft = {
        ...newDraft(), stage: 'form', editId,
        title: b.title || '', author: b.author || '', pages: b.pages || '', isbn: b.isbn || '',
        publisher: b.publisher || '', year: b.year || '',
        who: b.who, date: b.date, source: b.source || 'library', rating: b.rating || 0, note: b.note || '',
        cover: b.coverFile ? { type: 'file', fileId: b.coverFile } : (b.coverUrl ? { type: 'url', url: b.coverUrl } : null),
        audio: b.audioFile ? { type: 'file', fileId: b.audioFile, sec: b.audioSec || 0 } : null,
      };
    }
  } else if (!draft || draft.editId) {
    draft = newDraft();
  }
  if (draft.stage === 'find') renderFind();
  else renderForm();
};

function renderFind() {
  view.innerHTML = `
    <div class="top"><h1 class="title-hand">Новая книга</h1></div>
    <div class="card find-actions">
      <button class="btn accent big" id="scanBtn">${ic('barcode')}Сканировать штрихкод</button>
      <p class="small muted" style="text-align:center">Штрихкод с ISBN обычно на обороте книги, внизу</p>
    </div>
    <div class="or">или</div>
    <form class="card stack" id="isbnForm">
      <label class="field" for="isbnIn">Ввести ISBN вручную</label>
      <div class="input-row"><input class="input" id="isbnIn" inputmode="numeric" autocomplete="off" placeholder="978…">
      <button class="btn" type="submit">Найти</button></div>
    </form>
    <form class="card stack" id="titleForm">
      <label class="field" for="titleIn">Найти по названию или автору</label>
      <div class="input-row"><input class="input" id="titleIn" autocomplete="off" placeholder="Das kleine Gespenst">
      <button class="btn" type="submit" aria-label="Искать">${ic('search')}</button></div>
      <div class="results" id="results"></div>
    </form>
    <button class="btn dashed" id="manualBtn">${ic('pen')}Заполнить вручную</button>
  `;
  $('#scanBtn').onclick = openScanner;
  if (!cameraAvailable()) $('#scanBtn').disabled = true;
  $('#manualBtn').onclick = () => { draft.stage = 'form'; renderForm(); };
  $('#isbnForm').onsubmit = (e) => {
    e.preventDefault();
    const isbn = normalizeIsbn($('#isbnIn').value);
    if (!isbn) { toast('Проверьте номер: ISBN — это 10 или 13 цифр'); return; }
    findByIsbn(isbn);
  };
  $('#titleForm').onsubmit = async (e) => {
    e.preventDefault();
    const q = $('#titleIn').value.trim();
    if (q.length < 2) return;
    const box = $('#results');
    box.innerHTML = '<div class="row"><span class="spinner"></span><span class="muted small">Ищу…</span></div>';
    const list = await searchByTitle(q);
    if (!list.length) { box.innerHTML = '<p class="muted small">Ничего не нашлось. Попробуйте другое написание или заполните вручную.</p>'; return; }
    box.innerHTML = list.map((x, i) => `
      <button type="button" class="result" data-i="${i}">
        ${coverHtml({ title: x.title, coverUrl: x.cover || '' })}
        <div><b>${esc(x.title)}</b><span>${esc([x.author, x.year, x.pages ? x.pages + ' стр.' : ''].filter(Boolean).join(' · '))}</span></div>
      </button>`).join('');
    hydrateCovers(box);
    $$('.result', box).forEach(btn => btn.onclick = () => chooseResult(list[Number(btn.dataset.i)]));
  };
}

async function chooseResult(x) {
  Object.assign(draft, {
    stage: 'form', fromCatalog: true, title: x.title, author: x.author, pages: x.pages || '', isbn: x.isbn || '',
    publisher: x.publisher || '', year: x.year || '', notFound: '',
    candidates: x.cover ? [x.cover] : [],
  });
  draft.cover = x.cover ? { type: 'url', url: x.cover } : null;
  await checkDuplicate();
  renderForm();
  if (x.isbn) {
    // Ищем обложки получше по ISBN
    const more = await lookupIsbn(x.isbn, sync.serverLookup).catch(() => null);
    if (more && draft.stage === 'form' && draft.isbn === x.isbn) {
      draft.candidates = [...new Set([...more.covers, ...draft.candidates])];
      if (!draft.cover && draft.candidates[0]) draft.cover = { type: 'url', url: draft.candidates[0] };
      fillEmpty(more);
      renderCoverBlock();
    }
  }
}

async function checkDuplicate() {
  draft.dupInfo = '';
  if (!draft.isbn) return;
  const all = (await db.getAll('books')).filter(b => !b.deleted && b.isbn === draft.isbn && b.id !== draft.editId);
  if (all.length) {
    const b = all[0];
    draft.dupInfo = `Эта книга уже есть в летописи: ${WHO[b.who].label}, ${fmtDate(b.date)}. Можно сохранить ещё раз как новое прочтение.`;
  }
}

async function findByIsbn(isbn, scanned = false) {
  if (scanned && navigator.vibrate) navigator.vibrate(80);
  view.innerHTML = `<div class="card empty"><span class="spinner"></span><p>Ищу книгу ${esc(isbn)}…</p>
    <p class="small">${sync.isConfigured() ? 'Смотрю в каталогах немецких библиотек, Google Books и Open Library.' : 'Смотрю в каталогах немецких библиотек, Google Books и Open Library.'}</p></div>`;
  const res = await lookupIsbn(isbn, sync.serverLookup);
  Object.assign(draft, {
    stage: 'form', isbn, fromCatalog: res.found, notFound: res.found ? '' : isbn, notFoundScanned: scanned,
    title: res.title || '', author: res.author || '', pages: res.pages || '',
    publisher: res.publisher || '', year: res.year || '',
    candidates: res.covers,
  });
  // своё фото обложки, если уже сделано, не трогаем
  if (!(draft.cover && draft.cover.type === 'blob')) draft.cover = res.covers[0] ? { type: 'url', url: res.covers[0] } : null;
  await checkDuplicate();
  renderForm();
  if (res.found && !res.covers.length && !draft.cover) toast('Книгу нашла, а обложки в каталогах нет. Сфотографируйте её.', 4200);
}

// Заполнить пустые поля формы найденными данными
function fillEmpty(res) {
  const map = { title: '#fTitle', author: '#fAuthor', pages: '#fPages', publisher: '#fPublisher', year: '#fYear' };
  for (const [k, sel] of Object.entries(map)) {
    if (!draft[k] && res[k]) {
      draft[k] = res[k];
      const el = $(sel);
      if (el) el.value = res[k];
    }
  }
  updateSaveState();
}

// Повторный поиск по исправленному ISBN прямо из формы
async function refindFromForm() {
  const isbn = normalizeIsbn($('#fIsbn').value);
  const box = $('#isbnMsg');
  if (!isbn) { box.innerHTML = '<span class="hint">В номере ошибка: ISBN — 13 цифр, начинается на 978 или 979. Сверьте с книгой.</span>'; return; }
  draft.isbn = isbn;
  $('#fIsbn').value = isbn;
  box.innerHTML = '<span class="row small muted"><span class="spinner"></span>Ищу по номеру…</span>';
  const res = await lookupIsbn(isbn, sync.serverLookup).catch(() => null);
  if (!draft || draft.isbn !== isbn) return;
  if (!res || !res.found) {
    draft.notFound = isbn;
    box.innerHTML = `<span class="hint">По номеру ${esc(isbn)} ничего не нашлось.</span>`;
    return;
  }
  draft.notFound = '';
  draft.fromCatalog = true;
  fillEmpty(res);
  if (res.covers.length) {
    draft.candidates = [...new Set([...res.covers, ...(draft.candidates || [])])];
    if (!draft.cover) draft.cover = { type: 'url', url: draft.candidates[0] };
    renderCoverBlock();
  }
  box.innerHTML = '<span class="found-label">Найдено, поля заполнены</span>';
  const nf = $('#notFoundBox'); if (nf) nf.remove();
  await checkDuplicate();
}

// ----- сканер -----
async function openScanner(onIsbn = (isbn) => findByIsbn(isbn, true), manualSel = '#isbnIn') {
  const wrap = document.createElement('div');
  wrap.className = 'scanner';
  wrap.innerHTML = `
    <video playsinline muted></video>
    <div class="scan-frame" aria-hidden="true"></div>
    <div class="scan-top"><button class="icon-btn" id="scanClose" aria-label="Закрыть сканер">${ic('back')}</button></div>
    <div class="scan-bottom">
      <p id="scanMsg">Наведите камеру на штрихкод на обороте книги</p>
      <button class="btn ghost" id="scanManual">Ввести номер вручную</button>
    </div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('scanning');
  let stop = () => {};
  const close = () => { stop(); wrap.remove(); document.body.classList.remove('scanning'); };
  onLeave(close);
  $('#scanClose', wrap).onclick = close;
  $('#scanManual', wrap).onclick = () => { close(); const i = $(manualSel); if (i) i.focus(); };
  try {
    stop = await startScanner($('video', wrap), (isbn) => {
      close();
      onIsbn(isbn);
    }, (state) => {
      const m = $('#scanMsg', wrap);
      if (!m) return;
      m.textContent = state === 'reading'
        ? 'Вижу штрихкод, проверяю… Держите телефон ровно.'
        : 'Это не ISBN (может, наклейка библиотеки). Найдите штрихкод, который начинается на 978 или 979.';
    });
  } catch (e) {
    close();
    toast(e && e.name === 'NotAllowedError' ? 'Нет доступа к камере. Разрешите камеру для сайта в настройках браузера.' : 'Камера не запустилась: ' + (e.message || e), 5000);
  }
}

// ----- форма -----
function renderForm() {
  const editing = !!draft.editId;
  view.innerHTML = `
    <div class="top">
      <button class="icon-btn" id="formBack" aria-label="Назад">${ic('back')}</button>
      <h1 class="title-hand" style="flex:1">${editing ? 'Изменить книгу' : 'Новая книга'}</h1>
    </div>
    ${draft.dupInfo ? `<div class="status warn">${esc(draft.dupInfo)}</div>` : ''}
    ${draft.notFound ? `<div class="status warn stack" id="notFoundBox" style="gap:8px">
      <span>По номеру <b>${esc(draft.notFound)}</b> книга не нашлась ни в одном каталоге.</span>
      <span style="font-weight:600">${draft.notFoundScanned ? 'Возможно, сканер прочитал штрихкод с ошибкой (бывает, если он помят или частично закрыт наклейкой). Сверьте цифры под штрихкодом или отсканируйте ещё раз.' : 'Сверьте цифры с обратной стороной книги: если ошиблась хоть одна, найдётся чужая книга или ничего.'} Исправить номер можно в поле ISBN ниже — потом «Найти».</span>
      ${draft.notFoundScanned ? `<button class="btn accent" id="rescanBtn">${ic('barcode')}Сканировать ещё раз</button>` : ''}
      <button class="btn ghost" id="toTitleSearch">${ic('search')}Найти по названию</button></div>` : ''}
    <div class="card" id="coverBlock"></div>
    <div class="card stack">
      <label class="field">Название *<input class="input" id="fTitle" value="${esc(draft.title)}" autocomplete="off"></label>
      <label class="field">Автор<input class="input" id="fAuthor" value="${esc(draft.author)}" autocomplete="off"></label>
      <div class="grid2">
        <label class="field">Издательство<input class="input" id="fPublisher" value="${esc(draft.publisher)}" autocomplete="off"></label>
        <label class="field">Год издания<input class="input" id="fYear" inputmode="numeric" value="${esc(draft.year)}"></label>
      </div>
      <label class="field">Страниц<input class="input" id="fPages" inputmode="numeric" value="${esc(draft.pages)}" style="max-width:50%"></label>
      <label class="field" for="fIsbn">ISBN (с обратной стороны книги)</label>
      <div class="input-row">
        <input class="input" id="fIsbn" inputmode="numeric" value="${esc(draft.isbn)}" autocomplete="off">
        <button class="btn" type="button" id="fIsbnFind">${ic('search')}Найти</button>
      </div>
      <div id="isbnMsg"></div>
    </div>
    <div class="card stack">
      <span class="field">Кто читал</span>
      <div class="chips" id="whoChips">${Object.entries(WHO).map(([k, w]) => `<button class="chip who-${k}" data-who="${k}" aria-pressed="${draft.who === k}">${w.label}</button>`).join('')}</div>
      <label class="field">Когда дочитали<input class="input" type="date" id="fDate" value="${esc(draft.date)}" max="${todayStr()}"></label>
      <span class="field">Откуда книга</span>
      <div class="chips" id="srcChips">${Object.entries(SOURCES).map(([k, l]) => `<button class="chip" data-src="${k}" aria-pressed="${draft.source === k}">${l}</button>`).join('')}</div>
    </div>
    <div class="card stack">
      <span class="field">Понравилось?</span>
      <div class="faces" id="faces">${FACES.map(f => `<button class="face" data-r="${f.v}" aria-label="${f.label}" aria-pressed="${draft.rating === f.v}">${faceSvg(f)}</button>`).join('')}</div>
      <label class="field">Заметка<textarea class="input" id="fNote" placeholder="Что запомнилось, что рассмешило, какие слова были новыми…">${esc(draft.note)}</textarea></label>
    </div>
    <div class="card stack">
      <span class="field">Голос: «О чём эта книжка?»</span>
      <div id="recBlock"></div>
    </div>
    <div class="form-footer">
      <button class="btn big" id="saveBtn">${ic('check')}Сохранить в летопись</button>
      ${editing ? `<button class="btn danger" id="delBtn">${ic('trash')}Удалить книгу</button>` : ''}
    </div>
    <input type="file" accept="image/*" capture="environment" id="photoCam" hidden>
    <input type="file" accept="image/*" id="photoGal" hidden>
  `;
  $('#formBack').onclick = async () => {
    if (editing) { const id = draft.editId; draft = null; location.hash = `#/book/${encodeURIComponent(id)}`; return; }
    if (draft.title || draft.cover) {
      const ok = await confirmModal({ title: 'Начать заново?', text: 'Введённые данные этой книги не сохранятся.', ok: 'Да, заново' });
      if (!ok) return;
    }
    stopRecording(true);
    draft = newDraft();
    renderFind();
  };
  const bind = (id, key) => { $(id).oninput = (e) => { draft[key] = e.target.value; updateSaveState(); }; };
  bind('#fTitle', 'title'); bind('#fAuthor', 'author'); bind('#fPages', 'pages'); bind('#fNote', 'note'); bind('#fDate', 'date');
  bind('#fPublisher', 'publisher'); bind('#fYear', 'year');
  $('#fIsbnFind').onclick = refindFromForm;
  const rs = $('#rescanBtn');
  if (rs) rs.onclick = () => { draft.notFound = ''; openScanner(); };
  const tts = $('#toTitleSearch');
  if (tts) tts.onclick = () => { draft.stage = 'find'; draft.notFound = ''; renderFind(); const t = $('#titleIn'); if (t) { t.focus(); t.scrollIntoView({ block: 'center' }); } };
  $('#fIsbn').oninput = (e) => { draft.isbn = e.target.value; };
  $('#fIsbn').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); refindFromForm(); } };
  $('#fIsbn').onchange = (e) => {
    // если название ещё пустое — ищем сразу, как только номер исправлен
    if (normalizeIsbn(e.target.value) && !draft.title.trim()) refindFromForm();
  };
  $$('[data-who]').forEach(b => b.onclick = () => { draft.who = b.dataset.who; $$('[data-who]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  $$('[data-src]').forEach(b => b.onclick = () => { draft.source = b.dataset.src; $$('[data-src]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  $$('#faces .face').forEach(b => b.onclick = () => {
    const v = Number(b.dataset.r);
    draft.rating = draft.rating === v ? 0 : v;
    $$('#faces .face').forEach(x => x.setAttribute('aria-pressed', Number(x.dataset.r) === draft.rating));
  });
  const onPhoto = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const blob = await shrinkPhoto(f);
    if (draft.cover && draft.cover.objectUrl) URL.revokeObjectURL(draft.cover.objectUrl);
    draft.cover = { type: 'blob', blob, objectUrl: URL.createObjectURL(blob) };
    renderCoverBlock();
  };
  $('#photoCam').onchange = onPhoto;
  $('#photoGal').onchange = onPhoto;
  $('#saveBtn').onclick = saveDraft;
  if (editing) $('#delBtn').onclick = deleteCurrent;
  renderCoverBlock();
  renderRecBlock();
}

function currentCoverSrc() {
  const c = draft.cover;
  if (!c) return null;
  if (c.type === 'url') return { src: c.url };
  if (c.type === 'blob') return { src: c.objectUrl };
  if (c.type === 'file') return { file: c.fileId };
  return null;
}

function renderCoverBlock() {
  const box = $('#coverBlock');
  if (!box) return;
  const cur = currentCoverSrc();
  const cands = draft.candidates || [];
  box.innerHTML = `
    <div class="cover-pick">
      <div class="cover-main">
        <div class="cover ${cur ? 'has' : ''}">
          ${cur ? `<img alt="Обложка" ${cur.file ? `data-file="${esc(cur.file)}"` : `data-src="${esc(cur.src)}"`} hidden referrerpolicy="no-referrer"><span class="ph"></span>`
            : `<div class="cover-empty">${ic('camera')}Нужна обложка</div>`}
        </div>
      </div>
      <div class="cover-side">
        ${draft.fromCatalog ? '<span class="found-label">Найдено в каталоге</span>' : ''}
        ${cands.length > 1 ? `<span class="small muted" style="font-weight:700">Выберите обложку:</span>
          <div class="cand-row">${cands.map((u, i) => `<button class="cand" data-c="${i}" aria-label="Обложка ${i + 1}" aria-pressed="${draft.cover && draft.cover.type === 'url' && draft.cover.url === u}">
            <div class="cover"><img alt="" data-src="${esc(u)}" hidden referrerpolicy="no-referrer"></div></button>`).join('')}</div>` : ''}
        <label class="btn secondary" for="photoCam" role="button" tabindex="0">${ic('camera')}Сфотографировать</label>
        <label class="btn ghost" for="photoGal" role="button" tabindex="0">${ic('image')}Из галереи</label>
      </div>
    </div>
    ${cur ? '' : '<p class="hint" style="margin-top:10px">Обложка обязательна: выберите найденную или сфотографируйте книгу.</p>'}
  `;
  $$('.cand', box).forEach(b => b.onclick = () => {
    draft.cover = { type: 'url', url: cands[Number(b.dataset.c)] };
    renderCoverBlock();
  });
  $$('label[role="button"]', box).forEach(l => l.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); l.click(); } });
  hydrateCovers(box);
  updateSaveState();
}

function updateSaveState() {
  const btn = $('#saveBtn');
  if (btn) btn.disabled = !(draft.title.trim() && draft.cover);
}

// ----- голосовая запись -----
let rec = null; // { recorder, stream, chunks, startedAt, timer }
let player = null;

function stopRecording(discard = false) {
  if (!rec) return;
  rec.discard = discard;
  clearInterval(rec.timer);
  try { if (rec.recorder.state !== 'inactive') rec.recorder.stop(); } catch (e) { /* ignore */ }
  rec.stream.getTracks().forEach(t => t.stop());
}

function stopPlayer() {
  if (player) { player.pause(); player = null; }
}
onLeaveGlobal(() => { stopRecording(true); stopPlayer(); });
function onLeaveGlobal(fn) { window.addEventListener('hashchange', fn); }

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
    const mime = window.MediaRecorder && MediaRecorder.isTypeSupported ? types.find(t => MediaRecorder.isTypeSupported(t)) : '';
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    rec = { recorder, stream, chunks: [], startedAt: Date.now(), discard: false };
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
    recorder.onstop = () => {
      const r = rec;
      rec = null;
      if (!r || r.discard || !draft) { renderRecBlock(); return; }
      const type = (recorder.mimeType || mime || 'audio/webm').split(';')[0];
      const blob = new Blob(r.chunks, { type });
      const sec = Math.round((Date.now() - r.startedAt) / 1000);
      draft.audio = { type: 'blob', blob, sec, mime: type };
      draft.audioRemoved = false;
      renderRecBlock();
    };
    recorder.start(1000);
    rec.timer = setInterval(() => {
      const s = (Date.now() - rec.startedAt) / 1000;
      const el = $('#recTime');
      if (el) el.textContent = mmss(s);
      if (s >= REC_MAX_SECONDS) stopRecording(false);
    }, 250);
    renderRecBlock();
  } catch (e) {
    toast('Нет доступа к микрофону. Разрешите его в настройках браузера.', 4000);
  }
}

async function audioUrlFor(a) {
  if (!a) return null;
  if (a.type === 'blob') return URL.createObjectURL(a.blob);
  if (a.type === 'file') return db.fileUrl(a.fileId);
  return null;
}

function renderRecBlock() {
  const box = $('#recBlock');
  if (!box || !draft) return;
  if (rec) {
    box.innerHTML = `<div class="rec"><span class="rec-dot" aria-hidden="true"></span><b id="recTime">0:00</b>
      <button class="btn accent" id="recStop">${ic('stop')}Стоп</button></div>`;
    $('#recStop').onclick = () => stopRecording(false);
    return;
  }
  if (draft.audio) {
    box.innerHTML = `<div class="rec">
      <button class="play" id="recPlay" aria-label="Слушать">${PLAY}</button>
      <b>${mmss(draft.audio.sec || 0)}</b>
      <button class="btn ghost" id="recAgain">${ic('mic')}Заново</button>
      <button class="icon-btn" id="recDel" aria-label="Удалить запись">${ic('trash')}</button></div>`;
    $('#recPlay').onclick = async () => {
      if (player) { stopPlayer(); $('#recPlay').innerHTML = PLAY; return; }
      const url = await audioUrlFor(draft.audio);
      if (!url) return;
      player = new Audio(url);
      player.onended = () => { player = null; const b = $('#recPlay'); if (b) b.innerHTML = PLAY; };
      player.play();
      $('#recPlay').innerHTML = PAUSE;
    };
    $('#recAgain').onclick = () => { stopPlayer(); startRecording(); };
    $('#recDel').onclick = () => { stopPlayer(); draft.audio = null; draft.audioRemoved = true; renderRecBlock(); };
    return;
  }
  box.innerHTML = `<button class="btn dashed" id="recStart">${ic('mic')}Записать рассказ (до 3 минут)</button>`;
  $('#recStart').onclick = startRecording;
  if (!(navigator.mediaDevices && window.MediaRecorder)) $('#recStart').disabled = true;
}

// ----- сохранение -----
async function saveDraft() {
  if (rec) stopRecording(false);
  const btn = $('#saveBtn');
  if (!draft.title.trim() || !draft.cover) { updateSaveState(); return; }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Сохраняю…';
  try {
    const now = new Date().toISOString();
    const old = draft.editId ? await db.get('books', draft.editId) : null;
    const book = old ? { ...old } : { id: db.uid(), createdAt: now, drive: {} };
    Object.assign(book, {
      title: draft.title.trim(),
      author: draft.author.trim(),
      pages: Number(String(draft.pages).replace(/\D/g, '')) || null,
      publisher: (draft.publisher || '').trim(),
      year: String(draft.year || '').replace(/\D/g, '').slice(0, 4),
      isbn: normalizeIsbn(draft.isbn) || String(draft.isbn || '').trim(),
      who: draft.who, date: draft.date || todayStr(), source: draft.source,
      rating: draft.rating || 0, note: draft.note.trim(),
      updatedAt: now, dirty: true,
    });
    // обложка
    let c = draft.cover;
    let downloadUrl = null;
    if (c.type === 'url' && c.url.startsWith('data:')) {
      // обложка, которую принёс Google-скрипт (DNB): сразу сохраняем как файл
      c = { type: 'blob', blob: await (await fetch(c.url)).blob() };
    }
    if (c.type === 'blob') {
      book.coverFile = await db.saveFile(c.blob);
      book.coverUrl = '';
      book.coverChanged = true;
    } else if (c.type === 'url' && (!old || old.coverUrl !== c.url || !old.coverFile && !old.coverUrl)) {
      book.coverUrl = c.url;
      book.coverFile = '';
      book.coverChanged = true;
      downloadUrl = c.url;
    }
    // голос
    if (draft.audio && draft.audio.type === 'blob') {
      book.audioFile = await db.saveFile(draft.audio.blob);
      book.audioMime = draft.audio.mime;
      book.audioSec = draft.audio.sec;
      book.audioChanged = true;
    } else if (!draft.audio && (draft.audioRemoved || (old && old.audioFile))) {
      if (old && old.audioFile) { book.audioFile = ''; book.audioSec = 0; book.audioChanged = true; }
    }
    await db.put('books', book);
    setPref('lastWho', draft.who);
    setPref('lastSource', draft.source);
    draft = null;
    toast('Книга сохранена в летопись');
    location.hash = `#/book/${encodeURIComponent(book.id)}`;
    if (downloadUrl) {
      // копия обложки в телефон (если сайт разрешает), не задерживая сохранение
      downloadImage(downloadUrl).then(async (blob) => {
        if (!blob) return;
        const fresh = await db.get('books', book.id);
        if (fresh && !fresh.coverFile && fresh.coverUrl === downloadUrl) {
          fresh.coverFile = await db.saveFile(blob);
          await db.put('books', fresh);
        }
      });
    }
    sync.refreshStatus();
    sync.syncNow();
  } catch (e) {
    console.error(e);
    toast('Не получилось сохранить: ' + e.message, 5000);
    btn.disabled = false;
    btn.innerHTML = `${ic('check')}Сохранить в летопись`;
  }
}

async function deleteCurrent() {
  const ok = await confirmModal({ title: 'Удалить книгу?', text: 'Она пропадёт с полки. В Google Таблице строка останется с пометкой «удалено».', ok: 'Удалить', danger: true });
  if (!ok) return;
  const b = await db.get('books', draft.editId);
  if (b) {
    b.deleted = new Date().toISOString();
    b.updatedAt = b.deleted;
    b.dirty = true;
    await db.put('books', b);
  }
  draft = null;
  toast('Книга удалена');
  location.hash = '#/shelf';
  sync.refreshStatus();
  sync.syncNow();
}

// ===================== КАРТОЧКА КНИГИ =====================
const HERO_BG = { mama: '#DDE3F3', alexandra: '#FBE3D3', together: '#DCEBE5' };

routes.book = async (r) => {
  const b = await db.get('books', r.arg);
  if (!b || b.deleted) { location.hash = '#/shelf'; return; }
  const face = FACES.find(f => f.v === b.rating);
  const who = WHO[b.who] || WHO.mama;
  view.innerHTML = `
    <div class="book-hero" style="background:${HERO_BG[b.who] || HERO_BG.together}">
      <a class="icon-btn back" href="#/shelf" aria-label="На полку">${ic('back')}</a>
      <a class="icon-btn edit" href="#/add?edit=${encodeURIComponent(b.id)}" aria-label="Изменить">${ic('edit')}</a>
      ${coverHtml(b)}
      <h1>${esc(b.title)}</h1>
      <span class="by">${esc([b.author, b.pages ? b.pages + ' страниц' : ''].filter(Boolean).join(' · '))}</span>
      ${b.publisher || b.year ? `<span class="by small">${esc([b.publisher, b.year].filter(Boolean).join(', '))}</span>` : ''}
    </div>
    <div class="chips">
      <span class="pill who-${esc(b.who)}">${b.who === 'together' ? 'Читали вместе' : (b.who === 'mama' ? 'Прочитала мама' : 'Прочитала Александра')}</span>
      <span class="pill">${fmtDate(b.date)}</span>
      ${b.source ? `<span class="pill">${esc(SOURCES[b.source] || b.source)}</span>` : ''}
    </div>
    ${b.audioFile ? `<div class="card audio-card">
        <button class="play" id="bPlay" aria-label="Слушать запись">${PLAY}</button>
        <div class="stack" style="gap:6px;flex:1"><b class="small">Рассказ о книге · ${mmss(b.audioSec || 0)}</b><div class="bar"><i id="bBar"></i></div></div>
      </div>` : ''}
    ${b.note ? `<div class="card stack" style="gap:4px"><span class="small muted" style="font-weight:800">Заметка</span><div class="note-hand">${esc(b.note)}</div></div>` : ''}
    <div class="grid2">
      <div class="mini"><b>${b.pages || '—'}</b><span>страниц</span></div>
      <div class="mini">${face ? faceSvg(face, `role="img" aria-label="${face.label}"`) : '<b>—</b>'}<span>${face ? esc(face.label.toLowerCase()) : 'без оценки'}</span></div>
    </div>
    <p class="small muted" style="text-align:center">${b.isbn ? 'ISBN ' + esc(b.isbn) + ' · ' : ''}${b.dirty ? 'ещё не отправлено в Google' : (b.drive && b.drive.coverId ? 'сохранено в Google Drive' : '')}</p>
  `;
  hydrateCovers();
  const playBtn = $('#bPlay');
  if (playBtn) {
    let audio = null;
    let raf = null;
    const tick = () => {
      if (!audio) return;
      const bar = $('#bBar');
      if (bar && audio.duration && isFinite(audio.duration)) bar.style.width = (100 * audio.currentTime / audio.duration) + '%';
      raf = requestAnimationFrame(tick);
    };
    const stop = () => { if (audio) audio.pause(); audio = null; cancelAnimationFrame(raf); const p = $('#bPlay'); if (p) p.innerHTML = PLAY; };
    onLeave(stop);
    playBtn.onclick = async () => {
      if (audio) { stop(); return; }
      const url = await db.fileUrl(b.audioFile);
      if (!url) { toast('Запись ещё не скачана с Google Drive'); return; }
      audio = new Audio(url);
      audio.onended = stop;
      await audio.play();
      playBtn.innerHTML = PAUSE;
      tick();
    };
  }
};

// ===================== ПРОВЕРКА В БИБЛИОТЕКЕ =====================
// Сканируем книгу на полке библиотеки — сразу видно, читали её или нет.
const checkHistory = []; // проверено за этот раз (не сохраняется)
let pendingIsbn = null;  // «Записать в летопись» из проверки

function normTitle(s) {
  return String(s || '').toLowerCase().replace(/ß/g, 'ss').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function readingLine(b) {
  const face = FACES.find(f => f.v === b.rating);
  const who = b.who === 'together' ? 'Читали вместе' : (b.who === 'mama' ? 'Мама' : 'Александра');
  return [who, fmtDate(b.date), face ? face.label.toLowerCase() : ''].filter(Boolean).join(' · ');
}

function readingsHtml(list) {
  return `<div class="list">${list.map(b => `
    <a class="li" href="#/book/${encodeURIComponent(b.id)}">
      ${coverHtml(b)}
      <div class="t"><b>${esc(b.title)}</b><span>${esc(readingLine(b))}</span></div>
      <span class="who-dot who-${esc(b.who)}"></span>
    </a>`).join('')}</div>`;
}

function renderCheckHistory() {
  const box = $('#chkHistory');
  if (!box) return;
  if (checkHistory.length < 2) { box.innerHTML = ''; return; }
  box.innerHTML = `<h2 class="h2" style="margin:4px 0 8px">Проверено сейчас</h2>
    <div class="list">${checkHistory.map(h => `
      <div class="li" style="min-height:52px">
        <span class="chk-mark ${h.read ? 'read' : 'new'}" aria-hidden="true">${ic(h.read ? 'check' : 'plus')}</span>
        <div class="t"><b>${esc(h.title || 'ISBN ' + h.isbn)}</b><span>${h.read ? 'уже читали' : 'не читали — можно брать'}</span></div>
      </div>`).join('')}</div>`;
}

function rememberCheck(isbn, title, read) {
  const old = checkHistory.findIndex(h => h.isbn === isbn);
  if (old >= 0) checkHistory.splice(old, 1);
  checkHistory.unshift({ isbn, title, read });
  if (checkHistory.length > 15) checkHistory.pop();
  renderCheckHistory();
}

async function checkIsbn(isbn, scanned = false) {
  const box = $('#chkResult');
  if (!box) return;
  const books = (await db.getAll('books')).filter(b => !b.deleted);
  const exact = books.filter(b => b.isbn === isbn).sort((x, y) => (y.date || '').localeCompare(x.date || ''));
  if (exact.length) {
    if (scanned && navigator.vibrate) navigator.vibrate([150, 80, 150]);
    box.innerHTML = `<div class="card stack chk-card read">
      <div class="chk-head read">${ic('check')}Уже читали${exact.length > 1 ? ` · ${exact.length} раза` : ''}</div>
      ${readingsHtml(exact)}
    </div>`;
    hydrateCovers(box);
    rememberCheck(isbn, exact[0].title, true);
    box.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }
  if (scanned && navigator.vibrate) navigator.vibrate(60);
  box.innerHTML = `<div class="card stack chk-card new">
    <div class="chk-head new">${ic('plus')}Ещё не читали — можно брать!</div>
    <div id="chkCat" class="row small muted"><span class="spinner"></span>Узнаю название… (ISBN ${esc(isbn)})</div>
    <div id="chkSimilar"></div>
    <button class="btn ghost" id="chkAdd">${ic('pen')}Уже прочитали — записать в летопись</button>
  </div>`;
  $('#chkAdd').onclick = () => { pendingIsbn = isbn; location.hash = '#/add'; };
  rememberCheck(isbn, '', false);
  box.scrollIntoView({ block: 'start', behavior: 'smooth' });

  // Название из каталога — и проверка, не читали ли то же самое в другом издании
  const res = await lookupIsbn(isbn, sync.serverLookup).catch(() => null);
  const cat = $('#chkCat');
  if (!cat) return;
  if (!res || !res.found) {
    cat.innerHTML = `<span>Название не нашлось (нет интернета или книги нет в каталогах). В летописи номера ${esc(isbn)} нет.</span>`;
    return;
  }
  const cover = res.covers[0];
  cat.className = 'row';
  cat.style.alignItems = 'center';
  cat.innerHTML = `<div style="width:56px;flex-shrink:0">${coverHtml({ title: res.title, coverUrl: cover || '' })}</div>
    <div class="stack" style="gap:2px"><b>${esc(res.title)}</b><span class="small muted">${esc([res.author, res.year].filter(Boolean).join(' · '))}</span></div>`;
  hydrateCovers(cat);
  rememberCheck(isbn, res.title, false);
  const nt = normTitle(res.title);
  const similar = nt.length >= 5 ? books.filter(b => {
    const bt = normTitle(b.title);
    return bt && (bt === nt || (bt.length >= 8 && (bt.includes(nt) || nt.includes(bt))));
  }) : [];
  if (similar.length) {
    const sim = $('#chkSimilar');
    const card = sim.closest('.chk-card');
    card.classList.replace('new', 'read');
    const head = card.querySelector('.chk-head');
    head.className = 'chk-head read';
    head.innerHTML = `${ic('check')}Похоже, уже читали — в другом издании`;
    sim.innerHTML = `<span class="small muted" style="font-weight:700">Штрихкод другой, но название то же:</span>${readingsHtml(similar)}`;
    hydrateCovers(sim);
    rememberCheck(isbn, res.title, true);
  }
}

async function checkText(q) {
  const isbn = normalizeIsbn(q);
  if (isbn) return checkIsbn(isbn);
  const box = $('#chkResult');
  const words = normTitle(q).split(' ').filter(w => w.length > 1);
  if (!words.length) return;
  const books = (await db.getAll('books')).filter(b => !b.deleted);
  const found = books.filter(b => {
    const hay = normTitle(b.title + ' ' + (b.author || ''));
    return words.every(w => hay.includes(w));
  }).sort((x, y) => (y.date || '').localeCompare(x.date || ''));
  box.innerHTML = found.length
    ? `<div class="card stack chk-card read"><div class="chk-head read">${ic('check')}Нашлось в летописи: ${nBooks(found.length)}</div>${readingsHtml(found)}</div>`
    : `<div class="card stack chk-card new"><div class="chk-head new">${ic('plus')}В летописи такой книги нет</div>
        <span class="small muted">Искала «${esc(q)}» в названиях и авторах. Надёжнее сканировать штрихкод.</span></div>`;
  hydrateCovers(box);
}

routes.check = async () => {
  view.innerHTML = `
    <div class="top"><h1 class="title-hand">Читали или нет?</h1></div>
    <p class="small muted" style="font-weight:700">В библиотеке отсканируйте штрихкод книги — сразу видно, читали ли вы её и когда.</p>
    <button class="btn accent big" id="chkScan">${ic('barcode')}Сканировать книгу</button>
    <div id="chkResult"></div>
    <form class="card stack" id="chkForm">
      <label class="field" for="chkIn">Или введите ISBN или слова из названия</label>
      <div class="input-row"><input class="input" id="chkIn" autocomplete="off" placeholder="978… или «kleine Hexe»">
      <button class="btn" type="submit" aria-label="Проверить">${ic('search')}</button></div>
    </form>
    <section id="chkHistory"></section>`;
  $('#chkScan').onclick = () => openScanner((isbn) => checkIsbn(isbn, true), '#chkIn');
  if (!cameraAvailable()) $('#chkScan').disabled = true;
  $('#chkForm').onsubmit = (e) => { e.preventDefault(); const q = $('#chkIn').value.trim(); if (q) checkText(q); };
  renderCheckHistory();
};
routes.timer = () => { location.replace('#/check'); };

// ===================== ЛЕТОПИСЬ =====================
routes.chronicle = async () => {
  const { books } = await loadData();
  const years = new Map();
  for (const b of books) {
    const y = parseDate(b.date).y || 0;
    if (!years.has(y)) years.set(y, []);
    years.get(y).push(b);
  }
  const sortedYears = [...years.keys()].sort((a, b) => b - a);
  view.innerHTML = `
    <div class="top"><h1 class="title-hand">Летопись</h1>${syncDotHtml()}</div>
    ${books.length ? sortedYears.map(y => {
      const list = years.get(y);
      const mama = list.filter(b => forWho(b, 'mama'));
      const alex = list.filter(b => forWho(b, 'alexandra'));
      const pages = list.reduce((s, b) => s + (Number(b.pages) || 0), 0);
      const mamaPages = mama.reduce((s, b) => s + (Number(b.pages) || 0), 0);
      return `<section class="year">
        <div class="year-head"><h2>${y}</h2><span class="small muted">${nBooks(list.length)}</span></div>
        <div class="year-stats">
          <div class="mini"><b>${mama.length}</b><span>мама</span></div>
          <div class="mini"><b>${alex.length}</b><span>Александра</span></div>
          <div class="mini"><b>${pages.toLocaleString('ru-RU')}</b><span>страниц</span></div>
        </div>
        ${mamaPages ? `<p class="small muted">Мама прочитала ${nPages(mamaPages)}</p>` : ''}
        <div class="list">${list.map(b => `
          <a class="li" href="#/book/${encodeURIComponent(b.id)}">
            ${coverHtml(b)}
            <div class="t"><b>${esc(b.title)}</b><span>${esc([fmtDate(b.date), b.author].filter(Boolean).join(' · '))}</span></div>
            <span class="who-dot who-${esc(b.who)}" title="${esc(WHO[b.who].label)}"></span>
          </a>`).join('')}</div>
      </section>`;
    }).join('') : `<div class="card empty"><p>Здесь книги соберутся по годам: сколько прочитала мама, сколько Александра, сколько страниц.</p></div>`}
  `;
  hydrateCovers();
};

// ===================== ХРАНИЛИЩЕ =====================
routes.settings = async () => {
  const cfg = sync.getCfg();
  const [books, sessions, files] = await Promise.all([db.getAll('books'), db.getAll('sessions'), db.getAll('files')]);
  let persisted = false;
  try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch (e) { /* ignore */ }
  const s = sync.status;
  const statusBox = () => {
    if (!sync.isConfigured()) return `<div class="status warn">Google Drive ещё не подключён. Пока всё хранится только в этом телефоне.</div>`;
    if (s.state === 'error') return `<div class="status err">Ошибка: ${esc(s.error)}</div>`;
    if (s.pending) return `<div class="status warn">Ждут отправки: ${s.pending}. Отправятся, когда будет интернет.</div>`;
    return `<div class="status ok">${ic('check').replace('<svg', '<svg width="20" height="20" style="fill:none;stroke:currentColor;stroke-width:2.4;flex-shrink:0"')}Всё сохранено в Google Drive${s.lastOk ? ' · ' + new Date(s.lastOk).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</div>`;
  };
  view.innerHTML = `
    <div class="top"><h1 class="title-hand">Хранилище</h1></div>
    <section class="card stack">
      <h2 class="h2">Google Drive</h2>
      <div id="stBox">${statusBox()}</div>
      <div id="verBox"></div>
      <label class="field">Адрес скрипта (заканчивается на /exec)
        <input class="input" id="cUrl" value="${esc(cfg.url || '')}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" inputmode="url"></label>
      <label class="field" for="cToken">Ключ доступа</label>
      <div class="input-row">
        <input class="input secret" id="cToken" value="${esc(cfg.token || '')}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="из Google Таблицы, лист «Настройки»">
        <button class="icon-btn" id="cEye" type="button" aria-label="Показать ключ" aria-pressed="false" style="width:48px;height:48px">${ic('eye')}</button>
      </div>
      <button class="btn" id="cSave">${ic('cloud')}Сохранить и проверить</button>
      <div class="grid2">
        <button class="btn ghost" id="cSync" ${sync.isConfigured() ? '' : 'disabled'}>${ic('upload')}Отправить</button>
        <button class="btn ghost" id="cRestore" ${sync.isConfigured() ? '' : 'disabled'}>${ic('download')}Восстановить</button>
      </div>
      <p class="small muted">«Восстановить» — для нового телефона: заберёт все книги, обложки и записи из Google Drive.</p>
      <details>
        <summary>Как подключить Google Drive</summary>
        <ol class="steps">
          <li>Создайте новую Google Таблицу (sheets.new), назовите «Книжная летопись».</li>
          <li>В таблице: Расширения → Apps Script. Удалите всё и вставьте код из файла <b>apps-script/Code.gs</b> (в репозитории на GitHub).</li>
          <li>Выберите функцию <b>setup</b> и нажмите «Выполнить». Разрешите доступ к своему аккаунту.</li>
          <li>Нажмите «Начать развёртывание» → «Новое развёртывание» → тип «Веб-приложение». Запуск от имени: <b>я</b>. Доступ: <b>все</b>. Скопируйте адрес.</li>
          <li>Вставьте адрес сюда, а ключ возьмите из листа «Настройки» в таблице.</li>
        </ol>
      </details>
    </section>
    ${isStandalone() ? '' : `<section class="card stack">
      <h2 class="h2">Приложение на телефоне</h2>
      ${installPrompt ? `<button class="btn accent" id="installBtn">${ic('download')}Установить «Летопись»</button>` : ''}
      <p class="small muted">${installPrompt ? 'Или вручную:' : 'Как поставить на главный экран:'}</p>
      <ul class="steps">
        <li><b>Android, Chrome:</b> меню ⋮ → «Добавить на главный экран» → «Установить». Если пишет «уже установлено» — выберите «Создать ярлык».</li>
        <li><b>iPhone, Safari:</b> кнопка «Поделиться» → «На экран „Домой“».</li>
      </ul>
    </section>`}
    <section class="card stack">
      <h2 class="h2">Копия-файл</h2>
      <p class="small muted">Полная копия всех книг с обложками и голосом в одном файле. Можно хранить где угодно, хоть на флешке.</p>
      <div class="grid2">
        <button class="btn ghost" id="exBtn">${ic('download')}Скачать</button>
        <label class="btn ghost" for="imFile" role="button" tabindex="0">${ic('upload')}Загрузить</label>
      </div>
      <input type="file" id="imFile" accept="application/json,.json" hidden>
    </section>
    <section class="card stack">
      <h2 class="h2">В этом телефоне</h2>
      <p class="small">${nBooks(books.filter(b => !b.deleted).length)} · ${files.length} ${plural(files.length, 'файл', 'файла', 'файлов')}</p>
      <p class="small muted">${persisted ? 'Браузер обещал не удалять данные.' : 'Браузер может удалить данные при нехватке места — поэтому важно подключить Google Drive.'}</p>
      <p class="small muted">Версия приложения ${APP_VERSION}</p>
    </section>
  `;
  const busy = (btn, text) => { btn.dataset.html = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>${text}`; };
  const unbusy = (btn) => { btn.disabled = false; btn.innerHTML = btn.dataset.html; };

  $('#cSave').onclick = async () => {
    const btn = $('#cSave');
    const next = { url: $('#cUrl').value.trim(), token: $('#cToken').value.trim() };
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(next.url)) { toast('Адрес должен начинаться на https://script.google.com/ и заканчиваться на /exec', 5000); return; }
    if (!next.token) { toast('Вставьте ключ доступа'); return; }
    busy(btn, 'Проверяю…');
    try {
      const j = await sync.call({ action: 'ping' }, next);
      next.scriptVersion = j.version || 1;
      sync.setCfg(next);
      toast(`Подключено: ${j.sheetName || 'таблица'}`);
      await sync.refreshStatus();
      await sync.syncNow();
      route();
    } catch (e) {
      $('#stBox').innerHTML = `<div class="status err">${esc(e.message)}</div>`;
      unbusy(btn);
    }
  };
  $('#cSync').onclick = async () => {
    const btn = $('#cSync');
    busy(btn, 'Отправляю…');
    await db.getAll('books'); // прогреваем
    const res = await sync.syncNow();
    toast(res.errors ? 'Часть не отправилась: ' + res.lastError : 'Готово');
    route();
  };
  $('#cRestore').onclick = async () => {
    const btn = $('#cRestore');
    busy(btn, 'Загружаю…');
    try {
      const res = await sync.restoreFromDrive((msg) => { btn.innerHTML = `<span class="spinner"></span>${esc(msg)}`; });
      toast(`Готово: в Google ${nBooks(res.total)}, новых в телефоне — ${res.added}`, 4000);
      route();
    } catch (e) {
      toast(e.message, 5000);
      unbusy(btn);
    }
  };
  // Сами спрашиваем у скрипта его версию — без нажатия кнопок
  const showVer = (v) => {
    const box = $('#verBox');
    if (!box) return;
    box.innerHTML = v && v < SCRIPT_VERSION_NEEDED
      ? `<div class="status warn stack" style="gap:6px"><span>Google-скрипт старой версии: ${v}, нужна ${SCRIPT_VERSION_NEEDED}. Книги сохраняются и так, но в таблице не будет колонок «Издательство» и «Год».</span>
         <span style="font-weight:600">Как обновить: в редакторе скрипта вставьте новый код (Ctrl+A → вставить → Ctrl+S), затем «Начать развёртывание» → «Управление развёртываниями» → ✏️ → Версия: «Новая версия» → «Развернуть». Эта надпись исчезнет сама.</span></div>`
      : '';
  };
  if (sync.isConfigured()) {
    showVer(cfg.scriptVersion || 1);
    sync.call({ action: 'ping' }).then((j) => {
      const c = sync.getCfg();
      c.scriptVersion = j.version || 1;
      sync.setCfg(c);
      showVer(c.scriptVersion);
    }).catch(() => {});
  }
  $('#cEye').onclick = () => {
    const inp = $('#cToken');
    const show = inp.classList.toggle('secret') === false;
    $('#cEye').setAttribute('aria-pressed', show);
    $('#cEye').setAttribute('aria-label', show ? 'Скрыть ключ' : 'Показать ключ');
    $('#cEye').innerHTML = ic(show ? 'eyeOff' : 'eye');
  };
  const inst = $('#installBtn');
  if (inst) inst.onclick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    if (choice && choice.outcome === 'accepted') toast('Готово! Ищите «Летопись» на главном экране');
    route();
  };
  $('#exBtn').onclick = () => exportBackup($('#exBtn'));
  $('#imFile').onchange = (e) => importBackup(e.target.files && e.target.files[0]);
  $$('label[role="button"]').forEach(l => l.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); l.click(); } });
};

async function exportBackup(btn) {
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Собираю…';
  try {
    const books = await db.getAll('books');
    const sessions = await db.getAll('sessions');
    const out = [];
    for (const b of books) {
      const item = { ...sync.publicBook(b) };
      if (b.coverFile) { const bl = await db.getFileBlob(b.coverFile); if (bl) item.coverData = await sync.blobToDataUrl(bl); }
      if (b.audioFile) { const bl = await db.getFileBlob(b.audioFile); if (bl) item.audioData = await sync.blobToDataUrl(bl); }
      out.push(item);
    }
    const data = { app: 'knizhnaya-letopis', version: 1, exportedAt: new Date().toISOString(), books: out, sessions: sessions.map(({ dirty, ...s }) => s) };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `letopis-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  } catch (e) {
    toast('Не получилось: ' + e.message, 4000);
  } finally {
    btn.disabled = false;
    btn.innerHTML = html;
  }
}

async function importBackup(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'knizhnaya-letopis') throw new Error('Это не файл летописи');
    let added = 0;
    for (const item of data.books || []) {
      const local = await db.get('books', item.id);
      if (local && (local.updatedAt || '') >= (item.updatedAt || '')) continue;
      const { coverData, audioData, ...b } = item;
      if (coverData) b.coverFile = await db.saveFile(await (await fetch(coverData)).blob());
      if (audioData) b.audioFile = await db.saveFile(await (await fetch(audioData)).blob());
      const sent = b.drive && b.drive.coverId;
      b.dirty = !sent;
      await db.put('books', b);
      if (!local) added++;
    }
    for (const s of data.sessions || []) {
      if (!(await db.get('sessions', s.id))) await db.put('sessions', { ...s, dirty: sync.isConfigured() });
    }
    toast(`Загружено. Новых книг: ${added}`);
    await sync.refreshStatus();
    sync.syncNow();
    route();
  } catch (e) {
    toast('Не получилось загрузить: ' + e.message, 5000);
  }
}

// ===================== установка на телефон =====================
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (parseHash().name === 'settings') route();
});
window.addEventListener('appinstalled', () => { installPrompt = null; });
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// ===================== запуск =====================
window.addEventListener('hashchange', route);
window.addEventListener('online', () => sync.syncNow());

(async function start() {
  db.askPersist();
  await sync.refreshStatus();
  if (!location.hash) location.replace('#/shelf');
  await route();
  sync.syncNow();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    // Когда на GitHub выходит новая версия — один раз перезагружаемся, чтобы она включилась.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded || draft) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
  }
})();

// для проверки в консоли
window.__letopis = { db, sync, probeImage };
