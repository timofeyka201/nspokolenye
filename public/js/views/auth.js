// Вход, первичное заполнение профиля и экран «нет группы»
import { html, useState, useEffect, api, store, setToken, storage, todayInput } from '../lib.js';
import { Button, Field, Icon, TagInput, TAG_SUGGESTIONS, AutoTextarea, attempt, toast, Toggle } from '../ui.js';
import { openLink, isTelegram, haptic } from '../tg.js';
import { boot } from '../app.js';

export const Logo = ({ size = 28 }) => html`<div class="logo" style=${size ? { fontSize: size + 'px' } : null}>Поколение</div>`;

function Orbs() {
  return html`<div class="orbs">
    <i style="width:520px;height:520px;right:-260px;top:-180px"></i>
    <i style="width:380px;height:380px;left:-220px;bottom:-120px;opacity:.7"></i>
  </div>`;
}

export function Splash() {
  return html`<div style="min-height:100dvh;display:grid;place-items:center"><div class="stack" style="align-items:center;gap:18px"><${Logo} size=${30} /><span class="spinner"></span></div></div>`;
}

export function Login() {
  const [cfg, setCfg] = useState(null);
  const [req, setReq] = useState(null);
  const [status, setStatus] = useState('');
  const [devName, setDevName] = useState('');
  const [devAdmin, setDevAdmin] = useState(true);

  useEffect(() => { api('/config').then(setCfg).catch(() => setCfg({})); }, []);

  // ждём, пока человек подтвердит вход в боте
  useEffect(() => {
    if (!req) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await api(`/auth/login/poll?token=${req.token}`);
        if (r.status === 'ok') { setToken(r.token); haptic.success(); await boot(); return; }
        if (r.status === 'expired') { setReq(null); setStatus('Ссылка устарела, попробуйте ещё раз'); return; }
      } catch { /* сеть — пробуем снова */ }
      setTimeout(tick, 2000);
    };
    setTimeout(tick, 2000);
    return () => { stop = true; };
  }, [req]);

  const start = async () => {
    const r = await attempt(() => api('/auth/login/start', { method: 'POST' }));
    if (!r) return;
    setReq(r);
    openLink(r.link);
  };

  const devLogin = async () => {
    const r = await attempt(() => api('/auth/dev', { method: 'POST', body: { name: devName || 'Тестовый Участник', admin: devAdmin, tgId: Math.abs(hash(devName || 'test')) } }));
    if (r) { setToken(r.token); await boot(); }
  };

  return html`<div class="login fade-in">
    <${Orbs} />
    <div class="stack" style="gap:18px;margin-top:6vh">
      <div class="hero-logo"><${Logo} size=${null} /></div>
      <div style="font-size:15px;font-weight:600;color:var(--label-2);margin-top:-6px">Всероссийский благотворительный проект по наставничеству для подростков 15–19 лет</div>
      <h1 style="font-size:30px;font-weight:750;letter-spacing:-.03em;line-height:1.15;margin-top:14px">Пространство твоей группы</h1>
      <div class="stack-sm muted" style="font-size:16px">
        ${[['calendar', 'Встречи и общий календарь'], ['target', 'Цели и прогресс'], ['coffee', 'Random Coffee и анонимные вопросы'], ['trophy', 'Активность и достижения']]
          .map(([i, t]) => html`<div class="row-flex" style="gap:10px"><span style="color:var(--accent-ink)"><${Icon} name=${i} size=${20} /></span>${t}</div>`)}
      </div>
    </div>

    <div class="stack">
      ${req ? html`<div class="card stack center" style="align-items:center">
          ${req.qr && html`<div class="qr-box" dangerouslySetInnerHTML=${{ __html: req.qr }}></div>`}
          <div class="card-title">Подтвердите вход в Telegram</div>
          <div class="card-sub">Откроется бот — нажмите «Войти на сайт». Эта страница обновится сама.</div>
          <div class="row-flex" style="justify-content:center;gap:10px;margin-top:4px"><span class="spinner"></span><span class="muted small">Ждём подтверждения…</span></div>
          <${Button} kind="secondary" block onClick=${() => openLink(req.link)}>Открыть бота ещё раз</${Button}>
        </div>`
        : html`<${Button} block icon="send" onClick=${start} disabled=${cfg && !cfg.botUsername}>Войти через Telegram</${Button}>`}
      ${status && html`<div class="hint center">${status}</div>`}
      ${cfg && !cfg.botUsername && !cfg.devLogin ? html`<div class="hint center">Бот ещё не подключён администратором.</div>` : null}
      <div class="hint center">Профиль подтверждается через Telegram — паролей нет.</div>
      ${cfg?.devLogin && html`<div class="card stack" style="margin-top:8px">
        <div class="card-title">Тестовый вход</div>
        <div class="hint" style="padding:0">Включён режим разработки (DEV_LOGIN=1). На сервере его быть не должно.</div>
        <input class="input" placeholder="Имя Фамилия" value=${devName} onInput=${(e) => setDevName(e.target.value)} />
        <div class="row-flex"><span class="spacer">Администратор</span><${Toggle} checked=${devAdmin} onChange=${setDevAdmin} /></div>
        <${Button} kind="secondary" onClick=${devLogin}>Войти</${Button}>
      </div>`}
    </div>
  </div>`;
}

