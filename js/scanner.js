// Сканер штрихкода ISBN через камеру.
// На Android (Chrome) используется встроенный BarcodeDetector,
// на iPhone и в остальных браузерах — библиотека ZXing (лежит в папке vendor).
//
// Защита от ошибок: номер принимается, только когда один и тот же ISBN
// прочитан несколько раз подряд. Одиночное «чтение» с ошибкой отбрасывается.

import { normalizeIsbn } from './lookup.js';

const CONFIRM_READS = 3;   // столько одинаковых чтений нужно
const WINDOW = 8;          // из последних N чтений

const CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.ZXingBrowser) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Не удалось загрузить сканер'));
    document.head.appendChild(s);
  });
}

async function nativeDetector() {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    if (!supported.includes('ean_13')) return null;
    return new window.BarcodeDetector({ formats: ['ean_13'] });
  } catch (e) {
    return null;
  }
}

// onIsbn(isbn13) — когда номер надёжно подтверждён.
// onProgress(state) — 'reading' (номер виден, проверяю) или 'other' (это не ISBN).
// Возвращает функцию stop().
export async function startScanner(video, onIsbn, onProgress = () => {}) {
  let stopped = false;
  let stopFn = () => {};
  const recent = [];

  const handle = (text) => {
    if (stopped) return false;
    const raw = String(text || '').replace(/\D/g, '');
    const isbn = raw.length === 13 ? normalizeIsbn(raw) : null;
    if (!isbn) {
      if (raw.length) onProgress('other');
      return false;
    }
    recent.push(isbn);
    if (recent.length > WINDOW) recent.shift();
    const same = recent.filter(x => x === isbn).length;
    if (same >= CONFIRM_READS) {
      stopped = true;
      stopFn();
      onIsbn(isbn);
      return true;
    }
    onProgress('reading');
    return false;
  };

  const detector = await nativeDetector();
  if (detector) {
    const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play();
    let timer = null;
    stopFn = () => {
      stopped = true;
      clearTimeout(timer);
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    };
    const loop = async () => {
      if (stopped) return;
      try {
        const codes = await detector.detect(video);
        for (const c of codes) if (handle(c.rawValue)) return;
      } catch (e) { /* кадр не готов */ }
      timer = setTimeout(loop, 120);
    };
    loop();
    return () => stopFn();
  }

  await loadScript('vendor/zxing-browser.min.js');
  const Z = window.ZXingBrowser;
  // 2 = POSSIBLE_FORMATS, 3 = TRY_HARDER (константы ZXing)
  const hints = new Map([[2, [Z.BarcodeFormat.EAN_13]], [3, true]]);
  const reader = new Z.BrowserMultiFormatOneDReader(hints);
  video.setAttribute('playsinline', '');
  video.muted = true;
  const controls = await reader.decodeFromConstraints(CONSTRAINTS, video, (result) => {
    if (result) handle(result.getText());
  });
  stopFn = () => {
    stopped = true;
    try { controls.stop(); } catch (e) { /* ignore */ }
  };
  if (stopped) stopFn();
  return () => stopFn();
}

export function cameraAvailable() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}
