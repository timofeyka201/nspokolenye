// Задания от наставника
import { html, useState, useG, gapi, currentGroup, dayLabel, time, toLocalInput, fromLocalInput, relative } from '../lib.js';
import { Page, Icon, List, Row, Section, Button, Segmented, Toggle, Field, AutoTextarea, Empty, Async, NavButton, openSheet, SheetLayout, actionSheet, confirm, attempt } from '../ui.js';
import { navigate, back } from '../router.js';
import { openLink, haptic } from '../tg.js';

function TaskForm({ close, task, onSaved }) {
  const g = currentGroup();
  const [f, setF] = useState(() => task ? { ...task, due_at: toLocalInput(task.due_at) } : { title: '', description: '', url: '', due_at: '' });
  const [toChat, setToChat] = useState(g.chat_linked);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    const body = { title: f.title, description: f.description, url: f.url, due_at: fromLocalInput(f.due_at), toChat };
    const r = await attempt(() => gapi(task ? `/tasks/${task.id}` : '/tasks', { method: task ? 'PATCH' : 'POST', body }), task ? 'Сохранено' : 'Задание опубликовано');
    if (r) { onSaved?.(r); close(r); }
  };
  return html`<${SheetLayout} title=${task ? 'Изменить задание' : 'Новое задание'} close=${close} done=${save} doneLabel=${task ? 'Сохранить' : 'Опубликовать'} doneDisabled=${!f.title.trim()}>
    <div class="form">
      <${Field} label="Задание"><input class="input" value=${f.title} onInput=${set('title')} placeholder="Например: прочитать главу и выписать 3 идеи" maxLength="200" /></${Field}>
      <${Field} label="Подробности"><${AutoTextarea} value=${f.description} onInput=${set('description')} placeholder="Что нужно сделать и в каком виде сдать" /></${Field}>
      <${Field} label="Ссылка на материал"><input class="input" value=${f.url} onInput=${set('url')} placeholder="https://" inputmode="url" /></${Field}>
      <${Field} label="Срок" hint="Бот напомнит тем, кто не сдал, за сутки"><input class="input" type="datetime-local" value=${f.due_at} onInput=${set('due_at')} /></${Field}>
      ${!task && g.chat_linked && html`<${List}><${Row} title="Написать в чат группы" right=${html`<${Toggle} checked=${toChat} onChange=${setToChat} />`} chevron=${false} /></${List}>`}
    </div>
  </${SheetLayout}>`;
}
export const openTaskForm = (props) => openSheet(TaskForm, props);

function dueChip(t) {
  if (t.done) return html`<span class="chip sm green">Сдано</span>`;
  if (!t.due_at) return html`<span class="chip sm">Без срока</span>`;
  const overdue = t.due_at < new Date().toISOString();
  return html`<span class=${`chip sm ${overdue ? 'red' : 'yellow'}`}>${overdue ? 'Просрочено' : `до ${dayLabel(t.due_at).toLowerCase()}`}</span>`;
}

export function TasksPage({ dir }) {
  const g = currentGroup();
  const st = useG('/tasks');
  const [tab, setTab] = useState('open');
  return html`<${Page} title="Задания" back="/menu" dir=${dir}
    right=${g.is_staff && html`<${NavButton} icon="plus" label="Новое задание" accent onClick=${() => openTaskForm({ onSaved: () => st.reload() })} />`}>
    ${g.role === 'participant' && html`<${Segmented} value=${tab} onChange=${setTab} options=${[{ value: 'open', label: 'Текущие' }, { value: 'done', label: 'Сданные' }]} />`}
    <${Async} state=${st}>${(d) => {
      const list = g.role === 'participant' ? d.tasks.filter((t) => (tab === 'done') === t.done) : d.tasks;
      if (!list.length) return html`<${Empty} emoji=${tab === 'done' ? '🏁' : '🎉'} title=${tab === 'done' ? 'Пока ничего не сдано' : 'Все задания выполнены'}
        text=${g.is_staff ? 'Публикуйте задания для группы: участники отметят выполнение, а вы увидите, кто сдал.' : 'Новые задания от наставника появятся здесь.'}
        action=${g.is_staff ? 'Новое задание' : null} onAction=${() => openTaskForm({ onSaved: () => st.reload() })} />`;
      return html`<div class="stack-sm">${list.map((t) => html`<button key=${t.id} class="card tap stack-sm" style="text-align:left" onClick=${() => navigate(`/task/${t.id}`)}>
        <div class="row-flex" style="align-items:flex-start">
          <div class="row-main"><div class="card-title">${t.title}</div>
            ${t.description && html`<div class="card-sub" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${t.description}</div>`}</div>
          ${t.done && html`<span class="check on"><${Icon} name="check" /></span>`}
        </div>
        <div class="row-flex">${dueChip(t)}${t.due_at && html`<span class="small muted">${time(t.due_at)}</span>`}<span class="spacer"></span>
          ${g.is_staff && html`<span class="small muted">Сдали ${t.done_count} из ${d.participants}</span>`}</div>
      </button>`)}</div>`;
    }}</${Async}>
  </${Page}>`;
}