function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h || 1; }

// ---------- Знакомство: профиль в 3 шага ----------
export function Onboarding() {
  const me = store.get().me;
  const u = me.user;
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    first_name: u.first_name || '', last_name: u.last_name || '', birthdate: u.birthdate || '',
    tags: u.tags || [], bio: u.bio || '', can_help: u.can_help || '', need_help: u.need_help || '',
  });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: typeof v === 'object' && v?.target ? v.target.value : v }));

  const save = async (finish) => {
    const r = await attempt(() => api('/me', { method: 'PATCH', body: { ...f, onboarded: finish } }));
    if (!r) return false;
    store.set({ me: r });
    return true;
  };
  const next = async () => {
    if (step === 0 && !f.first_name.trim()) return toast('Как тебя зовут?', { error: true });
    if (step < 2) { haptic.tap(); setStep(step + 1); window.scrollTo(0, 0); return; }
    if (await save(true)) { haptic.success(); await boot(); }
  };

  const steps = [
    html`<div class="stack" style="gap:6px">
        <h1 style="font-size:30px;font-weight:750;letter-spacing:-.03em">Давай знакомиться 👋</h1>
        <p class="muted">Это увидят ребята из группы и наставник.</p>
      </div>
      <div class="form">
        <${Field} label="Имя"><input class="input" value=${f.first_name} onInput=${set('first_name')} placeholder="Имя" autocomplete="given-name" /></${Field}>
        <${Field} label="Фамилия"><input class="input" value=${f.last_name} onInput=${set('last_name')} placeholder="Фамилия" autocomplete="family-name" /></${Field}>
        <${Field} label="Дата рождения" hint="Другие увидят только день и месяц — чтобы поздравить 🎂">
          <input class="input" type="date" value=${f.birthdate} max=${todayInput()} onInput=${set('birthdate')} />
        </${Field}>
      </div>`,
    html`<div class="stack" style="gap:6px">
        <h1 style="font-size:30px;font-weight:750;letter-spacing:-.03em">Чем ты живёшь? ✨</h1>
        <p class="muted">Интересы помогут найти единомышленников и пару для Random Coffee.</p>
      </div>
      <div class="form">
        <${Field} label="Интересы"><${TagInput} value=${f.tags} onChange=${set('tags')} suggestions=${TAG_SUGGESTIONS} /></${Field}>
        <${Field} label="О себе"><${AutoTextarea} value=${f.bio} onInput=${set('bio')} placeholder="Пара предложений о себе: учёба, увлечения, мечты" maxLength=${1000} /></${Field}>
      </div>`,
    html`<div class="stack" style="gap:6px">
        <h1 style="font-size:30px;font-weight:750;letter-spacing:-.03em">Помогаем друг другу 🤝</h1>
        <p class="muted">Сервис подскажет, кто в группе может помочь тебе — и кому можешь помочь ты.</p>
      </div>
      <div class="form">
        <${Field} label="Чем могу помочь"><${AutoTextarea} value=${f.can_help} onInput=${set('can_help')} placeholder="Например: подтянуть английский, смонтировать видео, разобраться в Figma" maxLength=${500} /></${Field}>
        <${Field} label="В чём ищу помощь"><${AutoTextarea} value=${f.need_help} onInput=${set('need_help')} placeholder="Например: подготовка к ЕГЭ по профильной математике, выбор вуза" maxLength=${500} /></${Field}>
      </div>`,
  ];

  return html`<div class="login" style="justify-content:flex-start;gap:24px">
    <${Orbs} />
    <div class="row-flex" style="justify-content:space-between">
      ${step > 0 ? html`<button class="nav-btn nav-back" onClick=${() => setStep(step - 1)}><${Icon} name="chevron-left" /> Назад</button>` : html`<${Logo} size=${18} />`}
      <div class="steps">${[0, 1, 2].map((i) => html`<i class=${i <= step ? 'on' : ''}></i>`)}</div>
    </div>
    <div class="stack page-enter" key=${step} style="gap:22px">${steps[step]}</div>
    <div class="spacer"></div>
    <div class="stack">
      <${Button} block onClick=${next}>${step < 2 ? 'Дальше' : 'Готово'}</${Button}>
      ${step > 0 && html`<button class="btn plain" onClick=${next}>${step < 2 ? 'Пропустить' : ''}</button>`}
    </div>
  </div>`;
}

