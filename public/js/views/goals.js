// Цели и прогресс: свои цели, шаги, отметки движения; общая картина для наставника
import { html, useState, useG, gapi, currentGroup, dayMonth, relative, pl } from '../lib.js';
import { Page, Icon, List, Row, Section, Button, Segmented, Field, AutoTextarea, Empty, Async, Ring, Bar, Avatar, NavButton, openSheet, SheetLayout, actionSheet, confirm, toast, attempt } from '../ui.js';
import { navigate, back, query } from '../router.js';
import { haptic } from '../tg.js';

function GoalForm({ close, goal, onSaved }) {
  const [f, setF] = useState(() => goal ? { title: goal.title, description: goal.description, due_date: goal.due_date || '' } : { title: '', description: '', due_date: '' });
  const [steps, setSteps] = useState(['', '']);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    const body = { ...f, due_date: f.due_date || null, ...(goal ? {} : { steps: steps.filter((s) => s.trim()) }) };
    const r = await attempt(() => gapi(goal ? `/goals/${goal.id}` : '/goals', { method: goal ? 'PATCH' : 'POST', body }), goal ? 'Сохранено' : 'Цель поставлена 🎯');
    if (r) { onSaved?.(r); close(r); }
  };
  return html`<${SheetLayout} title=${goal ? 'Изменить цель' : 'Новая цель'} close=${close} done=${save} doneLabel=${goal ? 'Сохранить' : 'Создать'} doneDisabled=${!f.title.trim()}>
    <div class="form">
      <${Field} label="Цель" hint="Конкретно и измеримо: «Сдать IELTS на 7.0», а не «Выучить английский»">
        <input class="input" value=${f.title} onInput=${set('title')} placeholder="Чего хочу достичь" maxLength="120" autofocus />
      </${Field}>
      <${Field} label="Зачем это мне"><${AutoTextarea} value=${f.description} onInput=${set('description')} placeholder="Необязательно" rows=${2} /></${Field}>
      <${Field} label="Срок"><input class="input" type="date" value=${f.due_date} onInput=${set('due_date')} /></${Field}>
      ${!goal && html`<${Field} label="Шаги к цели" hint="Прогресс будет считаться по выполненным шагам. Можно добавить позже.">
        <div class="stack-sm">
          ${steps.map((s, i) => html`<input class="input" value=${s} placeholder=${`Шаг ${i + 1}`} maxLength="200"
            onInput=${(e) => setSteps((x) => { const n = [...x]; n[i] = e.target.value; if (i === n.length - 1 && e.target.value && n.length < 15) n.push(''); return n; })} />`)}
        </div>
      </${Field}>`}
    </div>
  </${SheetLayout}>`;
}
export const openGoalForm = (props) => openSheet(GoalForm, props);

function UpdateSheet({ close, goal, onSaved }) {
  const [text, setText] = useState('');
  const [progress, setProgress] = useState(goal.progress);
  const manual = goal.steps_total === 0;
  const save = async () => {
    const r = await attempt(() => gapi(`/goals/${goal.id}/updates`, { method: 'POST', body: { text, progress: manual ? progress : null } }), 'Прогресс отмечен! +3 балла');
    if (r) { haptic.success(); onSaved(); close(); }
  };
  return html`<${SheetLayout} title="Шаг вперёд" close=${close} done=${save} doneLabel="Сохранить" doneDisabled=${!text.trim()}>
    <div class="form">
      <${Field} label="Что сделано"><${AutoTextarea} value=${text} onInput=${setText} placeholder="Например: решил 20 задач из второй части" autofocus /></${Field}>
      ${manual && html`<${Field} label=${`Прогресс: ${progress}%`}>
        <input type="range" class="range" min="0" max="100" step="5" value=${progress} style=${{ '--v': progress + '%' }}
          onInput=${(e) => { setProgress(+e.target.value); haptic.select(); }} />
      </${Field}>`}
    </div>
  </${SheetLayout}>`;
}

