// Поиск книги по ISBN (штрихкоду) и по названию.
// Источники: ваш Google-скрипт (каталог lobid + Немецкая национальная библиотека DNB),
// Google Books, Open Library. Обложки: DNB (через скрипт), Open Library, Google Books.

const TIMEOUT = 9000;

export function cleanIsbn(raw) {
  return String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

function isbn10to13(isbn10) {
  const core = '978' + isbn10.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1);
  return core + ((10 - (sum % 10)) % 10);
}

function validIsbn13(s) {
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

function validIsbn10(s) {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
  return sum % 11 === 0;
}

// Возвращает ISBN-13 или null.
export function normalizeIsbn(raw) {
  const s = cleanIsbn(raw);
  if (s.length === 13 && (s.startsWith('978') || s.startsWith('979')) && validIsbn13(s)) return s;
  if (s.length === 10 && validIsbn10(s)) return isbn10to13(s);
  return null;
}

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) return null;
    return r;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function getJson(url) {
  const r = await fetchWithTimeout(url);
  if (!r) return null;
  try { return await r.json(); } catch (e) { return null; }
}

function https(u) {
  return u ? String(u).replace(/^http:\/\//, 'https://') : u;
}

function gbCover(links) {
  if (!links) return null;
  const u = links.extraLarge || links.large || links.medium || links.small || links.thumbnail || links.smallThumbnail;
  if (!u) return null;
  return https(u).replace('&edge=curl', '');
}

// «Preußler, Otfried [Verfasser]» → «Otfried Preußler»
function flipName(s) {
  const clean = String(s || '').replace(/\[[^\]]*\]/g, '').replace(/\(.*?\)/g, '').trim();
  const m = clean.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2].trim()} ${m[1].trim()}` : clean;
}

function firstNumber(s) {
  const m = String(s || '').match(/(\d{2,4})\s*(S\.|Seiten|p\.|pages|стр)/i) || String(s || '').match(/(\d{2,4})/);
  return m ? Number(m[1]) : null;
}

async function fromGoogle(isbn) {
  const j = await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
  const v = j && j.items && j.items[0] && j.items[0].volumeInfo;
  if (!v) return null;
  return {
    title: v.title || '',
    author: (v.authors || []).join(', '),
    pages: v.pageCount || null,
    cover: gbCover(v.imageLinks),
  };
}

async function fromOpenLibrary(isbn) {
  const j = await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  const b = j && j['ISBN:' + isbn];
  if (!b) return null;
  return {
    title: b.title || '',
    author: (b.authors || []).map(a => a.name).join(', '),
    pages: b.number_of_pages || null,
    cover: b.cover ? https(b.cover.large || b.cover.medium) : null,
  };
}

// Разбор записи lobid.org (используется, если сервер когда-то начнёт пускать браузеры).
function lobidItem(x) {
  const sub = (x.otherTitleInformation || [])[0];
  const title = (x.title || '') + (sub && !/^(roman|erzählung|ein |eine |mit )/i.test(sub) ? ': ' + sub : '');
  const contrib = x.contribution || [];
  let authors = contrib.filter(c => /autor|verfasser/i.test((c.role && c.role.label) || ''));
  if (!authors.length) authors = contrib;
  const isbns = (x.isbn || []).map(normalizeIsbn).filter(Boolean);
  return {
    title: title.trim(),
    author: authors.map(c => flipName(c.agent && c.agent.label)).filter(Boolean).join(', '),
    pages: firstNumber(x.extent),
    isbn: isbns[0] || '',
    year: ((x.publication || [])[0] || {}).startDate || '',
    cover: null,
  };
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise(res => setTimeout(() => res(null), ms))]).catch(() => null);
}

// Проверяем, что картинка реально загружается и это не заглушка 1×1.
export function probeImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    const t = setTimeout(() => { img.src = ''; resolve(null); }, TIMEOUT);
    img.onload = () => {
      clearTimeout(t);
      resolve(img.naturalWidth > 40 && img.naturalHeight > 40 ? url : null);
    };
    img.onerror = () => { clearTimeout(t); resolve(null); };
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  });
}

// serverLookup — запрос через ваш Google-скрипт: он достаёт данные и обложку
// Немецкой национальной библиотеки (DNB), которые браузер напрямую получить не может.
export async function lookupIsbn(isbn, serverLookup) {
  const srvPromise = serverLookup ? withTimeout(serverLookup(isbn), 20000) : Promise.resolve(null);
  const [g, o, srv] = await Promise.all([fromGoogle(isbn), fromOpenLibrary(isbn), srvPromise]);
  const sources = [srv, g, o].filter(Boolean);
  const pickField = (f) => {
    for (const s of sources) if (s[f]) return s[f];
    return f === 'pages' ? null : '';
  };
  const coverUrls = [
    srv && srv.coverDataUrl,
    o && o.cover,
    `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
    g && g.cover,
    srv && srv.cover,
  ].filter(Boolean);
  const unique = [...new Set(coverUrls)];
  const checked = await Promise.all(unique.map(probeImage));
  return {
    found: sources.length > 0,
    isbn,
    title: pickField('title'),
    author: pickField('author'),
    pages: pickField('pages'),
    covers: checked.filter(Boolean),
  };
}

