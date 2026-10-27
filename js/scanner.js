// Сканер штрихкода ISBN через камеру.
// На Android (Chrome) используется встроенный BarcodeDetector,
// на iPhone и в остальных браузерах — библиотека ZXing (лежит в папке vendor).

import { normalizeIsbn } from './lookup.js';

const CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
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
    const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter(f => supported.includes(f));
    return new window.BarcodeDetector({ formats });
  } catch (e) {
    return null;
  }
}

// onIsbn(isbn13) вызывается один раз, когда найден корректный ISBN.
// Возвращает функцию stop().
export async function startScanner(video, onIsbn, onOtherCode) {
  let stopped = false;
  let stopFn = () => {};
  const handle = (text) => {
    if (stopped) return false;
    const isbn = normalizeIsbn(text);
    if (isbn) {
      stopped = true;
      stopFn();
      onIsbn(isbn);
      return true;
    }
    if (onOtherCode) onOtherCode(text);
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
      timer = setTimeout(loop, 180);
    };
    loop();
    return () => stopFn();
  }

  await loadScript('vendor/zxing-browser.min.js');
  const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
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
