/**
 * Книжная летопись — хранилище в вашем Google Drive.
 *
 * Как установить (один раз, ~5 минут):
 *  1. Создайте новую Google Таблицу (sheets.new), назовите «Книжная летопись».
 *  2. В таблице: Расширения → Apps Script. Удалите весь код и вставьте этот файл целиком. Сохраните.
 *  3. Вверху выберите функцию «setup» и нажмите «Выполнить». Разрешите доступ
 *     (если Google пишет «Приложение не проверено»: Дополнительно → Перейти на страницу проекта).
 *  4. «Начать развёртывание» → «Новое развёртывание» → шестерёнка → «Веб-приложение».
 *     Запуск от имени: «Я». У кого есть доступ: «Все». → «Начать развёртывание». Скопируйте URL.
 *  5. В приложении, раздел «Хранилище»: вставьте URL и ключ из листа «Настройки» этой таблицы.
 *
 * Что где лежит:
 *  - Эта таблица, лист «Книги»   — все книги, по строке на книгу (с картинкой обложки).
 *  - Лист «Чтение»               — сеансы чтения с таймером и бусинки.
 *  - Папка Drive «Книжная летопись/Обложки» и «…/Голос» — картинки и записи.
 *
 * Данные никуда больше не отправляются: скрипт работает от вашего имени в вашем аккаунте.
 */

var SCRIPT_VERSION = 3; // меняется, когда обновляется код скрипта
var APP_FOLDER = 'Книжная летопись';
var COVERS_FOLDER = 'Обложки';
var VOICE_FOLDER = 'Голос';
// Обложки открываются «по ссылке», чтобы их было видно прямо в таблице.
// Поставьте false, если не хотите этого (тогда в таблице будет только ссылка).
var SHARE_COVERS = true;

var BOOK_HEADERS = ['id', 'Дата', 'Кто читал', 'Название', 'Автор', 'Страниц', 'ISBN', 'Оценка', 'Заметка', 'Откуда',
  'Обложка', 'Файл обложки', 'Голос', 'Минут с таймером', 'Добавлено', 'Изменено', 'Удалено', 'data'];
var SESSION_HEADERS = ['id', 'Дата', 'Начало', 'Кто читал', 'Минут', 'Бусинок', 'Книга', 'id книги', 'Секунд'];

var WHO = { mama: 'Мама', alexandra: 'Александра', together: 'Вместе' };
var SOURCES = { library: 'Библиотека', own: 'Своя', gift: 'Подарок', school: 'Школа', other: 'Другое' };
var RATINGS = { 0: '', 1: 'Не понравилось', 2: 'Так себе', 3: 'Понравилось', 4: 'Очень понравилось' };

// ---------------------------------------------------------------- установка
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Откройте этот скрипт из Google Таблицы: Расширения → Apps Script.');
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());

  var root = getOrCreateFolder_(DriveApp.getRootFolder(), APP_FOLDER);
  var covers = getOrCreateFolder_(root, COVERS_FOLDER);
  var voice = getOrCreateFolder_(root, VOICE_FOLDER);
  props.setProperty('ROOT_ID', root.getId());
  props.setProperty('COVERS_ID', covers.getId());
  props.setProperty('VOICE_ID', voice.getId());
  try { DriveApp.getFileById(ss.getId()).moveTo(root); } catch (e) { /* уже там */ }

  ensureSheets_(ss);

  var token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '').slice(0, 24);
    props.setProperty('TOKEN', token);
  }
  var s = ss.getSheetByName('Настройки') || ss.insertSheet('Настройки');
  s.clear();
  s.getRange('A1:B4').setValues([
    ['Ключ доступа для приложения', token],
    ['Папка на Google Drive', root.getUrl()],
    ['Как пользоваться', 'Скопируйте ключ из B1 в приложение: раздел «Хранилище» → «Ключ доступа».'],
    ['Важно', 'Не показывайте ключ посторонним. Новый ключ: удалите TOKEN в настройках скрипта и запустите setup ещё раз.'],
  ]);
  s.getRange('A1:A4').setFontWeight('bold');
  s.setColumnWidth(1, 240);
  s.setColumnWidth(2, 520);
  Logger.log('Готово! Ключ для приложения: ' + token);
  Logger.log('Теперь: Начать развёртывание → Новое развёртывание → Веб-приложение, доступ «Все».');
}