export function GoalCard({ g, onClick }) {
  return html`<button class="card tap row-flex" style="gap:14px;text-align:left;width:100%" onClick=${onClick || (() => navigate(`/goal/${g.id}`))}>
    <${Ring} value=${g.progress} size=${58} stroke=${6} label=${g.status === 'done' ? '✓' : null} fontSize=${g.status === 'done' ? 22 : 15} />
    <div class="row-main">
      <div class="card-title" style="line-height:1.25">${g.title}</div>
      <div class="small muted" style="margin-top:3px">
        ${g.status === 'done' ? 'Достигнута 🎉' : [g.steps_total ? `${g.steps_done} из ${g.steps_total} ${pl(g.steps_total, ['шага', 'шагов', 'шагов']).split(' ')[1]}` : null, g.due_date ? `до ${dayMonth(g.due_date)}` : null].filter(Boolean).join(' · ') || 'В процессе'}
      </div>
    </div>
    <${Icon} name="chevron-right" class="chev" />
  </button>`;
}

function MyGoals() {
  const st = useG('/goals');
  return html`<${Async} state=${st}>${(d) => {
    const active = d.goals.filter((g) => g.status === 'active'), done = d.goals.filter((g) => g.status === 'done');
    if (!d.goals.length) return html`<${Empty} emoji="🎯" title="Поставьте первую цель" text="Цель + шаги к ней. Отмечайте движение — наставник увидит прогресс и поможет, если застрянете." action="Новая цель" icon="plus" onAction=${() => openGoalForm({ onSaved: st.reload })} />`;
    return html`
      ${active.length > 0 && html`<div class="card hero row-flex" style="gap:16px">
        <${Ring} value=${Math.round(active.reduce((s, g) => s + g.progress, 0) / active.length)} size=${76} stroke=${8} color="#fff" track="rgba(255,255,255,.3)" />
        <div style="position:relative;z-index:1"><div style="font-size:22px;font-weight:750;letter-spacing:-.02em">${pl(active.length, ['цель', 'цели', 'целей'])} в работе</div>
        <div class="muted small">Средний прогресс · достигнуто: ${done.length}</div></div>
      </div>`}
      ${active.length > 0 && html`<div class="stack-sm">${active.map((g) => html`<${GoalCard} key=${g.id} g=${g} />`)}</div>`}
      ${done.length > 0 && html`<${Section} title="Достигнутые"><div class="stack-sm">${done.map((g) => html`<${GoalCard} key=${g.id} g=${g} />`)}</div></${Section}>`}
    `;
  }}</${Async}>`;
}

function GroupGoals() {
  const st = useG('/goals/overview');
  return html`<${Async} state=${st}>${(d) => html`
    <div class="grid-3">
      <div class="card stat"><div class="num">${d.summary.with_goals}<span class="muted" style="font-size:16px">/${d.summary.participants}</span></div><div class="lbl">с целями</div></div>
      <div class="card stat"><div class="num">${d.summary.avg}%</div><div class="lbl">средний прогресс</div></div>
      <div class="card stat"><div class="num">${d.summary.done}</div><div class="lbl">достигнуто</div></div>
    </div>
    ${d.people.length ? html`<${List}>${d.people.map((p) => html`<${Row} key=${p.user.id} avatar=${p.user} title=${p.user.name}
      sub=${html`${p.active || p.done ? html`<div style="margin:6px 0 4px"><${Bar} value=${p.avg ?? (p.done ? 100 : 0)} /></div>` : null}
        ${p.active + p.done === 0 ? 'Нет целей' : `${pl(p.active, ['активная', 'активные', 'активных'])} · ${p.done} достигнуто`}${p.last_activity ? ` · ${relative(p.last_activity)}` : ''}`}
      value=${p.avg != null ? `${p.avg}%` : ''} href=${`/goals/user/${p.user.id}`} />`)}</${List}>`
      : html`<${Empty} emoji="👥" title="Участников пока нет" />`}
    <div class="hint center">Сортировка по имени. Давно не обновлявшиеся цели — повод спросить, нужна ли помощь.</div>
  `}</${Async}>`;
}

