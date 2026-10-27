// Поиск книги по ISBN (штрихкоду) и по названию.
// Источники: каталог немецких библиотек K10plus, Google Books, Open Library,
// запасной — ваш Google-скрипт (DNB). Обложки: Open Library, Google Books или своё фото.

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

async function fetchWithTimeout(url, opts = {}, ms = TIMEOUT) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
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
    publisher: v.publisher || '',
    year: (v.publishedDate || '').slice(0, 4),
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
    publisher: ((b.publishers || [])[0] || {}).name || '',
    year: (String(b.publish_date || '').match(/\d{4}/) || [''])[0],
    cover: b.cover ? https(b.cover.large || b.cover.medium) : null,
  };
}

// K10plus — общий каталог немецких библиотек (GBV/SWB, около 80 млн записей).
// Открытый интерфейс SRU, разрешает запросы прямо из браузера.
const K10 = 'https://sru.k10plus.de/opac-de-627?version=1.1&operation=searchRetrieve&recordSchema=marcxml';

function marcSub(df, code) {
  const sf = Array.from(df.getElementsByTagNameNS('*', 'subfield')).find(x => x.getAttribute('code') === code);
  return sf ? sf.textContent.trim() : '';
}

function marcRecord(rec) {
  const fields = (tag) => Array.from(rec.getElementsByTagNameNS('*', 'datafield')).filter(d => d.getAttribute('tag') === tag);
  const f245 = fields('245')[0];
  if (!f245) return null;
  let title = marcSub(f245, 'a');
  const sub = marcSub(f245, 'b');
  if (sub && !/^(roman|erzählung|ein |eine |mit )/i.test(sub)) title += ': ' + sub;
  title = title.replace(/\s*[/:;,.]\s*$/, '').replace(/\s+/g, ' ').trim();
  let authors = fields('100').map(d => flipName(marcSub(d, 'a')));
  if (!authors.length) {
    authors = fields('700').filter(d => /aut/.test(marcSub(d, '4')) || /verfasser/i.test(marcSub(d, 'e'))).map(d => flipName(marcSub(d, 'a')));
  }
  const isbn = fields('020').map(d => normalizeIsbn(marcSub(d, 'a'))).find(Boolean) || '';
  const extent = fields('300').map(d => marcSub(d, 'a')).join(' ');
  const yearField = fields('264')[0] || fields('260')[0];
  const year = yearField ? (marcSub(yearField, 'c').match(/\d{4}/) || [''])[0] : '';
  const publisher = yearField ? marcSub(yearField, 'b').replace(/[\[\]]/g, '').replace(/\s*[,:;]\s*$/, '').trim() : '';
  return { title, author: authors.filter(Boolean).join(', '), pages: firstNumber(extent), publisher, isbn, year, cover: null };
}

async function k10Query(cql, max) {
  const r = await fetchWithTimeout(`${K10}&maximumRecords=${max}&query=${encodeURIComponent(cql)}`, {}, 20000);
  if (!r) return [];
  try {
    const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
    return Array.from(xml.getElementsByTagNameNS('*', 'record'))
      .filter(x => x.getElementsByTagNameNS('*', 'datafield').length)
      .map(marcRecord).filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function fromK10(isbn) {
  const list = await k10Query(`pica.isb=${isbn}`, 1);
  return list[0] || null;
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

// serverLookup — запасной поиск через ваш Google-скрипт (DNB, Google Books).
export async function lookupIsbn(isbn, serverLookup) {
  const [k, g, o] = await Promise.all([fromK10(isbn), fromGoogle(isbn), fromOpenLibrary(isbn)]);
  let srv = null;
  if (!k && !g && !o && serverLookup) srv = await withTimeout(serverLookup(isbn), 20000);
  const sources = [k, g, o, srv].filter(Boolean);
  const pickField = (f) => {
    for (const s of sources) if (s[f]) return s[f];
    return f === 'pages' ? null : '';
  };
  const coverUrls = [
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
    publisher: pickField('publisher'),
    year: pickField('year'),
    covers: checked.filter(Boolean),
  };
}

// Поиск по названию: Google Books + каталог немецких библиотек K10plus + Open Library.
export async function searchByTitle(query) {
  const text = query.trim();
  const q = encodeURIComponent(text);
  const words = text.replace(/["()]/g, ' ').split(/\s+/).filter(Boolean).join(' ');
  const [g, k] = await Promise.all([
    getJson(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=15&printType=books`),
    k10Query(`pica.all="${words}"`, 25),
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
  for (const it of k) if (it.isbn) add(it);
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
  // самые похожие на запрос — наверх
  const norm = (x) => String(x || '').toLowerCase().replace(/ß/g, 'ss');
  const qw = norm(text).split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1);
  const score = (it) => {
    const t = norm(it.title), a = norm(it.author);
    return qw.reduce((s, w) => s + (t.includes(w) ? 2 : 0) + (a.includes(w) ? 1 : 0), 0) + (it.cover ? 0.5 : 0);
  };
  return out.map((it, i) => ({ it, i, s: score(it) }))
    .sort((x, y) => y.s - x.s || x.i - y.i)
    .map(x => x.it)
    .slice(0, 20);
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
