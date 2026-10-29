// Объявления от команды группы
import { html, useState, useG, gapi, currentGroup, relative } from '../lib.js';
import { Page, Icon, List, Row, Toggle, AutoTextarea, Empty, Async, Avatar, NavButton, openSheet, SheetLayout, actionSheet, confirm, attempt } from '../ui.js';

function PostForm({ close, post, onSaved }) {
  const g = currentGroup();
  const [text, setText] = useState(post?.text || '');
  const [pinned, setPinned] = useState(post?.pinned || false);
  const [toChat, setToChat] = useState(g.chat_linked);
  const save = async () => {
    const r = await attempt(() => gapi(post ? `/posts/${post.id}` : '/posts', { method: post ? 'PATCH' : 'POST', body: { text, pinned, toChat } }), post ? 'Сохранено' : 'Опубликовано');
    if (r) { onSaved?.(); close(r); }
  };
  return html`<${SheetLayout} title=${post ? 'Изменить' : 'Объявление'} close=${close} done=${save} doneLabel=${post ? 'Сохранить' : 'Опубликовать'} doneDisabled=${!text.trim()}>
    <div class="form">
      <${AutoTextarea} value=${text} onInput=${setText} placeholder="Текст объявления" rows=${6} maxLength=${4000} autofocus />
      <${List}>
        <${Row} icon="pin" title="Закрепить" right=${html`<${Toggle} checked=${pinned} onChange=${setPinned} />`} chevron=${false} />
        ${!post && g.chat_linked && html`<${Row} icon="send" color="blue" title="Отправить в чат группы" right=${html`<${Toggle} checked=${toChat} onChange=${setToChat} />`} chevron=${false} />`}
      </${List}>
      ${!post && html`<div class="hint">Участники получат объявление в личные сообщения от бота.</div>`}
    </div>
  </${SheetLayout}>`;
}
export const openPostForm = (props) => openSheet(PostForm, props);

export function PostsPage({ dir }) {
  const g = currentGroup();
  const st = useG('/posts');
  const menu = (p) => actionSheet([
    { label: p.pinned ? 'Открепить' : 'Закрепить', onClick: async () => { await attempt(() => gapi(`/posts/${p.id}`, { method: 'PATCH', body: { pinned: !p.pinned } })); st.reload(); } },
    { label: 'Изменить', onClick: () => openPostForm({ post: p, onSaved: st.reload }) },
    { label: 'Удалить', danger: true, onClick: async () => { if (await confirm('Удалить объявление?', { ok: 'Удалить', danger: true })) { await attempt(() => gapi(`/posts/${p.id}`, { method: 'DELETE' })); st.reload(); } } },
  ]);
  return html`<${Page} title="Объявления" back="/menu" dir=${dir}
    right=${g.is_staff && html`<${NavButton} icon="plus" label="Новое объявление" accent onClick=${() => openPostForm({ onSaved: st.reload })} />`}>
    <${Async} state=${st}>${(d) => d.posts.length ? html`<div class="stack-sm">${d.posts.map((p) => html`<div key=${p.id} class="card stack-sm">
      <div class="row-flex">
        <${Avatar} user=${p.author} size=${32} />
        <div class="row-main"><div class="small bold">${p.author?.name || 'Команда'}</div><div class="tiny muted">${relative(p.created_at)}</div></div>
        ${p.pinned && html`<span class="chip sm accent"><${Icon} name="pin" />Закреплено</span>`}
        ${d.can_edit && html`<button class="nav-btn round" style="width:30px;height:30px;min-width:30px" onClick=${() => menu(p)} aria-label="Действия"><${Icon} name="ellipsis" size=${18} /></button>`}
      </div>
      <div class="pre" style="font-size:16px;line-height:1.45">${p.text}</div>
    </div>`)}</div>`
      : html`<${Empty} emoji="📣" title="Объявлений пока нет" text=${g.is_staff ? 'Важные новости для группы: участники получат их в личку, а закреплённые будут видны на главной.' : 'Здесь появятся новости от наставника и команды.'}
        action=${g.is_staff ? 'Написать' : null} onAction=${() => openPostForm({ onSaved: st.reload })} />`}</${Async}>
  </${Page}>`;
}
