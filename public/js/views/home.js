// Главная: всё важное на сегодня
import { html, useEffect, store, useStore, useG, currentGroup, wdDayMonth, time, dayLabel, relative, birthdayLabel, pl, firstName } from '../lib.js';
import { Page, Icon, List, Row, Section, Button, Avatar, Async, Ring, Skeleton } from '../ui.js';
import { navigate } from '../router.js';
import { haptic } from '../tg.js';
import { EventRow, checkInFlow, addToCalendar, openEventForm } from './calendar.js';
import { openTaskForm } from './tasks.js';
import { openPostForm } from './posts.js';

function NextEvent({ e, reload }) {
  return html`<div class="card hero tap" onClick=${() => navigate(`/event/${e.id}`)}>
    <div class="stack" style="gap:12px;position:relative;z-index:1">
      <div class="row-flex" style="justify-content:space-between">
        <span class="chip white sm">${e.kind === 'stream' ? '📺 Эфир' : e.kind === 'deadline' ? '⏰ Дедлайн' : '🤝 Ближайшая встреча'}</span>
        <span class="small muted">${relative(e.starts_at)}</span>
      </div>
      <div>
        <div style="font-size:24px;font-weight:750;letter-spacing:-.03em;line-height:1.15">${e.title}</div>
        <div style="font-size:16px;margin-top:6px;font-weight:600">${dayLabel(e.starts_at)}, ${time(e.starts_at)}${e.ends_at ? `–${time(e.ends_at)}` : ''}</div>
        ${e.location && html`<div class="muted small row-flex" style="margin-top:4px;gap:4px"><${Icon} name="map-pin" size=${14} />${e.location}</div>`}
      </div>
      <div class="btn-row" onClick=${(ev) => ev.stopPropagation()}>
        ${e.can_checkin ? html`<${Button} kind="white" sm icon="scan-line" onClick=${() => checkInFlow(e, reload)}>Отметиться</${Button}>`
          : e.checked_in ? html`<span class="chip white"><${Icon} name="check" />Вы отмечены</span>`
          : html`<${Button} kind="glass" sm icon="calendar-plus" onClick=${() => addToCalendar(e)}>В календарь</${Button}>`}
      </div>
    </div>
  </div>`;
}

function QuickActions({ staff }) {
  const items = staff ? [
    ['calendar-plus', 'Встреча', () => openEventForm({})],
    ['clipboard-list', 'Задание', () => openTaskForm({})],
    ['megaphone', 'Объявление', () => openPostForm({})],
    ['vote', 'Опрос', () => navigate('/polls?new=1')],
  ] : [
    ['message-circle-question-mark', 'Анонимный вопрос', () => navigate('/questions?ask=1')],
    ['heart', 'Сказать спасибо', () => navigate('/thanks?new=1')],
    ['vote', 'Опрос', () => navigate('/polls?new=1')],
    ['folder', 'Материалы', () => navigate('/materials')],
  ];
  return html`<div class="quick">${items.map(([icon, label, fn]) => html`<button class="quick-btn" onClick=${() => { haptic.tap(); fn(); }}>
    <span class="qi"><${Icon} name=${icon} /></span>${label}</button>`)}</div>`;
}

function ActivityCard({ a }) {
  return html`<button class="card tap row-flex" style="gap:14px;text-align:left;width:100%" onClick=${() => navigate('/rating')}>
    <${Ring} value=${Math.min(100, (a.points / 120) * 100)} size=${64} stroke=${7} label=${a.level.emoji} fontSize=${24} />
    <div class="row-main">
      <div class="small muted">Активность за месяц</div>
      <div style="font-size:22px;font-weight:750;letter-spacing:-.02em">${a.points} ${pl(a.points, ['балл', 'балла', 'баллов']).split(' ')[1]}</div>
      <div class="small muted">${a.level.title}${a.rank ? ` · ${a.rank} место из ${a.total}` : ''} · ${pl(a.chat.messages, ['сообщение', 'сообщения', 'сообщений'])} в чате</div>
    </div>
    <${Icon} name="chevron-right" class="chev" />
  </button>`;
}

