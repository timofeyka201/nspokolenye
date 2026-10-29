// Вкладка «Ещё»: разделы, профиль, настройки, управление группой
import { html, useState, useStore, useG, api, gapi, store, setToken, currentGroup, refreshMe, copyText, relative, todayInput } from '../lib.js';
import {
  Page, Icon, List, Row, Section, Button, Field, AutoTextarea, Async, Avatar, Verified, Toggle, TagInput, TAG_SUGGESTIONS,
  actionSheet, confirm, toast, attempt, openSheet, SheetLayout,
} from '../ui.js';
import { navigate, back } from '../router.js';
import { isTelegram, openLink, shareUrl } from '../tg.js';
import { switchGroup } from '../app.js';
import { openSubscribe } from './calendar.js';

export function MenuTab({ dir }) {
  const me = useStore((s) => s.me);
  const badges = useStore((s) => s.badges) || {};
  const g = currentGroup();
  const groups = me.groups.filter((x) => x.status === 'active');
  const pickGroup = () => actionSheet(groups.map((x) => ({ label: `${x.id === g.id ? '✓ ' : ''}${x.name}`, onClick: () => x.id !== g.id && switchGroup(x.id) })), 'Группа');
  const logout = async () => {
    if (!(await confirm('Выйти из аккаунта на этом устройстве?', { ok: 'Выйти', danger: true }))) return;
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setToken(null);
    store.set({ me: null });
  };
  return html`<${Page} title="Ещё" dir=${dir}>
    <${List}>
      <${Row} avatar=${me.user} title=${html`<span class="row-flex" style="gap:4px;font-weight:650">${me.user.name}${me.user.verified && html`<${Verified} />`}</span>`}
        sub=${`${g.role_title} · ${me.user.username ? '@' + me.user.username : 'Профиль'}`} href=${`/member/${me.user.id}`} />
      <${Row} icon="pencil" color="gray" title="Редактировать профиль" href="/profile" />
      ${groups.length > 1 && html`<${Row} icon="users" color="indigo" title="Группа" value=${g.name} onClick=${pickGroup} />`}
    </${List}>

    <${Section}>
      <div class="section-label">Группа</div>
      <${List}>
        <${Row} icon="megaphone" color="orange" title="Объявления" href="/posts" />
        <${Row} icon="clipboard-list" color="yellow" title="Задания" href="/tasks" />
        <${Row} icon="folder" color="blue" title="Материалы" href="/materials" />
        <${Row} icon="vote" color="teal" title="Опросы" href="/polls" />
        <${Row} icon="message-circle-question-mark" color="indigo" title="Анонимные вопросы" href="/questions" badge=${badges['/menu'] && !g.is_staff ? badges['/menu'] : null} />
        <${Row} icon="coffee" color="#a2845e" title="Random Coffee" href="/coffee" />
      </${List}>
    </${Section}>

    <${Section}>
      <div class="section-label">Активность</div>
      <${List}>
        <${Row} icon="trophy" color="yellow" title="Рейтинг" href="/rating" />
        <${Row} icon="award" color="purple" title="Достижения" href="/badges" />
        <${Row} icon="heart" color="pink" title="Спасибо" href="/thanks" />
        <${Row} icon="handshake" color="green" title="Кто может помочь" href="/match" />
      </${List}>
    </${Section}>

    ${g.is_staff && html`<${Section}>
      <div class="section-label">Команда группы</div>
      <${List}>
        <${Row} icon="message-square" color="purple" title="Обратная связь" sub="Анонимные оценки встреч" href="/feedback" />
        <${Row} icon="target" color="green" title="Цели группы" href="/goals?tab=group" />
        <${Row} icon="user-plus" color="blue" title="Участники и заявки" href="/admin/members" badge=${badges['/menu'] || null} />
        <${Row} icon="settings" color="gray" title="Управление группой" sub="Приглашение, чат, настройки" href="/admin" />
      </${List}>
    </${Section}>`}

    <${Section}>
      <div class="section-label">Настройки</div>
      <${List}>
        <${Row} icon="bell" color="red" title="Уведомления" href="/settings" />
        <${Row} icon="calendar-plus" color="green" title="Календарь на телефоне" onClick=${openSubscribe} />
        ${me.bot.username && html`<${Row} icon="send" color="blue" title="Бот в Telegram" value=${'@' + me.bot.username} onClick=${() => openLink(`https://t.me/${me.bot.username}`)} />`}
        <${Row} icon="circle-help" color="gray" title="Как начисляются баллы" href="/points" />
      </${List}>
    </${Section}>

    ${!isTelegram && html`<${List}><${Row} icon="log-out" color="gray" title="Выйти" danger onClick=${logout} /></${List}>`}
    <div class="center" style="padding:8px 0 4px"><div class="logo" style="font-size:16px">Поколение</div><div class="tiny muted" style="margin-top:6px">Пространство малой группы</div></div>
  </${Page}>`;
}

