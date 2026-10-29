// Посредник для Telegram Bot API на Cloudflare Workers — нужен, если хостинг сервера не пускает к api.telegram.org.
// Как подключить:
//   1. dash.cloudflare.com → Workers & Pages → Create → Worker → вставить этот код → Deploy.
//   2. В BOT_ID ниже вписать первую часть токена бота (цифры до двоеточия) — чужие боты через посредника не пройдут.
//   3. На сервере в /etc/pokolenie/env добавить строку TELEGRAM_API_ROOT=https://<имя>.<аккаунт>.workers.dev
//      и выполнить: systemctl restart pokolenie
const BOT_ID = '123456789';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`/bot${BOT_ID}:`) && !url.pathname.startsWith(`/file/bot${BOT_ID}:`)) {
      return new Response('Not found', { status: 404 });
    }
    url.hostname = 'api.telegram.org';
    url.port = '';
    return fetch(new Request(url, request));
  },
};
