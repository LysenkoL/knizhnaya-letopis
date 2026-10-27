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
const BEAD_COLORS = ['#E35D6A', '#F2B33D', '#3E9C7B', '#4C6FD6', '#9A5BD3', '#E9853C', '#2BA3B5'];
const COVER_COLORS = ['#3E7C6B', '#2D3E7A', '#B04A5A', '#8A6A2E', '#5B4A9E', '#2F6F8F', '#A0522D'];
const BEAD_SECONDS = 300; // 5 минут = 1 бусинка
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
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2h4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
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
const nBeads = (n) => `${n} ${plural(n, 'бусинка', 'бусинки', 'бусинок')}`;
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
  const alexBeads = sessions.filter(s => s.who === 'alexandra').reduce((s, x) => s + (x.beads || 0), 0);

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
      <div class="card stat"><span class="who" style="color:var(--alex)">Александра</span><span class="num">${nBooks(alexBooks.length)}</span><span class="sub">${nBeads(alexBeads)}</span></div>
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
    title: '', author: '', pages: '', isbn: '',
    who: getPref('lastWho', 'alexandra'), date: todayStr(), source: getPref('lastSource', 'library'),
    rating: 0, note: '',
    candidates: [], cover: null, audio: null, audioRemoved: false, dupInfo: '',
  };
}

