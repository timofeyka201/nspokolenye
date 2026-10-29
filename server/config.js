// Настройки берутся из переменных окружения (на сервере — файл /etc/pokolenie/env)
const list = (s) => (s || '').split(/[,\s]+/).filter(Boolean);

export const config = {
  port: +process.env.PORT || 3100,
  // кавычки и пробелы вокруг токена в файле настроек — частая ошибка, убираем их
  botToken: (process.env.BOT_TOKEN || '').trim().replace(/^['"]|['"]$/g, ''),
  // Адрес сайта, например https://app.example.ru — нужен для кнопок Mini App и ссылок на календарь
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3100').replace(/\/$/, ''),
  // Telegram ID главных администраторов: могут создавать группы и назначать кураторов
  adminIds: list(process.env.ADMIN_TG_IDS).map(Number),
  // Вход без Telegram для проверки на своём компьютере. На сервере не включать!
  devLogin: process.env.DEV_LOGIN === '1',
  botUsername: process.env.BOT_USERNAME || '',
  // Если хостинг не пускает к api.telegram.org — адрес посредника (например, Cloudflare Worker, см. deploy/telegram-proxy-worker.js)
  telegramApiRoot: (process.env.TELEGRAM_API_ROOT || '').trim().replace(/\/$/, ''),
};