function ensureSheets_(ss) {
  var books = ss.getSheetByName('Книги');
  if (!books) {
    books = ss.getSheets()[0];
    if (books.getLastRow() > 0 || books.getName() === 'Настройки' || books.getName() === 'Чтение') books = ss.insertSheet('Книги');
    else books.setName('Книги');
  }
  if (books.getLastRow() === 0) {
    books.getRange(1, 1, 1, BOOK_HEADERS.length).setValues([BOOK_HEADERS]).setFontWeight('bold').setBackground('#1F2A5A').setFontColor('#FFFFFF');
    books.setFrozenRows(1);
    var widths = [60, 95, 100, 220, 160, 70, 120, 140, 280, 100, 110, 110, 110, 90, 140, 140, 110, 60];
    for (var i = 0; i < widths.length; i++) books.setColumnWidth(i + 1, widths[i]);
    books.hideColumns(1);
    books.hideColumns(BOOK_HEADERS.length);
    books.getRange('I:I').setWrap(true);
  }
  var sess = ss.getSheetByName('Чтение');
  if (!sess) {
    sess = ss.insertSheet('Чтение');
    sess.getRange(1, 1, 1, SESSION_HEADERS.length).setValues([SESSION_HEADERS]).setFontWeight('bold').setBackground('#C2571B').setFontColor('#FFFFFF');
    sess.setFrozenRows(1);
    sess.hideColumns(1);
    sess.setColumnWidth(7, 240);
  }
}

function getOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// ---------------------------------------------------------------- веб-приложение
function doGet() {
  return json_({ ok: true, app: 'Книжная летопись', hint: 'Скрипт работает. Данные принимаются только через приложение.' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('TOKEN');
    if (!token) return json_({ ok: false, error: 'Скрипт не настроен: запустите функцию setup в редакторе.' });
    if (p.token !== token) return json_({ ok: false, error: 'Неверный ключ доступа. Возьмите его из листа «Настройки».' });

    lock.waitLock(25000);
    switch (p.action) {
      case 'ping': return json_({ ok: true, sheetName: ss_().getName(), version: SCRIPT_VERSION });
      case 'upsertBook': return json_(upsertBook_(p));
      case 'upsertSession': return json_(upsertSession_(p.session));
      case 'list': return json_(list_());
      case 'file': return json_(file_(p.id));
      case 'lookup': return json_({ ok: true, book: lookup_(p.isbn) });
      case 'search': return json_({ ok: true, items: search_(p.q) });
      default: return json_({ ok: false, error: 'Неизвестное действие: ' + p.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) { /* ignore */ }
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function folder_(key) {
  return DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty(key));
}

function findRow_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

// ---------------------------------------------------------------- книги
function upsertBook_(p) {
  var b = p.book;
  if (!b || !b.id) throw new Error('Нет данных книги');
  var ss = ss_();
  var sheet = ss.getSheetByName('Книги');
  var row = findRow_(sheet, b.id);
  var prev = {};
  if (row > 0) {
    try { prev = JSON.parse(sheet.getRange(row, BOOK_HEADERS.length).getValue() || '{}'); } catch (e) { prev = {}; }
  }
  var prevDrive = prev.drive || {};
  var coverId = prevDrive.coverId || '';
  var audioId = prevDrive.audioId || '';
  var safeName = String(b.date || '') + ' ' + String(b.title || 'книга').replace(/[\\/:*?"<>|]/g, '').slice(0, 60);

  // обложка
  var coverBlob = null;
  if (p.coverDataUrl) coverBlob = dataUrlToBlob_(p.coverDataUrl, safeName);
  else if (p.coverUrl) coverBlob = fetchImage_(p.coverUrl, safeName);
  if (coverBlob) {
    var cf = folder_('COVERS_ID').createFile(coverBlob);
    if (SHARE_COVERS) {
      try { cf.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* аккаунт может запрещать */ }
    }
    if (coverId && coverId !== cf.getId()) trash_(coverId);
    coverId = cf.getId();
  }

  // голос
  if (p.audioDataUrl) {
    var ext = /mp4|m4a|aac/.test(p.audioMime || '') ? '.m4a' : (/ogg/.test(p.audioMime || '') ? '.ogg' : '.webm');
    var af = folder_('VOICE_ID').createFile(dataUrlToBlob_(p.audioDataUrl, safeName + ext));
    if (audioId && audioId !== af.getId()) trash_(audioId);
    audioId = af.getId();
  } else if (p.removeAudio && audioId) {
    trash_(audioId);
    audioId = '';
  }

  b.drive = { coverId: coverId, audioId: audioId };
  if (row < 0) row = sheet.getLastRow() + 1;

  var coverFormula = '';
  if (coverId && SHARE_COVERS) coverFormula = '=IMAGE("https://drive.google.com/thumbnail?id=' + coverId + '&sz=w400")';
  else if (b.coverUrl) coverFormula = '=IMAGE("' + String(b.coverUrl).replace(/"/g, '') + '")';

  var values = [
    b.id,
    b.date || '',
    WHO[b.who] || b.who || '',
    b.title || '',
    b.author || '',
    b.pages || '',
    b.isbn ? "'" + b.isbn : '',
    RATINGS[b.rating || 0] || '',
    b.note || '',
    SOURCES[b.source] || b.source || '',
    '', // формула обложки ставится отдельно
    coverId ? 'https://drive.google.com/file/d/' + coverId + '/view' : (b.coverUrl || ''),
    audioId ? 'https://drive.google.com/file/d/' + audioId + '/view' : '',
    '', // формула минут
    fmtTs_(b.createdAt),
    fmtTs_(b.updatedAt),
    b.deleted ? fmtTs_(b.deleted) : '',
    JSON.stringify(b),
  ];
  sheet.getRange(row, 1, 1, values.length).setValues([values]);
  if (coverFormula) sheet.getRange(row, 11).setFormula(coverFormula);
  sheet.getRange(row, 14).setFormula('=IFERROR(ROUND(SUMIF(\'Чтение\'!H:H,A' + row + ',\'Чтение\'!I:I)/60),0)');
  sheet.setRowHeight(row, 120);
  var bg = b.deleted ? '#EEEEEE' : null;
  sheet.getRange(row, 1, 1, values.length).setBackground(bg).setFontColor(b.deleted ? '#999999' : null);
  return { ok: true, coverId: coverId, audioId: audioId };
}

function dataUrlToBlob_(dataUrl, name) {
  var m = String(dataUrl).match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!m) throw new Error('Неверный файл');
  var mime = m[1] || 'application/octet-stream';
  var bytes = Utilities.base64Decode(m[3]);
  var ext = mime.indexOf('jpeg') >= 0 ? '.jpg' : (mime.indexOf('png') >= 0 ? '.png' : (mime.indexOf('webp') >= 0 ? '.webp' : ''));
  var finalName = /\.[a-z0-9]{2,4}$/i.test(name) ? name : name + ext;
  return Utilities.newBlob(bytes, mime, finalName);
}

function fetchImage_(url, name) {
  try {
    var r = get_(url);
    if (!r || r.getResponseCode() !== 200) return null;
    var blob = r.getBlob();
    var type = blob.getContentType() || '';
    if (type.indexOf('image/') !== 0 || blob.getBytes().length < 1000) return null;
    var ext = type.indexOf('png') >= 0 ? '.png' : '.jpg';
    blob.setName(name + ext);
    return blob;
  } catch (e) {
    return null;
  }
}

function trash_(id) {
  try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* уже нет */ }
}

function fmtTs_(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

// ---------------------------------------------------------------- сеансы чтения
function upsertSession_(s) {
  if (!s || !s.id) throw new Error('Нет данных сеанса');
  var sheet = ss_().getSheetByName('Чтение');
  var row = findRow_(sheet, s.id);
  if (row < 0) row = sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, SESSION_HEADERS.length).setValues([[
    s.id,
    s.date || '',
    fmtTs_(s.startedAt),
    WHO[s.who] || s.who || '',
    Math.round((s.seconds || 0) / 60),
    s.beads || 0,
    s.bookTitle || '',
    s.bookId || '',
    s.seconds || 0,
  ]]);
  return { ok: true };
}

// ---------------------------------------------------------------- восстановление
function list_() {
  var ss = ss_();
  var books = [];
  var bs = ss.getSheetByName('Книги');
  if (bs.getLastRow() > 1) {
    var vals = bs.getRange(2, BOOK_HEADERS.length, bs.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      try { if (vals[i][0]) books.push(JSON.parse(vals[i][0])); } catch (e) { /* пропускаем */ }
    }
  }
  var sessions = [];
  var ses = ss.getSheetByName('Чтение');
  if (ses.getLastRow() > 1) {
    var rows = ses.getRange(2, 1, ses.getLastRow() - 1, SESSION_HEADERS.length).getValues();
    var whoBack = { 'Мама': 'mama', 'Александра': 'alexandra', 'Вместе': 'together' };
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      if (!r[0]) continue;
      var dateStr = r[1] instanceof Date ? Utilities.formatDate(r[1], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r[1]);
      var startStr = r[2] instanceof Date ? r[2].toISOString() : String(r[2]);
      sessions.push({
        id: String(r[0]), date: dateStr, startedAt: startStr, who: whoBack[r[3]] || r[3],
        seconds: Number(r[8]) || Number(r[4]) * 60 || 0, beads: Number(r[5]) || 0,
        bookTitle: String(r[6] || ''), bookId: String(r[7] || ''),
      });
    }
  }
  return { ok: true, books: books, sessions: sessions };
}

function file_(id) {
  var f = DriveApp.getFileById(id);
  // отдаём только файлы из папок летописи
  var allowed = [PropertiesService.getScriptProperties().getProperty('COVERS_ID'), PropertiesService.getScriptProperties().getProperty('VOICE_ID')];
  var parents = f.getParents();
  var ok = false;
  while (parents.hasNext()) if (allowed.indexOf(parents.next().getId()) >= 0) ok = true;
  if (!ok) throw new Error('Файл не из летописи');
  var blob = f.getBlob();
  return { ok: true, mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

// ---------------------------------------------------------------- поиск книг
// Поиск идёт отсюда, а не из телефона: каталоги немецких библиотек
// не пускают браузеры (защита от ботов), а скрипт пускают.

var UA = 'KnizhnayaLetopis/1.0 (+https://github.com/LysenkoL/knizhnaya-letopis)';

function get_(url) {
  try {
    return UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': UA, 'Accept': 'application/json, application/xml, image/*;q=0.9, */*;q=0.5' } });
  } catch (e) {
    return null;
  }
}

function getJson_(url) {
  var r = get_(url);
  if (!r || r.getResponseCode() !== 200) return null;
  try { return JSON.parse(r.getContentText()); } catch (e) { return null; }
}

function firstNumber_(s) {
  var m = String(s || '').match(/(\d{2,4})\s*(S\.|Seiten|p\.|pages)/i) || String(s || '').match(/(\d{2,4})/);
  return m ? Number(m[1]) : null;
}

function lobidItem_(x) {
  var sub = (x.otherTitleInformation || [])[0];
  var title = (x.title || '') + (sub && !/^(roman|erzählung|ein |eine |mit )/i.test(sub) ? ': ' + sub : '');
  var contrib = x.contribution || [];
  var authors = contrib.filter(function (c) { return /autor|verfasser/i.test((c.role && c.role.label) || ''); });
  if (!authors.length) authors = contrib;
  var isbn = '';
  (x.isbn || []).forEach(function (i) { if (!isbn && /^97[89]\d{10}$/.test(i)) isbn = i; });
  return {
    title: String(title).trim(),
    author: authors.map(function (c) { return flipName_(c.agent && c.agent.label); }).filter(String).join(', '),
    pages: firstNumber_(x.extent),
    isbn: isbn,
    year: ((x.publication || [])[0] || {}).startDate || '',
  };
}

function lookup_(isbn) {
  isbn = String(isbn || '').replace(/[^0-9X]/gi, '');
  if (!isbn) return null;
  var meta = null;

  // 1. lobid.org — общий каталог немецких библиотек
  var l = getJson_('https://lobid.org/resources/search?q=isbn:' + isbn + '&format=json&size=1');
  if (l && l.member && l.member[0]) meta = lobidItem_(l.member[0]);

  // 2. Немецкая национальная библиотека (DNB)
  if (!meta || !meta.title) {
    var r = get_('https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&query=num%3D' + isbn + '&recordSchema=oai_dc&maximumRecords=1');
    if (r && r.getResponseCode() === 200) {
      var x = r.getContentText();
      var title = (x.match(/<dc:title>([\s\S]*?)<\/dc:title>/) || [])[1] || '';
      var creators = [];
      var re = /<dc:creator>([\s\S]*?)<\/dc:creator>/g, m;
      while ((m = re.exec(x))) creators.push(flipName_(m[1]));
      var format = (x.match(/<dc:format>([\s\S]*?)<\/dc:format>/) || [])[1] || '';
      if (title) meta = { title: decode_(title.split(' / ')[0]), author: decode_(creators.join(', ')), pages: firstNumber_(format) };
    }
  }

  // 3. Google Books
  var gCover = '';
  var g = getJson_('https://www.googleapis.com/books/v1/volumes?q=isbn:' + isbn);
  var v = g && g.items && g.items[0] && g.items[0].volumeInfo;
  if (v) {
    if (!meta || !meta.title) meta = { title: v.title || '', author: (v.authors || []).join(', '), pages: v.pageCount || null };
    if (meta && !meta.pages && v.pageCount) meta.pages = v.pageCount;
    if (v.imageLinks) gCover = String(v.imageLinks.thumbnail || '').replace('http://', 'https://').replace('&edge=curl', '');
  }

  meta = meta || { title: '', author: '', pages: null };
  meta.cover = gCover;

  // 4. Обложка из каталога DNB (немецкие издательства) — отдаём картинкой
  var c = get_('https://portal.dnb.de/opac/mvb/cover?isbn=' + isbn);
  if (c && c.getResponseCode() === 200) {
    var type = String(c.getHeaders()['Content-Type'] || '');
    var bytes = c.getContent();
    if (type.indexOf('image/') === 0 && bytes.length > 2000) {
      meta.coverDataUrl = 'data:image/jpeg;base64,' + Utilities.base64Encode(bytes);
    }
  }
  if (!meta.title && !meta.coverDataUrl && !meta.cover) return null;
  return meta;
}

function search_(q) {
  q = String(q || '').trim();
  if (q.length < 2) return [];
  var out = [];
  var seen = {};
  var l = getJson_('https://lobid.org/resources/search?q=' + encodeURIComponent(q) + '&format=json&size=25&filter=' + encodeURIComponent('type:Book AND _exists_:isbn'));
  ((l && l.member) || []).forEach(function (x) {
    var it = lobidItem_(x);
    if (!it.title || out.length >= 15) return;
    var key = it.isbn || (it.title + '|' + it.author);
    if (seen[key]) return;
    seen[key] = true;
    out.push(it);
  });
  return out;
}

function flipName_(s) {
  var clean = String(s || '').replace(/\[[^\]]*\]/g, '').replace(/\(.*?\)/g, '').trim();
  var m = clean.match(/^([^,]+),\s*(.+)$/);
  return m ? m[2].trim() + ' ' + m[1].trim() : clean;
}

function decode_(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

// Проверка поиска: выберите эту функцию вверху и нажмите «Выполнить», результат — в журнале.
function testLookup() {
  var r = lookup_('9783401716787');
  Logger.log(r ? ('Найдено: ' + r.title + ' — ' + r.author + ', ' + r.pages + ' стр., обложка: ' + (r.coverDataUrl ? 'есть' : 'нет')) : 'Ничего не найдено');
  Logger.log('Поиск по названию: ' + search_('kleine Hexe Preußler').slice(0, 3).map(function (x) { return x.title; }).join(' | '));
}