// Поиск по названию. serverSearch — через ваш Google-скрипт (каталог немецких библиотек lobid).
export async function searchByTitle(query, serverSearch) {
  const q = encodeURIComponent(query.trim());
  const [g, srv] = await Promise.all([
    getJson(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=15&printType=books`),
    serverSearch ? withTimeout(serverSearch(query.trim()), 20000) : Promise.resolve(null),
  ]);
  const out = [];
  const seen = new Set();
  const add = (it) => {
    if (!it.title) return;
    const key = it.isbn || (it.title + '|' + it.author);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(it);
  };
  for (const it of (g && g.items) || []) {
    const v = it.volumeInfo || {};
    const ids = v.industryIdentifiers || [];
    const isbn13 = (ids.find(x => x.type === 'ISBN_13') || {}).identifier || '';
    const isbn10 = (ids.find(x => x.type === 'ISBN_10') || {}).identifier || '';
    add({
      title: v.title || '',
      author: (v.authors || []).join(', '),
      pages: v.pageCount || null,
      isbn: normalizeIsbn(isbn13) || normalizeIsbn(isbn10) || '',
      cover: gbCover(v.imageLinks),
      year: (v.publishedDate || '').slice(0, 4),
    });
  }
  for (const it of srv || []) add({ ...it, isbn: normalizeIsbn(it.isbn) || '', cover: null });
  if (out.length < 3) {
    const o = await getJson(`https://openlibrary.org/search.json?q=${q}&limit=12&fields=title,author_name,number_of_pages_median,isbn,cover_i,first_publish_year`);
    for (const d of (o && o.docs) || []) {
      add({
        title: d.title || '',
        author: (d.author_name || []).join(', '),
        pages: d.number_of_pages_median || null,
        isbn: ((d.isbn || []).map(normalizeIsbn).find(Boolean)) || '',
        cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
        year: d.first_publish_year ? String(d.first_publish_year) : '',
      });
    }
  }
  return out.slice(0, 20);
}

// Пытаемся скачать обложку себе в телефон (получится, если сайт это разрешает).
export async function downloadImage(url) {
  const r = await fetchWithTimeout(url, { mode: 'cors', referrerPolicy: 'no-referrer' });
  if (!r) return null;
  try {
    const blob = await r.blob();
    if (!blob.type.startsWith('image/') || blob.size < 1000) return null;
    return blob;
  } catch (e) {
    return null;
  }
}

// Уменьшаем фото с камеры: длинная сторона до 1200 px, JPEG.
export async function shrinkPhoto(file, maxSide = 1200) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return await new Promise((res) => canvas.toBlob(b => res(b || file), 'image/jpeg', 0.86));
  } catch (e) {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