export function GoalsTab({ dir }) {
  const g = currentGroup();
  const [tab, setTab] = useState(query().tab === 'group' && g.is_staff ? 'group' : 'mine');
  const [key, setKey] = useState(0);
  return html`<${Page} title="Цели" dir=${dir}
    right=${tab === 'mine' && html`<${NavButton} icon="plus" label="Новая цель" accent onClick=${() => openGoalForm({ onSaved: () => setKey((k) => k + 1) })} />`}>
    ${g.is_staff && html`<${Segmented} value=${tab} onChange=${setTab} options=${[{ value: 'mine', label: 'Мои цели' }, { value: 'group', label: 'Группа' }]} />`}
    ${tab === 'mine' ? html`<${MyGoals} key=${key} />` : html`<${GroupGoals} />`}
  </${Page}>`;
}

export function UserGoals({ uid, dir }) {
  const st = useG(`/goals?user=${uid}`);
  const m = useG(`/members/${uid}`);
  return html`<${Page} title=${m.data ? `Цели · ${m.data.profile.first_name}` : 'Цели'} back="/goals?tab=group" dir=${dir}>
    ${m.data && html`<button class="card tap row-flex" style="gap:12px" onClick=${() => navigate(`/member/${uid}`)}><${Avatar} user=${m.data.profile} size=${44} /><div class="row-main"><div class="card-title">${m.data.profile.name}</div><div class="small muted">Открыть профиль</div></div><${Icon} name="chevron-right" class="chev" /></button>`}
    <${Async} state=${st}>${(d) => d.goals.length ? html`<div class="stack-sm">${d.goals.map((g) => html`<${GoalCard} key=${g.id} g=${g} />`)}</div>` : html`<${Empty} emoji="🎯" title="Целей пока нет" text="Можно предложить поставить цель на ближайшей встрече." />`}</${Async}>
  </${Page}>`;
}