routes.add = async (r) => {
  const editId = r.q.get('edit');
  if (editId) {
    if (!draft || draft.editId !== editId) {
      const b = await db.get('books', editId);
      if (!b) { location.hash = '#/shelf'; return; }
      draft = {
        ...newDraft(), stage: 'form', editId,
        title: b.title || '', author: b.author || '', pages: b.pages || '', isbn: b.isbn || '',
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
      if (!draft.pages && more.pages) draft.pages = more.pages;
      renderCoverBlock();
      const p = $('#fPages'); if (p && !p.value && draft.pages) p.value = draft.pages;
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

async function findByIsbn(isbn) {
  view.innerHTML = `<div class="card empty"><span class="spinner"></span><p>Ищу книгу ${esc(isbn)}…</p></div>`;
  const res = await lookupIsbn(isbn, sync.serverLookup);
  Object.assign(draft, {
    stage: 'form', isbn, fromCatalog: res.found,
    title: res.title || '', author: res.author || '', pages: res.pages || '',
    candidates: res.covers,
  });
  draft.cover = res.covers[0] ? { type: 'url', url: res.covers[0] } : null;
  await checkDuplicate();
  renderForm();
  if (!res.found) toast('В каталогах не нашлась. Заполните название и сфотографируйте обложку.', 4200);
  else if (!res.covers.length) toast('Книгу нашла, а обложку — нет. Сфотографируйте её.', 4200);
}

// ----- сканер -----
async function openScanner() {
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
  $('#scanManual', wrap).onclick = () => { close(); const i = $('#isbnIn'); if (i) i.focus(); };
  try {
    stop = await startScanner($('video', wrap), (isbn) => {
      if (navigator.vibrate) navigator.vibrate(80);
      close();
      findByIsbn(isbn);
    }, () => {
      const m = $('#scanMsg', wrap);
      if (m) m.textContent = 'Это не ISBN (может, наклейка библиотеки). Найдите штрихкод, который начинается на 978 или 979.';
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
    <div class="card" id="coverBlock"></div>
    <div class="card stack">
      <label class="field">Название *<input class="input" id="fTitle" value="${esc(draft.title)}" autocomplete="off"></label>
      <label class="field">Автор<input class="input" id="fAuthor" value="${esc(draft.author)}" autocomplete="off"></label>
      <div class="grid2">
        <label class="field">Страниц<input class="input" id="fPages" inputmode="numeric" value="${esc(draft.pages)}"></label>
        <label class="field">ISBN<input class="input" id="fIsbn" inputmode="numeric" value="${esc(draft.isbn)}"></label>
      </div>
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
  $('#fIsbn').oninput = (e) => { draft.isbn = e.target.value; };
  $('#fIsbn').onchange = async (e) => {
    const isbn = normalizeIsbn(e.target.value);
    if (isbn && !draft.candidates.length) {
      draft.isbn = isbn;
      const res = await lookupIsbn(isbn, sync.serverLookup).catch(() => null);
      if (res && res.covers.length) {
        draft.candidates = res.covers;
        if (!draft.cover) draft.cover = { type: 'url', url: res.covers[0] };
        renderCoverBlock();
      }
    }
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
      isbn: normalizeIsbn(draft.isbn) || String(draft.isbn || '').trim(),
      who: draft.who, date: draft.date || todayStr(), source: draft.source,
      rating: draft.rating || 0, note: draft.note.trim(),
      updatedAt: now, dirty: true,
    });
    // обложка
    const c = draft.cover;
    let downloadUrl = null;
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
  const sessions = (await db.getAll('sessions')).filter(s => s.bookId === b.id);
  const minutes = Math.round(sessions.reduce((s, x) => s + (x.seconds || 0), 0) / 60);
  const beads = sessions.reduce((s, x) => s + (x.beads || 0), 0);
  const face = FACES.find(f => f.v === b.rating);
  const who = WHO[b.who] || WHO.mama;
  view.innerHTML = `
    <div class="book-hero" style="background:${HERO_BG[b.who] || HERO_BG.together}">
      <a class="icon-btn back" href="#/shelf" aria-label="На полку">${ic('back')}</a>
      <a class="icon-btn edit" href="#/add?edit=${encodeURIComponent(b.id)}" aria-label="Изменить">${ic('edit')}</a>
      ${coverHtml(b)}
      <h1>${esc(b.title)}</h1>
      <span class="by">${esc([b.author, b.pages ? b.pages + ' страниц' : ''].filter(Boolean).join(' · '))}</span>
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
    <div class="grid3">
      <div class="mini"><b>${minutes}</b><span>минут с таймером</span></div>
      <div class="mini"><b>${beads}</b><span>${plural(beads, 'бусинка', 'бусинки', 'бусинок')}</span></div>
      <div class="mini">${face ? faceSvg(face, `role="img" aria-label="${face.label}"`) : '<b>—</b>'}<span>${face ? esc(face.label.toLowerCase()) : 'без оценки'}</span></div>
    </div>
    <a class="btn secondary" href="#/timer?book=${encodeURIComponent(b.id)}">${ic('timer')}Читать с таймером</a>
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

// ===================== ТАЙМЕР =====================
const TIMER_KEY = 'letopis.timer';
function getTimer() {
  try { return JSON.parse(localStorage.getItem(TIMER_KEY)) || null; } catch (e) { return null; }
}
function saveTimer(t) {
  try { if (t) localStorage.setItem(TIMER_KEY, JSON.stringify(t)); else localStorage.removeItem(TIMER_KEY); } catch (e) { /* ignore */ }
}
function newTimer() {
  return { running: false, startedAt: null, accumulated: 0, who: getPref('timerWho', 'alexandra'), bookId: '', sessionId: null, sessionStart: null, beadsShown: 0 };
}
function elapsed(t) {
  if (!t) return 0;
  return t.accumulated + (t.running && t.startedAt ? (Date.now() - t.startedAt) / 1000 : 0);
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) { /* не страшно */ }
}
document.addEventListener('visibilitychange', () => {
  const t = getTimer();
  if (t && t.running && document.visibilityState === 'visible') keepAwake(true);
});

let audioCtx = null;
function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = [784, 988, 1319];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t0 = audioCtx.currentTime + i * 0.14;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0);
      o.stop(t0 + 0.55);
    });
  } catch (e) { /* ignore */ }
}

function celebrate(n) {
  if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  chime();
  const el = document.createElement('div');
  el.className = 'bead-burst';
  el.innerHTML = `<span class="bead" style="background:${BEAD_COLORS[(n - 1) % BEAD_COLORS.length]}"></span><b>+1 бусинка!</b>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2300);
}

// Общий «тик»: следит за бусинками, даже если открыт другой экран.
setInterval(() => {
  const t = getTimer();
  if (!t || !t.running) return;
  const beads = Math.floor(elapsed(t) / BEAD_SECONDS);
  if (beads > (t.beadsShown || 0)) {
    t.beadsShown = beads;
    saveTimer(t);
    celebrate(beads);
  }
  window.dispatchEvent(new Event('timer-tick'));
}, 500);

routes.timer = async (r) => {
  const { books, sessions } = await loadData();
  let t = getTimer() || newTimer();
  const preBook = r.q.get('book');
  if (preBook && !t.running && !t.accumulated) { t.bookId = preBook; saveTimer(t); }

  const draw = () => {
    t = getTimer() || t;
    const e = elapsed(t);
    const inCycle = e % BEAD_SECONDS;
    const left = BEAD_SECONDS - inCycle;
    const sessionBeads = Math.floor(e / BEAD_SECONDS);
    const C = 2 * Math.PI * 110;
    const arc = $('#ringArc');
    if (arc) arc.setAttribute('stroke-dasharray', `${(C * inCycle / BEAD_SECONDS).toFixed(1)} ${C.toFixed(1)}`);
    const tm = $('#tTime'); if (tm) tm.textContent = mmss(left);
    const tl = $('#tTotal'); if (tl) tl.textContent = `Сейчас читаем: ${mmss(e)} · бусинок за этот раз: ${sessionBeads}`;
    const svg = $('#ringSvg'); if (svg) svg.setAttribute('aria-label', `До следующей бусинки ${mmss(left)}`);
  };

  const whoSessions = (who) => sessions.filter(s => s.who === who);
  const today = todayStr();

  const render = () => {
    t = getTimer() || t;
    const started = t.running || t.accumulated > 0;
    const hist = whoSessions(t.who);
    const total = hist.reduce((s, x) => s + (x.beads || 0), 0);
    const todayBeads = hist.filter(s => s.date === today).reduce((s, x) => s + (x.beads || 0), 0);
    const live = Math.floor(elapsed(t) / BEAD_SECONDS);
    const shownTotal = total + live;
    const slots = Math.max(10, Math.ceil((Math.min(shownTotal, 40) + 1) / 10) * 10);
    const startIdx = Math.max(0, shownTotal - 40);
    const C = 2 * Math.PI * 110;
    const whoLabel = WHO[t.who].label;
    view.innerHTML = `
      <div class="top"><h1 class="title-hand">${t.who === 'alexandra' ? 'Александра читает' : 'Мама читает'}</h1></div>
      <div class="seg" role="group" aria-label="Кто читает">
        <button data-tw="alexandra" aria-pressed="${t.who === 'alexandra'}" ${started ? 'disabled' : ''}>Александра</button>
        <button data-tw="mama" aria-pressed="${t.who === 'mama'}" ${started ? 'disabled' : ''}>Мама</button>
      </div>
      <label class="field">Книга
        <select class="input" id="tBook">
          <option value="">— без книги —</option>
          ${books.slice(0, 60).map(b => `<option value="${esc(b.id)}" ${b.id === t.bookId ? 'selected' : ''}>${esc(b.title)}${b.author ? ' — ' + esc(b.author) : ''}</option>`).join('')}
        </select>
      </label>
      <div class="timer-wrap">
        <div class="ring">
          <svg viewBox="0 0 260 260" id="ringSvg" role="img" aria-label="Таймер">
            <circle cx="130" cy="130" r="110" fill="#FFFFFF" stroke="#F3D9C8" stroke-width="18"/>
            <circle id="ringArc" cx="130" cy="130" r="110" fill="none" stroke="var(--alex)" stroke-width="18" stroke-linecap="round" stroke-dasharray="0 ${C.toFixed(1)}" transform="rotate(-90 130 130)"/>
          </svg>
          <div class="center"><span class="time" id="tTime">5:00</span><span class="lbl">до бусинки</span></div>
        </div>
        <p class="small muted" id="tTotal" style="font-weight:700;text-align:center"></p>
        <div class="timer-btns">
          ${t.running ? `<button class="btn secondary big" id="tPause">${PAUSE}Пауза</button>`
            : `<button class="btn accent big" id="tStart">${PLAY}${started ? 'Дальше' : 'Начать'}</button>`}
          ${started ? `<button class="btn big" id="tFinish">${ic('check')}Дочитали</button>` : ''}
        </div>
      </div>
      <div class="card stack">
        <div class="row between"><span class="title-hand" style="font-size:28px">Бусы: ${esc(whoLabel)}</span><span class="small muted" style="font-weight:700">сегодня +${todayBeads + live}</span></div>
        <div class="necklace" aria-label="${nBeads(shownTotal)}">
          ${Array.from({ length: slots }, (_, i) => {
            const n = startIdx + i;
            return n < shownTotal ? `<span class="bead ${n >= total ? 'pop' : ''}" style="background:${BEAD_COLORS[n % BEAD_COLORS.length]}"></span>` : '<span class="bead hole"></span>';
          }).join('')}
        </div>
        <span class="small muted">Всего ${nBeads(shownTotal)} · 5 минут чтения = 1 бусинка</span>
      </div>
    `;
    $$('[data-tw]').forEach(b => b.onclick = () => { t.who = b.dataset.tw; setPref('timerWho', t.who); saveTimer(t); render(); });
    $('#tBook').onchange = (e) => { t.bookId = e.target.value; saveTimer(t); };
    const s = $('#tStart');
    if (s) s.onclick = () => {
      if (!t.sessionId) { t.sessionId = db.uid(); t.sessionStart = new Date().toISOString(); }
      t.running = true;
      t.startedAt = Date.now();
      saveTimer(t);
      keepAwake(true);
      chime.prime = true;
      try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (e) { /* ignore */ }
      render();
    };
    const p = $('#tPause');
    if (p) p.onclick = () => {
      t.accumulated = elapsed(t);
      t.running = false;
      t.startedAt = null;
      saveTimer(t);
      keepAwake(false);
      render();
    };
    const f = $('#tFinish');
    if (f) f.onclick = finish;
    draw();
  };

  const finish = async () => {
    const sec = Math.round(elapsed(t));
    keepAwake(false);
    if (sec < 30) {
      const ok = await confirmModal({ title: 'Меньше минуты', text: 'Такой короткий сеанс не записываем. Сбросить таймер?', ok: 'Сбросить' });
      if (ok) { saveTimer(null); t = newTimer(); render(); }
      return;
    }
    const beads = Math.floor(sec / BEAD_SECONDS);
    const book = books.find(b => b.id === t.bookId);
    const session = {
      id: t.sessionId || db.uid(),
      startedAt: t.sessionStart || new Date().toISOString(),
      date: todayStr(),
      who: t.who,
      seconds: sec,
      beads,
      bookId: t.bookId || '',
      bookTitle: book ? book.title : '',
      dirty: true,
    };
    await db.put('sessions', session);
    sessions.push(session);
    saveTimer(null);
    t = newTimer();
    toast(`Записано: ${Math.round(sec / 60)} мин, ${nBeads(beads)}`, 3500);
    render();
    sync.refreshStatus();
    sync.syncNow();
  };

  const onTick = () => draw();
  window.addEventListener('timer-tick', onTick);
  onLeave(() => window.removeEventListener('timer-tick', onTick));
  // перерисовать ожерелье, когда появилась новая бусинка
  let lastBeads = Math.floor(elapsed(t) / BEAD_SECONDS);
  const onBead = () => {
    const nb = Math.floor(elapsed(getTimer() || t) / BEAD_SECONDS);
    if (nb !== lastBeads) { lastBeads = nb; render(); }
  };
  window.addEventListener('timer-tick', onBead);
  onLeave(() => window.removeEventListener('timer-tick', onBead));
  render();
};

// ===================== ЛЕТОПИСЬ =====================
routes.chronicle = async () => {
  const { books, sessions } = await loadData();
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
      const beads = sessions.filter(s => s.who === 'alexandra' && parseDate(s.date).y === y).reduce((s, x) => s + (x.beads || 0), 0);
      const mamaPages = mama.reduce((s, b) => s + (Number(b.pages) || 0), 0);
      return `<section class="year">
        <div class="year-head"><h2>${y}</h2><span class="small muted">${nBooks(list.length)}</span></div>
        <div class="year-stats">
          <div class="mini"><b>${mama.length}</b><span>мама</span></div>
          <div class="mini"><b>${alex.length}</b><span>Александра</span></div>
          <div class="mini"><b>${beads}</b><span>бусинок</span></div>
        </div>
        ${mamaPages ? `<p class="small muted">Мама прочитала ${nPages(mamaPages)}</p>` : ''}
        <div class="list">${list.map(b => `
          <a class="li" href="#/book/${encodeURIComponent(b.id)}">
            ${coverHtml(b)}
            <div class="t"><b>${esc(b.title)}</b><span>${esc([fmtDate(b.date), b.author].filter(Boolean).join(' · '))}</span></div>
            <span class="who-dot who-${esc(b.who)}" title="${esc(WHO[b.who].label)}"></span>
          </a>`).join('')}</div>
      </section>`;
    }).join('') : `<div class="card empty"><p>Здесь книги соберутся по годам: сколько прочитала мама, сколько Александра, сколько бусинок.</p></div>`}
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
      <label class="field">Адрес скрипта (заканчивается на /exec)
        <input class="input" id="cUrl" value="${esc(cfg.url || '')}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" inputmode="url"></label>
      <label class="field">Ключ доступа
        <input class="input" id="cToken" value="${esc(cfg.token || '')}" autocomplete="off" placeholder="из Google Таблицы, лист «Настройки»"></label>
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
      <p class="small">${nBooks(books.filter(b => !b.deleted).length)} · ${sessions.length} ${plural(sessions.length, 'сеанс', 'сеанса', 'сеансов')} чтения · ${files.length} ${plural(files.length, 'файл', 'файла', 'файлов')}</p>
      <p class="small muted">${persisted ? 'Браузер обещал не удалять данные.' : 'Браузер может удалить данные при нехватке места — поэтому важно подключить Google Drive.'}</p>
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
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();

// для проверки в консоли
window.__letopis = { db, sync, probeImage };
