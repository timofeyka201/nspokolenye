// Люди группы, профили, «спасибо», подсказки «кто может помочь»
import { html, useState, useEffect, useStore, useG, gapi, clearCache, currentGroup, relative, birthdayLabel, ageFrom } from '../lib.js';
import { Page, Icon, List, Row, Section, Button, Field, AutoTextarea, Empty, Async, Avatar, Verified, NavButton, openSheet, SheetLayout, actionSheet, confirm, attempt } from '../ui.js';
import { navigate, back, query } from '../router.js';
import { openLink } from '../tg.js';
import { GoalCard } from './goals.js';
import { openAskSheet } from './questions.js';

const ROLE_CHIP = { nastavnik: 'accent', mentor: 'purple', curator: 'blue', participant: '' };

export function PeopleTab({ dir }) {
  const g = currentGroup();
  const st = useG('/members');
  const [q, setQ] = useState('');
  const filter = (list) => {
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter((m) => [m.name, m.username, ...(m.tags || []), m.can_help].join(' ').toLowerCase().includes(s));
  };
  return html`<${Page} title="Люди" dir=${dir}
    right=${g.is_staff && html`<${NavButton} icon="user-plus" label="Пригласить" onClick=${() => navigate('/admin')} />`}>
    <div class="search"><${Icon} name="search" /><input class="input" type="search" placeholder="Имя, интерес, навык" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
    ${!q && html`<div class="grid-2">
      <button class="card tap stack-sm" onClick=${() => navigate('/match')}>
        <span style="font-size:26px">🤝</span><div class="card-title">Кто поможет</div><div class="card-sub">Подбор по навыкам</div>
      </button>
      <button class="card tap stack-sm" onClick=${() => navigate('/thanks')}>
        <span style="font-size:26px">💛</span><div class="card-title">Спасибо</div><div class="card-sub">Благодарности группы</div>
      </button>
    </div>`}
    <${Async} state=${st}>${(d) => {
      const team = filter(d.members.filter((m) => m.role !== 'participant'));
      const kids = filter(d.members.filter((m) => m.role === 'participant'));
      const row = (m) => html`<${Row} key=${m.id} avatar=${m} title=${html`<span class="row-flex" style="gap:4px">${m.name}${m.verified && html`<${Verified} />`}</span>`}
        sub=${m.role !== 'participant' ? m.role_title : (m.tags || []).slice(0, 4).join(' · ') || (m.username ? '@' + m.username : '')} href=${`/member/${m.id}`} />`;
      return html`
        ${g.is_staff && d.pending.length > 0 && html`<button class="banner tap" onClick=${() => navigate('/admin/members')}>
          <div class="bi"><${Icon} name="user-plus" /></div><div class="row-main"><div class="bold">Заявки на вступление: ${d.pending.length}</div><div class="small muted">Проверьте и одобрите</div></div><${Icon} name="chevron-right" class="chev" /></button>`}
        ${team.length > 0 && html`<${Section}><div class="section-label">Команда</div><${List}>${team.map(row)}</${List}></${Section}>`}
        <${Section}><div class="section-label">Участники · ${kids.length}</div>
          ${kids.length ? html`<${List}>${kids.map(row)}</${List}>` : html`<div class="card muted center small">${q ? 'Никого не нашли' : 'Пока никого нет'}</div>`}
        </${Section}>`;
    }}</${Async}>
  </${Page}>`;
}

export function ThanksSheet({ close, to, people }) {
  const [who, setWho] = useState(to || null);
  const [text, setText] = useState('');
  const send = async () => {
    const r = await attempt(() => gapi('/thanks', { method: 'POST', body: { to: who.id, text } }), 'Спасибо отправлено 💛');
    if (r) close(true);
  };
  return html`<${SheetLayout} title="Сказать спасибо" close=${close} done=${who && send} doneLabel="Отправить" doneDisabled=${!who || !text.trim()}>
    ${who ? html`<div class="form">
        <div class="row-flex" style="gap:12px"><${Avatar} user=${who} size=${48} /><div class="row-main"><div class="card-title">${who.name}</div>${!to && html`<button class="small" style="color:var(--accent-ink)" onClick=${() => setWho(null)}>Выбрать другого</button>`}</div></div>
        <${Field} label="За что спасибо" hint="Благодарность увидит вся группа. Получатель получит +3 балла, вы — +1."><${AutoTextarea} value=${text} onInput=${setText} placeholder="Например: за помощь с презентацией 🙌" autofocus maxLength=${500} /></${Field}>
      </div>`
      : html`<${List}>${(people || []).map((p) => html`<${Row} key=${p.id} avatar=${p} title=${p.name} sub=${p.role_title} onClick=${() => setWho(p)} />`)}</${List}>`}
  </${SheetLayout}>`;
}