export function Home({ dir }) {
  const me = useStore((s) => s.me);
  const g = currentGroup();
  const st = useG('/home');

  useEffect(() => {
    if (!st.data) return;
    const d = st.data;
    store.set({ badges: { '/menu': d.questions.inbox + (d.staff?.pending || 0) + d.questions.newAnswers || 0 } });
  }, [st.data]);

  const hour = new Date().getHours();
  const hello = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';

  return html`<${Page} title=${`${hello}, ${firstName(me.user)}`} eyebrow=${g.name} dir=${dir}
    right=${html`<button onClick=${() => navigate(`/member/${me.user.id}`)} aria-label="Мой профиль" style="margin-right:6px"><${Avatar} user=${me.user} size=${34} /></button>`}>
    <${Async} state=${st} skeleton=${html`<div class="stack"><${Skeleton} h=${190} /><${Skeleton} h=${80} /><${Skeleton} h=${90} /></div>`}>${(d) => html`

      ${!me.user.verified && html`<button class="banner blue tap" onClick=${() => me.bot.startLink && window.open(me.bot.startLink)}>
        <div class="bi"><${Icon} name="send" /></div><div class="row-main"><div class="bold">Подтвердите профиль</div><div class="small muted">Запустите бота, чтобы получать напоминания и ответы на вопросы</div></div></button>`}

      ${d.feedbackDue.map((e) => html`<button key=${e.id} class="banner tap" onClick=${() => navigate(`/event/${e.id}/feedback`)}>
        <div class="bi"><${Icon} name="star" /></div>
        <div class="row-main"><div class="bold">Оцените встречу</div><div class="small muted">«${e.title}» · анонимно, 30 секунд</div></div>
        <${Icon} name="chevron-right" class="chev" /></button>`)}

      ${d.events[0] ? html`<${NextEvent} e=${d.events[0]} reload=${st.reload} />` : html`<div class="card hero">
        <div class="stack-sm" style="position:relative;z-index:1">
          <span class="chip white sm" style="align-self:flex-start">🗓 Расписание</span>
          <div style="font-size:22px;font-weight:750;letter-spacing:-.02em">Ближайших встреч пока нет</div>
          <div class="muted small">${g.is_staff ? 'Запланируйте встречу — участники получат уведомление.' : 'Как только наставник назначит встречу, она появится здесь.'}</div>
        </div></div>`}

      <${QuickActions} staff=${g.is_staff} />

      ${g.is_staff && d.staff && html`<${Section} title="Команде">
        <div class="grid-3">
          <button class="card tap stat" onClick=${() => navigate('/admin/members')}><div class="num">${d.staff.pending}</div><div class="lbl">заявок</div></button>
          <button class="card tap stat" onClick=${() => navigate('/people')}><div class="num">${d.staff.members}</div><div class="lbl">в группе</div></button>
          <button class="card tap stat" onClick=${() => navigate('/feedback')}><div class="num">${d.staff.feedback_week.avg ?? '—'}</div><div class="lbl">оценка за неделю</div></button>
        </div>
        <${List}>
          <${Row} icon="target" color="green" title="Цели группы" sub="Общая картина прогресса" href="/goals?tab=group" />
          <${Row} icon="message-square" color="purple" title="Обратная связь" sub="Анонимные оценки встреч" href="/feedback" />
        </${List}>
      </${Section}>`}

      ${g.role === 'participant' && html`<${ActivityCard} a=${d.activity} />`}

      ${(d.questions.inbox > 0 || d.questions.newAnswers > 0) && html`<${List}>
        ${d.questions.inbox > 0 && html`<${Row} icon="inbox" color="indigo" title="Вам задали вопрос" sub="Анонимно" badge=${d.questions.inbox} href="/questions" />`}
        ${d.questions.newAnswers > 0 && html`<${Row} icon="reply" color="teal" title="Пришёл ответ на ваш вопрос" badge=${d.questions.newAnswers} href="/questions/sent" />`}
      </${List}>`}

      ${d.polls.length > 0 && html`<${Section} title="Ждут вашего голоса" action="Все" onAction=${() => navigate('/polls')}>
        <${List}>${d.polls.map((p) => html`<${Row} key=${p.id} icon="vote" color="blue" title=${p.question} sub=${`Проголосовали: ${p.voters}${p.closes_at ? ` · до ${wdDayMonth(p.closes_at)}` : ''}`} href=${`/poll/${p.id}`} />`)}</${List}>
      </${Section}>`}

      ${d.tasks.length > 0 && html`<${Section} title="Задания" action="Все" onAction=${() => navigate('/tasks')}>
        <${List}>${d.tasks.map((t) => {
          const overdue = t.due_at && t.due_at < new Date().toISOString();
          return html`<${Row} key=${t.id} icon="clipboard-list" color=${overdue ? 'red' : 'yellow'} title=${t.title}
            sub=${t.due_at ? `${overdue ? 'Просрочено · ' : 'До '}${dayLabel(t.due_at).toLowerCase()}, ${time(t.due_at)}` : 'Без срока'} href=${`/task/${t.id}`} />`;
        })}</${List}>
      </${Section}>`}

      ${d.coffee && html`<${Section} title="Random Coffee">
        <button class="card tap row-flex" style="gap:14px;width:100%;text-align:left" onClick=${() => navigate('/coffee')}>
          <div style="font-size:36px">☕️</div>
          <div class="row-main">
            <div class="small muted">Ваша пара на этой неделе</div>
            <div class="card-title">${d.coffee.partners.map((p) => p.name).join(' и ')}</div>
            <div class="small" style=${{ color: d.coffee.met ? '#1f9e46' : 'var(--accent-ink)' }}>${d.coffee.met ? 'Встреча состоялась ✓' : 'Договоритесь о встрече'}</div>
          </div>
          <div class="avatar-stack">${d.coffee.partners.map((p) => html`<${Avatar} user=${p} size=${40} />`)}</div>
        </button>
      </${Section}>`}

      ${d.posts.length > 0 && html`<${Section} title="Объявления" action="Все" onAction=${() => navigate('/posts')}>
        ${d.posts.slice(0, 2).map((p) => html`<div key=${p.id} class="card stack-sm">
          <div class="row-flex">
            <${Avatar} user=${p.author} size=${28} />
            <span class="small bold">${p.author?.name}</span>
            <span class="small muted">· ${relative(p.created_at)}</span>
            ${p.pinned && html`<span class="spacer"></span><span style="color:var(--accent-ink)"><${Icon} name="pin" size=${16} /></span>`}
          </div>
          <div class="pre" style="font-size:16px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden">${p.text}</div>
        </div>`)}
      </${Section}>`}

      ${d.events.length > 1 && html`<${Section} title="Скоро" action="Календарь" onAction=${() => navigate('/calendar')}>
        <div class="stack-sm">${d.events.slice(1).map((e) => html`<${EventRow} key=${e.id} e=${e} showDate />`)}</div>
      </${Section}>`}

      ${d.top.length > 0 && html`<${Section} title="Топ-5 месяца" action="Рейтинг" onAction=${() => navigate('/rating')}>
        <${List}>${d.top.map((u, i) => html`<${Row} key=${u.id} avatar=${u} title=${u.name} value=${`${u.points}`}
          right=${html`<span style="font-size:20px;width:26px;text-align:center">${['🥇', '🥈', '🥉', '4', '5'][i]}</span>`} href=${`/member/${u.id}`} />`)}</${List}>
      </${Section}>`}

      ${d.birthdays.length > 0 && html`<${Section} title="Дни рождения">
        <${List}>${d.birthdays.map((u) => html`<${Row} key=${u.id} avatar=${u} title=${u.name}
          sub=${u.in_days === 0 ? 'Сегодня! Поздравьте 🎉' : u.in_days === 1 ? 'Завтра' : birthdayLabel(u.birthday)} value="🎂" href=${`/member/${u.id}`} />`)}</${List}>
      </${Section}>`}

      <div class="hint center" style="margin-top:4px">${g.role_title} · ${g.name}</div>
    `}</${Async}>
  </${Page}>`;
}

