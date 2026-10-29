// Рейтинг активности и достижения
import { html, useState, useStore, useG, currentGroup, monthYear, dayMonth, pl } from '../lib.js';
import { Page, List, Row, Section, Segmented, Async, Avatar, Ring, Empty } from '../ui.js';
import { navigate } from '../router.js';

const monthTitle = (key) => { const [y, m] = key.split('-').map(Number); return monthYear(new Date(y, m - 1, 1)).replace(' г.', ''); };

function Podium({ top }) {
  const order = [top[1], top[0], top[2]];
  return html`<div class="podium">${order.map((u, i) => {
    const place = [2, 1, 3][i];
    if (!u) return html`<div></div>`;
    return html`<button class=${`p p${place} tap`} onClick=${() => navigate(`/member/${u.id}`)}>
      <${Avatar} user=${u} size=${place === 1 ? 64 : 52} />
      <div class="nm">${u.first_name || u.name}</div>
      <div class="pts">${u.points}</div>
      <div class="stand">${place}</div>
    </button>`;
  })}</div>`;
}

export function RatingPage({ dir }) {
  const g = currentGroup();
  const me = useStore((s) => s.me);
  const st = useG('/rating');
  const act = useG('/activity');
  const [tab, setTab] = useState('top');
  return html`<${Page} title="Рейтинг" back="/menu" dir=${dir} sub=${st.data ? `Активность за ${monthTitle(st.data.month)}` : ' '}>
    ${g.is_staff && html`<${Segmented} value=${tab} onChange=${setTab} options=${[{ value: 'top', label: 'Топ-5' }, { value: 'all', label: 'Все участники' }]} />`}
    <${Async} state=${st}>${(d) => html`
      ${tab === 'top' ? html`
        ${d.top.some((u) => u.points > 0) ? html`<div class="card"><${Podium} top=${d.top} /></div>
          ${d.top.length > 3 && html`<${List}>${d.top.slice(3).map((u) => html`<${Row} key=${u.id} class="leader-row" avatar=${u} title=${u.name} value=${u.points}
            right=${html`<span class="place">${u.rank}</span>`} href=${`/member/${u.id}`} />`)}</${List}>`}`
          : html`<${Empty} emoji="🏁" title="Месяц только начался" text="Приходите на встречи, ставьте цели, пишите в чат — и попадите в топ-5." />`}

        ${d.me && html`<${Section} title="Моё место">
          <div class="card row-flex" style="gap:14px">
            <${Ring} value=${d.total ? ((d.total - d.me.rank + 1) / d.total) * 100 : 0} size=${68} stroke=${7} label=${`#${d.me.rank}`} fontSize=${18} />
            <div class="row-main">
              <div style="font-size:22px;font-weight:750;letter-spacing:-.02em">${pl(d.me.points, ['балл', 'балла', 'баллов'])}</div>
              <div class="small muted">${d.me.rank} место из ${d.total} · ${d.me.level.emoji} ${d.me.level.title}</div>
            </div>
          </div>
          ${act.data?.byKind.length > 0 && html`<${List}>${act.data.byKind.map((k) => html`<${Row} key=${k.kind} title=${k.title} sub=${`×${k.count}`} value=${`+${k.points}`} />`)}</${List}>`}
        </${Section}>`}
        ${!d.me && g.role !== 'participant' && html`<div class="hint center">Команда группы в рейтинге не участвует.</div>`}
      ` : html`<${List}>${(d.all || []).map((u) => html`<${Row} key=${u.id} class=${`leader-row ${u.id === me.user.id ? 'me' : ''}`} avatar=${u} title=${u.name}
          sub=${`${u.level.emoji} ${u.level.title} · ${u.chat_messages} сообщ. в чате`} value=${u.points} right=${html`<span class="place">${u.rank}</span>`} href=${`/member/${u.id}`} />`)}</${List}>`}

      <${Section} title="Как начисляются баллы">
        <${List}>${d.rules.map((r) => html`<${Row} key=${r.kind} title=${r.title} sub=${r.note} value=${`+${r.points}`} />`)}</${List}>
        <div class="section-foot">Анонимные отзывы и вопросы баллов не дают — чтобы никто не мог вычислить автора. Рейтинг обнуляется 1-го числа, лидер месяца получает достижение 🏆.</div>
      </${Section}>
      <${Section} title="Уровни активности">
        <div class="chips">${[...d.levels].reverse().map((l) => html`<span class="chip">${l.emoji} ${l.title}${l.min ? ` · от ${l.min}` : ''}</span>`)}</div>
      </${Section}>
    `}</${Async}>
  </${Page}>`;
}

export function BadgesPage({ dir }) {
  const st = useG('/badges');
  return html`<${Page} title="Достижения" back="/menu" dir=${dir}>
    <${Async} state=${st}>${(d) => {
      const got = d.badges.filter((b) => b.at).length;
      return html`
        <div class="card hero row-flex" style="gap:16px">
          <${Ring} value=${(got / d.badges.length) * 100} size=${72} stroke=${8} color="#fff" track="rgba(255,255,255,.3)" label=${`${got}`} fontSize=${22} />
          <div style="position:relative;z-index:1"><div style="font-size:22px;font-weight:750;letter-spacing:-.02em">${got} из ${d.badges.length}</div><div class="muted small">достижений открыто</div></div>
        </div>
        <div class="badge-grid">${d.badges.map((b) => html`<div key=${b.code} class=${`badge-tile ${b.at ? '' : 'locked'}`}>
          <div class="be">${b.emoji}</div><div class="bt">${b.title}</div><div class="bd">${b.at ? dayMonth(b.at) : b.desc}</div>
        </div>`)}</div>`;
    }}</${Async}>
  </${Page}>`;
}