// ---------- Нет активной группы ----------
export function NoGroup() {
  const me = store.get().me;
  const pending = me.groups.filter((g) => g.status === 'pending');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const join = async () => {
    const c = code.trim().replace(/^.*join[_/]/, '');
    if (!c) return;
    const r = await attempt(() => api('/join', { method: 'POST', body: { code: c } }));
    if (!r) return;
    store.set({ me: r.me });
    toast(r.status === 'active' ? `Вы в группе «${r.group.name}»` : 'Заявка отправлена');
    await boot();
  };
  const create = async () => {
    if (!name.trim()) return;
    const r = await attempt(() => api('/groups', { method: 'POST', body: { name } }));
    if (r) { storage.set('pk_gid', String(r.id)); await boot(); }
  };

  return html`<div class="login" style="justify-content:flex-start">
    <${Orbs} />
    <${Logo} size=${18} />
    ${pending.length ? html`<div class="empty" style="padding-top:8vh">
        <div class="em">⏳</div>
        <h3>Заявка на рассмотрении</h3>
        <p>Команда группы «${pending[0].name}» скоро её одобрит. Бот пришлёт сообщение, как только это произойдёт.</p>
        <${Button} kind="secondary" sm icon="refresh-cw" onClick=${() => boot()}>Проверить</${Button}>
      </div>`
      : html`<div class="empty" style="padding-top:8vh">
        <div class="em">👋</div>
        <h3>Вы пока не в группе</h3>
        <p>Попросите у куратора ссылку-приглашение и откройте её — или вставьте код ниже.</p>
      </div>`}
    <div class="card stack">
      <${Field} label="Код или ссылка приглашения"><input class="input" value=${code} onInput=${(e) => setCode(e.target.value)} placeholder="Например, k3m9x2pq7a" /></${Field}>
      <${Button} onClick=${join} disabled=${!code.trim()}>Вступить</${Button}>
    </div>
    ${me.user.is_admin && html`<div class="card stack">
      <div class="card-title">Создать группу</div>
      <div class="hint" style="padding:0">Вы главный администратор. Можно создать группу здесь или отправить /setup в чате группы с ботом.</div>
      <input class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Название, например «Группа Игоря Столярова»" />
      <${Button} kind="secondary" onClick=${create} disabled=${!name.trim()}>Создать</${Button}>
    </div>`}
    ${!isTelegram && html`<button class="btn plain" onClick=${() => { setToken(null); store.set({ me: null }); }}>Выйти</button>`}
  </div>`;
}