export function PointsInfo({ dir }) {
  const st = useG('/rating');
  return html`<${Page} title="Баллы" back="/menu" dir=${dir} sub="За что начисляются баллы активности">
    <${Async} state=${st}>${(d) => html`
      <${List}>${d.rules.map((r) => html`<${Row} key=${r.kind} title=${r.title} sub=${r.note} value=${`+${r.points}`} />`)}</${List}>
      <div class="section-foot">Анонимные отзывы и вопросы баллов не дают — чтобы их нельзя было связать с человеком. Рейтинг считается за календарный месяц.</div>
    `}</${Async}>
  </${Page}>`;
}

// ---------- Редактирование профиля ----------
export function ProfileEdit({ dir }) {
  const me = useStore((s) => s.me);
  const u = me.user;
  const [f, setF] = useState({ first_name: u.first_name || '', last_name: u.last_name || '', birthdate: u.birthdate || '', tags: u.tags || [], bio: u.bio || '', can_help: u.can_help || '', need_help: u.need_help || '' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const save = async () => {
    const r = await attempt(() => api('/me', { method: 'PATCH', body: f }), 'Профиль сохранён');
    if (r) { store.set({ me: r }); back(`/member/${u.id}`); }
  };
  return html`<${Page} title="Профиль" back=${`/member/${u.id}`} dir=${dir} large=${false}
    right=${html`<button class="nav-btn" style="font-weight:650" onClick=${save}>Готово</button>`}>
    <div class="profile-head">
      <${Avatar} user=${u} size=${88} />
      <div class="tiny muted">Фото берётся из Telegram</div>
    </div>
    ${!u.verified && html`<button class="banner blue tap" onClick=${() => me.bot.startLink && openLink(me.bot.startLink)}>
      <div class="bi"><${Icon} name="shield" /></div><div class="row-main"><div class="bold">Профиль не подтверждён</div><div class="small muted">Запустите бота — и рядом с именем появится галочка</div></div></button>`}
    <div class="form">
      <div class="grid-2">
        <${Field} label="Имя"><input class="input" value=${f.first_name} onInput=${set('first_name')} maxLength="40" /></${Field}>
        <${Field} label="Фамилия"><input class="input" value=${f.last_name} onInput=${set('last_name')} maxLength="60" /></${Field}>
      </div>
      <${Field} label="Дата рождения" hint="Другим видны только день и месяц"><input class="input" type="date" value=${f.birthdate} max=${todayInput()} onInput=${set('birthdate')} /></${Field}>
      <${Field} label="Интересы"><${TagInput} value=${f.tags} onChange=${set('tags')} suggestions=${TAG_SUGGESTIONS} /></${Field}>
      <${Field} label="О себе"><${AutoTextarea} value=${f.bio} onInput=${set('bio')} placeholder="Учёба, увлечения, мечты" maxLength=${1000} /></${Field}>
      <${Field} label="Чем могу помочь"><${AutoTextarea} value=${f.can_help} onInput=${set('can_help')} placeholder="Навыки и знания, которыми готов делиться" maxLength=${500} /></${Field}>
      <${Field} label="В чём ищу помощь"><${AutoTextarea} value=${f.need_help} onInput=${set('need_help')} placeholder="С чем хотелось бы разобраться" maxLength=${500} /></${Field}>
      <${Button} block onClick=${save}>Сохранить</${Button}>
    </div>
  </${Page}>`;
}

// ---------- Уведомления ----------
export function SettingsPage({ dir }) {
  const me = useStore((s) => s.me);
  const s = me.settings;
  const quietOn = !!(s.quiet_from && s.quiet_to);
  const save = async (patch) => {
    const r = await attempt(() => api('/me/settings', { method: 'PATCH', body: patch }));
    if (r) store.set({ me: r });
  };
  return html`<${Page} title="Уведомления" back="/menu" dir=${dir} sub="Что бот присылает в личные сообщения">
    ${!me.user.verified && html`<button class="banner blue tap" onClick=${() => me.bot.startLink && openLink(me.bot.startLink)}>
      <div class="bi"><${Icon} name="send" /></div><div class="row-main"><div class="bold">Бот пока не может вам писать</div><div class="small muted">Нажмите, чтобы запустить его в Telegram</div></div></button>`}
    <${List}>${Object.entries(me.notifyKinds).map(([k, title]) => html`<${Row} key=${k} title=${title} chevron=${false}
      right=${html`<${Toggle} checked=${s.notify[k] !== false} onChange=${(v) => save({ notify: { [k]: v } })} label=${title} />`} />`)}</${List}>

    <${Section}>
      <div class="section-label">Тихие часы</div>
      <${List}>
        <${Row} icon="moon" color="indigo" title="Не беспокоить" chevron=${false}
          right=${html`<${Toggle} checked=${quietOn} onChange=${(v) => save(v ? { quiet_from: '22:00', quiet_to: '08:00' } : { quiet_from: null, quiet_to: null })} />`} />
        ${quietOn && html`<div class="row"><div class="row-main row-title">С</div><input class="input" type="time" style="width:120px;min-height:38px;padding:6px 12px" value=${s.quiet_from} onChange=${(e) => save({ quiet_from: e.target.value })} /></div>
          <div class="row"><div class="row-main row-title">До</div><input class="input" type="time" style="width:120px;min-height:38px;padding:6px 12px" value=${s.quiet_to} onChange=${(e) => save({ quiet_to: e.target.value })} /></div>`}
      </${List}>
      <div class="section-foot">В это время сообщения от бота придут позже — когда тихие часы закончатся. Напоминания в общем чате группы приходят как обычно.</div>
    </${Section}>
  </${Page}>`;
}

// ---------- Управление группой ----------
const TIMEZONES = [
  ['Europe/Kaliningrad', 'Калининград (МСК−1)'], ['Europe/Moscow', 'Москва (МСК)'], ['Europe/Samara', 'Самара (МСК+1)'],
  ['Asia/Yekaterinburg', 'Екатеринбург (МСК+2)'], ['Asia/Omsk', 'Омск (МСК+3)'], ['Asia/Novosibirsk', 'Новосибирск (МСК+4)'],
  ['Asia/Krasnoyarsk', 'Красноярск (МСК+4)'], ['Asia/Irkutsk', 'Иркутск (МСК+5)'], ['Asia/Yakutsk', 'Якутск (МСК+6)'],
  ['Asia/Vladivostok', 'Владивосток (МСК+7)'], ['Asia/Magadan', 'Магадан (МСК+8)'], ['Asia/Kamchatka', 'Камчатка (МСК+9)'],
];

function GroupNameSheet({ close, name, onSave }) {
  const [v, setV] = useState(name);
  return html`<${SheetLayout} title="Название группы" close=${close} done=${async () => { if (await onSave(v)) close(); }} doneDisabled=${!v.trim()}>
    <input class="input" value=${v} onInput=${(e) => setV(e.target.value)} maxLength="80" autofocus />
  </${SheetLayout}>`;
}

export function AdminPage({ dir }) {
  const g = currentGroup();
  const st = useG('/admin');
  const update = async (body) => {
    const r = await attempt(() => gapi('/admin', { method: 'PATCH', body }), 'Сохранено');
    if (r) { st.setData(r); refreshMe(); }
    return !!r;
  };
  const copy = async (text) => { if (await copyText(text)) toast('Скопировано'); };
  return html`<${Page} title="Управление" back="/menu" dir=${dir} sub=${g.name}>
    <${Async} state=${st}>${(d) => html`
      <${Section} title="Приглашение">
        <div class="card stack">
          <div class="small muted">Отправьте ссылку участникам. Кто уже в чате группы — попадёт сразу, остальные — после вашего одобрения.</div>
          ${d.invite.bot ? html`<div class="input" style="font-size:15px;word-break:break-all;min-height:auto;background:#fff">${d.invite.bot}</div>
            <div class="btn-row">
              <${Button} sm icon="share" onClick=${() => shareUrl(d.invite.bot, `Присоединяйся к нашей группе «${d.group.name}» в проекте «Поколение»!`)}>Поделиться</${Button}>
              <${Button} sm kind="secondary" icon="copy" onClick=${() => copy(d.invite.bot)}>Копировать</${Button}>
            </div>` : html`<div class="small">Код приглашения: <b>${d.invite.code}</b> (бот ещё не подключён)</div>`}
          ${d.can_edit && html`<button class="small" style="color:var(--red);align-self:flex-start" onClick=${async () => {
            if (await confirm('Старая ссылка перестанет работать.', { ok: 'Создать новую ссылку', danger: true })) { const r = await attempt(() => gapi('/admin/invite-reset', { method: 'POST' }), 'Новая ссылка готова'); if (r) st.setData(r); }
          }}>Сбросить ссылку</button>`}
        </div>
      </${Section}>

      <${Section} title="Чат группы">
        ${d.group.chat_linked ? html`<${List}>
            <${Row} icon="message-square" color="green" title=${d.group.chat_title || 'Чат подключён'} sub="Бот считает активность, напоминает о встречах и приветствует новичков" chevron=${false} />
            ${d.can_edit && html`<${Row} title="Отключить чат" danger onClick=${async () => { if (await confirm('Бот перестанет писать в чат и считать активность.', { ok: 'Отключить', danger: true })) { const r = await attempt(() => gapi('/admin/unlink-chat', { method: 'POST' })); if (r) { st.setData(r); refreshMe(); } } }} />`}
          </${List}>`
          : html`<div class="card stack">
            <div class="card-title">Как подключить чат</div>
            <ol class="small" style="margin:0;padding-left:20px;line-height:1.6">
              <li>Добавьте ${d.bot_username ? html`<b>@${d.bot_username}</b>` : 'бота'} в чат группы</li>
              <li>Сделайте бота администратором (чтобы он видел сообщения)</li>
              <li>Отправьте в чат команду ниже</li>
            </ol>
            ${d.can_edit ? (d.link_code ? html`<div class="input" style="font-size:20px;font-weight:700;letter-spacing:.06em;background:#fff;text-align:center">/setup ${d.link_code}</div>
                <${Button} sm kind="secondary" icon="copy" onClick=${() => copy(`/setup ${d.link_code}`)}>Скопировать команду</${Button}>`
              : html`<${Button} sm onClick=${async () => { const r = await attempt(() => gapi('/admin/link-code', { method: 'POST' })); if (r) st.setData(r); }}>Получить код</${Button}>`)
              : html`<div class="small muted">Код для подключения выдаёт куратор.</div>`}
            <${Button} sm kind="plain" icon="refresh-cw" onClick=${async () => { await refreshMe(); st.reload(); }}>Я подключил — проверить</${Button}>
          </div>`}
      </${Section}>

      <${Section} title="Настройки">
        <${List}>
          <${Row} title="Название" value=${d.group.name} onClick=${d.can_edit ? () => openSheet(GroupNameSheet, { name: d.group.name, onSave: (name) => update({ name }) }) : null} chevron=${d.can_edit} />
          <div class="row"><div class="row-main row-title">Часовой пояс</div>
            <select class="select" style="width:auto;min-height:36px;padding:6px 36px 6px 12px;font-size:15px" disabled=${!d.can_edit} value=${d.group.tz} onChange=${(e) => update({ tz: e.target.value })}>
              ${TIMEZONES.map(([v, t]) => html`<option value=${v}>${t}</option>`)}
            </select></div>
        </${List}>
        <div class="section-foot">По часовому поясу бот рассылает поздравления, пары Random Coffee и подводит итоги месяца.</div>
      </${Section}>

      <${List}><${Row} icon="user-plus" color="blue" title="Участники, роли и заявки" href="/admin/members" /></${List}>
      <button class="btn plain" style="color:var(--red)" onClick=${async () => {
        if (await confirm(`Покинуть группу «${g.name}»?`, { ok: 'Покинуть', danger: true }) && await attempt(() => gapi('/leave', { method: 'POST' }))) { await refreshMe(); store.set({ gid: null }); location.href = '/'; }
      }}>Покинуть группу</button>
    `}</${Async}>
  </${Page}>`;
}

export function AdminMembers({ dir }) {
  const g = currentGroup();
  const st = useG('/members');
  const approve = async (u) => { await attempt(() => gapi(`/members/${u.id}/approve`, { method: 'POST' }), `${u.name} в группе`); st.reload(); };
  const decline = async (u) => { if (await confirm(`Отклонить заявку ${u.name}?`, { ok: 'Отклонить', danger: true })) { await attempt(() => gapi(`/members/${u.id}`, { method: 'DELETE' })); st.reload(); } };
  const roleMenu = (u) => actionSheet([
    ...(g.is_curator ? Object.entries({ participant: 'Участник', mentor: 'Ментор', nastavnik: 'Наставник', curator: 'Куратор' }).filter(([r]) => r !== u.role).map(([r, t]) => ({
      label: `Роль: ${t}`, onClick: async () => { await attempt(() => gapi(`/members/${u.id}`, { method: 'PATCH', body: { role: r } }), 'Роль изменена'); st.reload(); },
    })) : []),
    { label: 'Открыть профиль', onClick: () => navigate(`/member/${u.id}`) },
    { label: 'Исключить из группы', danger: true, onClick: async () => { if (await confirm(`Исключить ${u.name}?`, { ok: 'Исключить', danger: true })) { await attempt(() => gapi(`/members/${u.id}`, { method: 'DELETE' }), 'Исключён(а)'); st.reload(); } } },
  ], u.name);
  return html`<${Page} title="Участники" back="/admin" dir=${dir} sub=${g.is_curator ? 'Нажмите на человека, чтобы изменить роль' : 'Роли назначает куратор'}>
    <${Async} state=${st}>${(d) => html`
      ${d.pending.length > 0 && html`<${Section} title=${`Заявки · ${d.pending.length}`}>
        <div class="stack-sm">${d.pending.map((u) => html`<div key=${u.id} class="card row-flex" style="gap:12px">
          <${Avatar} user=${u} size=${44} />
          <div class="row-main"><div class="card-title row-flex" style="gap:4px">${u.name}${u.verified && html`<${Verified} />`}</div><div class="small muted">${u.username ? '@' + u.username + ' · ' : ''}${relative(u.joined_at)}</div></div>
          <button class="nav-btn round" style="background:var(--red-soft);color:var(--red)" onClick=${() => decline(u)} aria-label="Отклонить"><${Icon} name="x" size=${18} /></button>
          <button class="nav-btn round" style="background:var(--green);color:#fff" onClick=${() => approve(u)} aria-label="Принять"><${Icon} name="check" size=${18} /></button>
        </div>`)}</div>
      </${Section}>`}
      <${List}>${d.members.map((u) => html`<${Row} key=${u.id} avatar=${u} title=${u.name} sub=${u.role_title} onClick=${() => roleMenu(u)} />`)}</${List}>
      <div class="section-foot"><b>Наставник</b> видит анонимную обратную связь и публикует задания. <b>Ментор</b>, <b>наставник</b> и <b>куратор</b> управляют встречами, материалами и заявками. Роли назначает только <b>куратор</b>.</div>
    `}</${Async}>
  </${Page}>`;
}