export function GoalPage({ id, dir }) {
  const st = useG(`/goals/${id}`);
  const [newStep, setNewStep] = useState('');
  const d = st.data;
  const mine = d?.mine;
  const setGoal = (goal) => st.setData((x) => ({ ...x, goal }));

  const toggleStep = async (s) => {
    haptic.select();
    const r = await attempt(() => gapi(`/goals/${id}/steps/${s.id}`, { method: 'PATCH', body: { done: !s.done } }));
    if (r) {
      setGoal(r);
      if (r.status === 'done' && d.goal.status !== 'done') { haptic.success(); toast('Цель достигнута! 🎉 +15 баллов'); }
      else if (!s.done) toast('Шаг выполнен! +2 балла');
    }
  };
  const addStep = async () => {
    if (!newStep.trim()) return;
    const r = await attempt(() => gapi(`/goals/${id}/steps`, { method: 'POST', body: { title: newStep } }));
    if (r) { setGoal(r); setNewStep(''); }
  };
  const menu = () => actionSheet([
    { label: 'Изменить', onClick: () => openGoalForm({ goal: d.goal, onSaved: () => st.reload() }) },
    d.goal.status !== 'done' && { label: 'Отметить достигнутой 🎉', onClick: async () => {
      const r = await attempt(() => gapi(`/goals/${id}`, { method: 'PATCH', body: { status: 'done' } }), 'Поздравляем! +15 баллов');
      if (r) { haptic.success(); st.reload(); }
    } },
    d.goal.status === 'done' && { label: 'Вернуть в работу', onClick: async () => { await attempt(() => gapi(`/goals/${id}`, { method: 'PATCH', body: { status: 'active' } })); st.reload(); } },
    { label: 'В архив', onClick: async () => { if (await attempt(() => gapi(`/goals/${id}`, { method: 'PATCH', body: { status: 'archived' } }), 'Цель в архиве')) back('/goals'); } },
    { label: 'Удалить', danger: true, onClick: async () => {
      if (await confirm('Удалить цель вместе с шагами и историей?', { ok: 'Удалить', danger: true }) && await attempt(() => gapi(`/goals/${id}`, { method: 'DELETE' }), 'Удалено')) back('/goals');
    } },
  ]);

  return html`<${Page} title=${d?.goal.title || 'Цель'} back="/goals" dir=${dir} large=${false}
    right=${mine && html`<${NavButton} icon="ellipsis" label="Действия" onClick=${menu} />`}>
    <${Async} state=${st}>${({ goal, owner, updates }) => html`
      <div class="stack center" style="align-items:center;gap:12px;padding-top:4px">
        <${Ring} value=${goal.progress} size=${128} stroke=${12} label=${goal.status === 'done' ? '🎉' : null} fontSize=${goal.status === 'done' ? 44 : 30} />
        <h1 style="font-size:26px;font-weight:750;letter-spacing:-.025em;line-height:1.2">${goal.title}</h1>
        <div class="row-flex wrap" style="justify-content:center">
          ${!mine && html`<button class="chip tap" onClick=${() => navigate(`/member/${owner.id}`)}><${Avatar} user=${owner} size=${20} />${owner.name}</button>`}
          ${goal.status === 'done' ? html`<span class="chip green">Достигнута</span>` : html`<span class="chip accent">В работе</span>`}
          ${goal.due_date && html`<span class="chip">до ${dayMonth(goal.due_date)}</span>`}
        </div>
        ${goal.description && html`<p class="muted pre" style="font-size:15px">${goal.description}</p>`}
      </div>

      ${mine && goal.status === 'active' && html`<${Button} block icon="flag" onClick=${() => openSheet(UpdateSheet, { goal, onSaved: st.reload })}>Отметить прогресс</${Button}>`}

      ${(goal.steps.length > 0 || mine) && html`<${Section} title="Шаги">
        <${List}>
          ${goal.steps.map((s) => html`<div class="row" key=${s.id}>
            <button class=${`check ${s.done ? 'on' : ''}`} disabled=${!mine} onClick=${() => toggleStep(s)} aria-label="Выполнено"><${Icon} name="check" /></button>
            <div class="row-main"><div class="row-title" style=${s.done ? 'color:var(--label-2);text-decoration:line-through' : ''}>${s.title}</div></div>
            ${mine && html`<button class="nav-btn" style="color:var(--label-3);min-width:30px" aria-label="Удалить шаг" onClick=${async () => { const r = await attempt(() => gapi(`/goals/${id}/steps/${s.id}`, { method: 'DELETE' })); if (r) setGoal(r); }}><${Icon} name="x" size=${18} /></button>`}
          </div>`)}
          ${mine && html`<div class="row"><span class="check" style="border-style:dashed"></span>
            <input class="input" style="background:none;padding:0;min-height:30px;box-shadow:none" placeholder="Добавить шаг" value=${newStep}
              onInput=${(e) => setNewStep(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && addStep()} />
            ${newStep.trim() && html`<button class="nav-btn" onClick=${addStep}>Добавить</button>`}
          </div>`}
        </${List}>
      </${Section}>`}

      <${Section} title="История">
        ${updates.length ? html`<div class="card timeline">${updates.map((u) => html`<div class="tl-item" key=${u.id}>
          <span class="tl-dot"></span>
          <div class="row-main"><div class="pre">${u.text}</div><div class="tiny muted" style="margin-top:2px">${relative(u.created_at)}${u.progress != null ? ` · ${u.progress}%` : ''}</div></div>
        </div>`)}</div>` : html`<div class="card muted small center">${mine ? 'Отмечайте, что сделано, — так видно движение к цели.' : 'Записей пока нет.'}</div>`}
      </${Section}>
    `}</${Async}>
  </${Page}>`;
}

