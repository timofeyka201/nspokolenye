// Интеграция с Telegram Mini App. В обычном браузере все функции тихо ничего не делают.
const WA = window.Telegram?.WebApp;
export const tg = WA && WA.initData ? WA : null;
export const isTelegram = !!tg;

const ver = (v) => !!tg && tg.isVersionAtLeast?.(v);

export function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  try {
    if (ver('6.1')) { tg.setHeaderColor('#ffffff'); tg.setBackgroundColor('#ffffff'); }
    if (ver('7.10')) tg.setBottomBarColor('#ffffff');
    if (ver('7.7')) tg.disableVerticalSwipes();
  } catch { /* старые клиенты */ }
  document.documentElement.classList.add('in-telegram');
}

export const startParam = () => tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('tgWebAppStartParam') || '';

export const haptic = {
  tap: () => ver('6.1') && tg.HapticFeedback.impactOccurred('light'),
  soft: () => ver('6.1') && tg.HapticFeedback.impactOccurred('soft'),
  select: () => ver('6.1') && tg.HapticFeedback.selectionChanged(),
  success: () => ver('6.1') && tg.HapticFeedback.notificationOccurred('success'),
  error: () => ver('6.1') && tg.HapticFeedback.notificationOccurred('error'),
  warning: () => ver('6.1') && tg.HapticFeedback.notificationOccurred('warning'),
};

let backHandler = null;
export function setBackButton(fn) {
  if (!ver('6.1')) return;
  if (backHandler) tg.BackButton.offClick(backHandler);
  backHandler = fn;
  if (fn) { tg.BackButton.onClick(fn); tg.BackButton.show(); } else tg.BackButton.hide();
}

export function openLink(url) {
  if (!url) return;
  if (/^https?:\/\/t\.me\//.test(url)) {
    if (tg) return tg.openTelegramLink(url);
    return window.open(url, '_blank', 'noopener');
  }
  if (tg && /^https?:/.test(url)) return tg.openLink(url);
  if (/^(webcal|tg):/.test(url)) { location.href = url; return; }
  window.open(url, '_blank', 'noopener');
}

// Скачать файл (.ics): в Telegram — системным диалогом, в браузере — обычной ссылкой
export function downloadFile(url, name) {
  if (ver('8.0') && tg.downloadFile) {
    try { return tg.downloadFile({ url, file_name: name }); } catch { /* ниже — запасной путь */ }
  }
  if (tg) return tg.openLink(url);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

export const canScanQr = () => ver('6.4');
export function scanQr(text) {
  return new Promise((resolve) => {
    if (!canScanQr()) return resolve(null);
    tg.showScanQrPopup({ text }, (value) => { resolve(value); return true; });
    tg.onEvent('scanQrPopupClosed', function h() { tg.offEvent('scanQrPopupClosed', h); resolve(null); });
  });
}

export function shareUrl(url, text = '') {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (tg) return tg.openTelegramLink(share);
  if (navigator.share) return navigator.share({ url, text }).catch(() => {});
  return window.open(share, '_blank', 'noopener');
}
