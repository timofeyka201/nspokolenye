// Random Coffee: случайные пары на неделю
import { html, useG, gapi, dayMonth, pl } from '../lib.js';
import { Page, Icon, List, Row, Section, Button, Toggle, Empty, Async, Avatar, attempt } from '../ui.js';
import { navigate } from '../router.js';
import { openLink, haptic } from '../tg.js';

const weekLabel = (week) => {
  const end = new Date(week); end.setDate(end.getDate() + 6);
  return `${dayMonth(week)} – ${dayMonth(end.toISOString())}`;
};

function PairCard({ pair, onMet }) {
  return html`<div class="card stack">
    ${pair.partners.map((p) => html`<div class="stack-sm" key=${p.id}>
      <button class="row-flex tap" style="gap:12px;text-align:left" onClick=${() => navigate(`/member/${p.id}`)}>
        <${Avatar} user=${p} size=${56} />
        <div class="row-main"><div class="card-title">${p.name}</div>${p.username && html`<div class="small muted">@${p.username}</div>`}</div>
        <${Icon} name="chevron-right" class="chev" />
      </button>
      ${p.tags?.length > 0 && html`<div class="chips">${p.tags.slice(0, 6).map((t) => html`<span class="chip sm">${t}</span>`)}</div>`}
      ${p.bio && html`<div class="small muted" style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${p.bio}</div>`}
    </div>`)}
    <div class="btn-row">
      ${pair.partners[0]?.username && html`<${Button} sm icon="send" onClick=${() => openLink(`https://t.me/${pair.partners[0].username}`)}>Написать</${Button}>`}
      ${pair.met ? html`<${Button} kind="secondary" sm icon="check" onClick=${() => onMet(false)}>Встретились</${Button}>`
        : html`<${Button} kind="tinted" sm icon="coffee" onClick=${() => onMet(true)}>Мы встретились</${Button}>`}
    </div>
  </div>`;
}

export function CoffeePage({ dir }) {
  const st = useG('/coffee');
  const toggle = async (on) => {
    const r = await attempt(() => gapi('/coffee', { method: 'POST', body: { on } }), on ? 'Вы участвуете! Пары — каждый понедельник' : 'Вы больше не участвуете');
    if (r) st.reload();
  };
  const met = async (pair, value) => {
    const r = await attempt(() => gapi(`/coffee/pairs/${pair.id}/met`, { method: 'POST', body: { met: value } }), value ? 'Отлично! +5 баллов' : null);
    if (r) { if (value) haptic.success(); st.reload(); }
  };
  return html`<${Page} title="Random Coffee" back="/menu" dir=${dir}>
    <${Async} state=${st}>${(d) => html`
      <div class="card hero stack" style="gap:14px">
        <div class="row-flex" style="gap:14px;position:relative;z-index:1">
          <div style="font-size:46px;line-height:1">☕️</div>
          <div><div style="font-size:20px;font-weight:750;letter-spacing:-.02em">Случайная пара на неделю</div>
          <div class="muted small">Каждый понедельник бот знакомит вас с кем-то из группы для созвона или встречи</div></div>
        </div>
        <div class="row-flex" style="position:relative;z-index:1;background:rgba(255,255,255,.18);border-radius:16px;padding:10px 14px">
          <div class="row-main"><div class="bold">Я участвую</div><div class="small muted">${pl(d.count, ['участник', 'участника', 'участников'])}</div></div>
          <${Toggle} checked=${d.opted} onChange=${toggle} label="Участвовать в Random Coffee" />
        </div>
      </div>

      ${d.current ? html`<${Section} title="Пара этой недели" foot=${weekLabel(d.current.week)}>
          <${PairCard} pair=${d.current} onMet=${(v) => met(d.current, v)} />
        </${Section}>`
        : d.opted ? html`<div class="card center stack-sm" style="align-items:center;padding:22px"><div style="font-size:30px">🗓</div><div class="card-title">Ждём понедельника</div><div class="small muted">В понедельник в 10:00 бот пришлёт вашу пару.</div></div>` : null}

      <${Section} title="Как это работает">
        <${List}>
          <${Row} emoji="🎲" title="Пары подбираются случайно" sub="Стараемся не повторять недавних собеседников" />
          <${Row} emoji="💬" title="Договоритесь сами" sub="20–30 минут: созвон, прогулка, кофе" />
          <${Row} emoji="⭐️" title="+5 баллов за встречу" sub="Отметьте «Мы встретились» здесь или в боте" />
        </${List}>
      </${Section}>

      ${d.history.length > 0 && html`<${Section} title="Прошлые пары">
        <${List}>${d.history.map((p) => html`<${Row} key=${p.id} avatar=${p.partners[0]} title=${p.partners.map((x) => x.name).join(', ')} sub=${weekLabel(p.week)} value=${p.met ? '☕️' : ''} href=${`/member/${p.partners[0]?.id}`} />`)}</${List}>
      </${Section}>`}
      ${!d.opted && !d.current && !d.history.length && html`<${Empty} emoji="👋" title="Присоединяйтесь" text="Включите переключатель выше — и со следующего понедельника у вас будет новая пара." />`}
    `}</${Async}>
  </${Page}>`;
}