export function MemberPage({ id, dir }) {
  const me = useStore((s) => s.me);
  const g = currentGroup();
  const st = useG(`/members/${id}`);
  const self = +id === me.user.id;

  const assignRole = (p) => actionSheet(
    Object.entries({ participant: 'Участник', mentor: 'Ментор', nastavnik: 'Наставник', curator: 'Куратор' })
      .filter(([role]) => role !== p.role)
      .map(([role, title]) => ({
        label: title,
        onClick: async () => {
          const saved = await attempt(() => gapi(`/members/${p.id}`, { method: 'PATCH', body: { role } }), 'Роль изменена');
          if (saved) {
            clearCache();
            st.reload();
          }
        },
      })),
    'Назначить роль',
  );

  const staffMenu = (p) => actionSheet([
    g.is_curator && !self && p.status === 'active' && { label: 'Назначить роль', onClick: () => assignRole(p) },
    g.is_staff && !self && { label: 'Исключить из группы', danger: true, onClick: async () => {
      if (await confirm(`Исключить ${p.name} из группы?`, { ok: 'Исключить', danger: true }) && await attempt(() => gapi(`/members/${p.id}`, { method: 'DELETE' }), 'Исключён(а)')) back('/people');
    } },
  ], p.name);

  return html`<${Page} title=${st.data?.profile.name || 'Профиль'} back="/people" dir=${dir} large=${false}
    right=${self ? html`<${NavButton} icon="pencil" label="Редактировать" onClick=${() => navigate('/profile')} />`
      : (g.is_staff || g.is_curator) && st.data ? html`<${NavButton} icon="ellipsis" label="Действия" onClick=${() => staffMenu(st.data.profile)} />` : null}>
    <${Async} state=${st}>${({ profile: p, goals, activity: a, badges, thanks }) => html`
      <div class="profile-head">
        <${Avatar} user=${p} size=${96} />
        <h1>${p.name}${p.verified && html`<${Verified} />`}</h1>
        <div class="row-flex wrap" style="justify-content:center">
          <span class=${`chip ${ROLE_CHIP[p.role]}`}>${p.role_title}</span>
          ${p.username && html`<button class="chip" onClick=${() => openLink(`https://t.me/${p.username}`)}>@${p.username}</button>`}
          ${p.birthday && html`<span class="chip">🎂 ${birthdayLabel(p.birthday)}${p.birthdate && ageFrom(p.birthdate) != null ? ` · ${ageFrom(p.birthdate)}` : ''}</span>`}
        </div>
      </div>

      ${!self && html`<div class="btn-row">
        ${p.username && html`<${Button} kind="tinted" sm icon="send" onClick=${() => openLink(`https://t.me/${p.username}`)}>Написать</${Button}>`}
        <${Button} kind="tinted" sm icon="heart" onClick=${() => openSheet(ThanksSheet, { to: p }).then((ok) => ok && st.reload())}>Спасибо</${Button}>
        <${Button} kind="tinted" sm icon="eye-off" onClick=${() => openAskSheet({ to: p })}>Вопрос</${Button}>
      </div>`}

      ${self && !p.verified && html`<button class="banner blue tap" onClick=${() => me.bot.startLink && openLink(me.bot.startLink)}>
        <div class="bi"><${Icon} name="shield" /></div><div class="row-main"><div class="bold">Подтвердите профиль</div><div class="small muted">Нажмите и запустите бота в Telegram</div></div></button>`}

      ${p.tags.length > 0 && html`<div class="chips" style="justify-content:center">${p.tags.map((t) => html`<span class="chip accent">${t}</span>`)}</div>`}

      ${p.bio && html`<div class="card pre" style="font-size:16px;line-height:1.45">${p.bio}</div>`}

      ${(p.can_help || p.need_help) && html`<div class="stack-sm">
        ${p.can_help && html`<div class="card"><div class="small bold" style="color:#1f9e46;margin-bottom:4px">💪 Могу помочь</div><div class="pre">${p.can_help}</div></div>`}
        ${p.need_help && html`<div class="card"><div class="small bold" style="color:var(--accent-ink);margin-bottom:4px">🙋 Ищу помощь</div><div class="pre">${p.need_help}</div></div>`}
      </div>`}

      ${p.role === 'participant' && html`<${Section} title="Активность">
        <div class="info-grid">
          <div class="info-tile"><div class="k">В группе</div><div class="v">${a.level.emoji} ${a.level.title}</div>${a.points != null && html`<div class="tiny muted">${a.points} баллов${a.rank ? ` · ${a.rank} место` : ''}</div>`}</div>
          <div class="info-tile"><div class="k">В чате</div><div class="v">💬 ${a.chat.level.title}</div><div class="tiny muted">${a.chat.messages} сообщ. за месяц</div></div>
        </div>
        ${self && html`<${List}><${Row} icon="trophy" color="yellow" title="Рейтинг и баллы" href="/rating" /></${List}>`}
      </${Section}>`}

      ${badges.length > 0 && html`<${Section} title="Достижения" action=${self ? 'Все' : null} onAction=${() => navigate('/badges')}>
        <div class="chips">${badges.map((b) => html`<span class="chip" title=${b.desc}>${b.emoji} ${b.title}</span>`)}</div>
      </${Section}>`}

      <${Section} title="Цели">
        ${goals.length ? html`<div class="stack-sm">${goals.map((g2) => html`<${GoalCard} key=${g2.id} g=${{ ...g2, steps_total: 0 }} />`)}</div>`
          : html`<div class="card muted small center">${self ? html`Целей пока нет. <button style="color:var(--accent-ink)" onClick=${() => navigate('/goals')}>Поставить</button>` : 'Целей пока нет'}</div>`}
      </${Section}>

      ${thanks.length > 0 && html`<${Section} title=${`Спасибо · ${thanks.length}`}>
        <div class="stack-sm">${thanks.slice(0, 10).map((t) => html`<div class="card row-flex" style="align-items:flex-start;gap:10px">
          <${Avatar} user=${t.from} size=${32} />
          <div class="row-main"><div class="small"><b>${t.from.name}</b> <span class="muted">· ${relative(t.created_at)}</span></div><div class="pre">${t.text}</div></div>
        </div>`)}</div>
      </${Section}>`}
    `}</${Async}>
  </${Page}>`;
}

export function ThanksPage({ dir }) {
  const st = useG('/thanks');
  const people = useG('/questions/recipients');
  const open = () => openSheet(ThanksSheet, { people: people.data?.people }).then((ok) => ok && st.reload());
  useEffect(() => { if (query().new && people.data) { history.replaceState(history.state, '', '/thanks'); open(); } }, [!!people.data]);
  return html`<${Page} title="Спасибо" back="/people" dir=${dir} sub="Благодарности внутри группы"
    right=${html`<${NavButton} icon="plus" label="Сказать спасибо" accent onClick=${open} />`}>
    <${Async} state=${st}>${(d) => d.thanks.length ? html`<div class="stack-sm">${d.thanks.map((t) => html`<div key=${t.id} class="card stack-sm">
      <div class="row-flex" style="gap:8px">
        <${Avatar} user=${t.from} size=${30} /><span class="small"><b>${t.from.name}</b></span>
        <${Icon} name="arrow-up-right" size=${16} style="color:var(--label-3)" />
        <${Avatar} user=${t.to} size=${30} /><span class="small"><b>${t.to.name}</b></span>
      </div>
      <div class="pre" style="font-size:16px">${t.text}</div>
      <div class="tiny muted">${relative(t.created_at)}</div>
    </div>`)}</div>` : html`<${Empty} emoji="💛" title="Пока тихо" text="Помогли с задачей, поддержали, поделились полезным? Скажите спасибо — это приятно и даёт баллы обоим." action="Сказать спасибо" onAction=${open} />`}</${Async}>
  </${Page}>`;
}

export function MatchPage({ dir }) {
  const st = useG('/match');
  const block = (title, emoji, list, textKey, empty) => html`<${Section} title=${`${emoji} ${title}`}>
    ${list.length ? html`<${List}>${list.map((p) => html`<${Row} key=${p.id} avatar=${p} title=${p.name} sub=${p.text || (p.common ? 'Общие интересы: ' + p.common.join(', ') : '')} href=${`/member/${p.id}`} />`)}</${List}>`
      : html`<div class="card muted small">${empty}</div>`}
  </${Section}>`;
  return html`<${Page} title="Кто поможет" back="/people" dir=${dir} sub="Подбор по полям «Могу помочь» и «Ищу помощь» в профилях">
    <${Async} state=${st}>${(d) => html`
      ${(!d.filled.need || !d.filled.can) && html`<button class="banner tap" onClick=${() => navigate('/profile')}>
        <div class="bi"><${Icon} name="pencil" /></div><div class="row-main"><div class="bold">Дополните профиль</div><div class="small muted">Чем точнее «могу помочь» и «ищу помощь», тем лучше подбор</div></div></button>`}
      ${block('Могут помочь вам', '🙋', d.canHelpMe, 'text', d.filled.need ? 'Пока совпадений нет — попробуйте описать запрос другими словами.' : 'Заполните «В чём ищу помощь» в профиле.')}
      ${block('Вы можете помочь', '💪', d.iCanHelp, 'text', d.filled.can ? 'Пока никто не ищет то, в чём вы сильны.' : 'Заполните «Чем могу помочь» в профиле.')}
      ${block('Общие интересы', '✨', d.similar, 'common', d.filled.tags ? 'Совпадений по интересам пока нет.' : 'Добавьте интересы в профиль.')}
    `}</${Async}>
  </${Page}>`;
}