function DoneSheet({ close, task, onDone }) {
  const [comment, setComment] = useState(task.my_comment || '');
  const save = async () => {
    const r = await attempt(() => gapi(`/tasks/${task.id}/done`, { method: 'POST', body: { comment } }), 'Задание сдано! +5 баллов');
    if (r) { haptic.success(); onDone(r); close(); }
  };
  return html`<${SheetLayout} title="Сдать задание" close=${close} done=${save} doneLabel="Сдать">
    <div class="form">
      <p class="muted">${task.title}</p>
      <${Field} label="Комментарий или ссылка на работу" hint="Необязательно. Увидит только команда группы."><${AutoTextarea} value=${comment} onInput=${setComment} placeholder="Например, ссылка на документ" autofocus /></${Field}>
    </div>
  </${SheetLayout}>`;
}

export function TaskPage({ id, dir }) {
  const g = currentGroup();
  const st = useG(`/tasks/${id}`);
  const t = st.data;
  const menu = () => actionSheet([
    { label: 'Изменить', onClick: () => openTaskForm({ task: t, onSaved: () => st.reload() }) },
    { label: 'Удалить', danger: true, onClick: async () => {
      if (await confirm('Удалить задание?', { ok: 'Удалить', danger: true }) && await attempt(() => gapi(`/tasks/${t.id}`, { method: 'DELETE' }), 'Удалено')) back('/tasks');
    } },
  ]);
  return html`<${Page} title="Задание" back="/tasks" dir=${dir} large=${false} right=${g.is_staff && t && html`<${NavButton} icon="ellipsis" label="Действия" onClick=${menu} />`}>
    <${Async} state=${st}>${(t) => html`
      <div class="stack-sm">
        <div class="row-flex">${dueChip(t)}${t.due_at && html`<span class="small muted">${dayLabel(t.due_at)}, ${time(t.due_at)}</span>`}</div>
        <h1 style="font-size:28px;font-weight:750;letter-spacing:-.03em;line-height:1.15">${t.title}</h1>
        ${t.author && html`<div class="small muted">${t.author.name} · ${relative(t.created_at)}</div>`}
      </div>
      ${t.description && html`<div class="card pre" style="font-size:16px;line-height:1.45">${t.description}</div>`}
      ${t.url && html`<${List}><${Row} icon="link" color="blue" title="Открыть материал" sub=${t.url} onClick=${() => openLink(t.url)} /></${List}>`}

      ${g.role === 'participant' && (t.done ? html`
        <div class="banner green"><div class="bi"><${Icon} name="check" /></div><div class="row-main"><div class="bold">Задание сдано</div>${t.my_comment && html`<div class="small muted pre">${t.my_comment}</div>`}</div></div>
        <${Button} kind="secondary" block onClick=${async () => { const r = await attempt(() => gapi(`/tasks/${t.id}/done`, { method: 'DELETE' })); if (r) st.setData((x) => ({ ...x, ...r })); }}>Отменить сдачу</${Button}>`
        : html`<${Button} block icon="check" onClick=${() => openSheet(DoneSheet, { task: t, onDone: (r) => st.setData((x) => ({ ...x, ...r })) })}>Я выполнил(а)</${Button}>`)}

      ${t.completions && html`<${Section} title=${`Сдали ${t.completions.filter((c) => c.done).length} из ${t.completions.length}`}>
        <${List}>${t.completions.map((c) => html`<${Row} key=${c.id} avatar=${c} title=${c.name} sub=${c.done ? (c.comment || `Сдано ${relative(c.at)}`) : 'Ещё не сдано'}
          right=${html`<span class=${`check ${c.done ? 'on' : ''}`}><${Icon} name="check" /></span>`} chevron=${false}
          onClick=${c.comment && /^https?:\/\//.test(c.comment.trim()) ? () => openLink(c.comment.trim()) : null} />`)}</${List}>
      </${Section}>`}
    `}</${Async}>
  </${Page}>`;
}

