// Материалы: папки и ссылки
import { html, useState, useG, gapi, hostOf, relative } from '../lib.js';
import { Page, Icon, List, Field, AutoTextarea, Empty, Async, NavButton, openSheet, SheetLayout, actionSheet, confirm, attempt } from '../ui.js';
import { navigate } from '../router.js';
import { openLink, haptic } from '../tg.js';

const EMOJIS = ['📁', '📚', '🎓', '💡', '🎬', '🎧', '📝', '🧠', '💼', '📈', '🌍', '🛠', '🎨', '🏆', '❤️', '⭐️'];

function FolderForm({ close, folder, parentId, onSaved }) {
  const [name, setName] = useState(folder?.name || '');
  const [emoji, setEmoji] = useState(folder?.emoji || '📁');
  const save = async () => {
    const r = await attempt(() => gapi(folder ? `/folders/${folder.id}` : '/folders', { method: folder ? 'PATCH' : 'POST', body: { name, emoji, parent_id: parentId } }));
    if (r) { onSaved(); close(r); }
  };
  return html`<${SheetLayout} title=${folder ? 'Папка' : 'Новая папка'} close=${close} done=${save} doneLabel="Сохранить" doneDisabled=${!name.trim()}>
    <div class="form">
      <${Field} label="Название"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Например: Подготовка к ЕГЭ" maxLength="80" autofocus /></${Field}>
      <${Field} label="Иконка"><div class="chips">${EMOJIS.map((e) => html`<button class=${`chip ${e === emoji ? 'selected' : ''}`} style="font-size:20px;height:42px;width:42px;justify-content:center;padding:0" onClick=${() => { haptic.select(); setEmoji(e); }}>${e}</button>`)}</div></${Field}>
    </div>
  </${SheetLayout}>`;
}

function LinkForm({ close, item, folderId, onSaved }) {
  const [f, setF] = useState({ title: item?.title || '', url: item?.url || '', note: item?.note || '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    const r = await attempt(() => gapi(item ? `/materials/${item.id}` : '/materials', { method: item ? 'PATCH' : 'POST', body: { ...f, folder_id: item ? item.folder_id : folderId } }), item ? 'Сохранено' : 'Материал добавлен');
    if (r) { onSaved(); close(r); }
  };
  return html`<${SheetLayout} title=${item ? 'Материал' : 'Новая ссылка'} close=${close} done=${save} doneLabel="Сохранить" doneDisabled=${!f.title.trim() || !f.url.trim()}>
    <div class="form">
      <${Field} label="Ссылка"><input class="input" value=${f.url} onInput=${set('url')} placeholder="https://" inputmode="url" autofocus /></${Field}>
      <${Field} label="Название"><input class="input" value=${f.title} onInput=${set('title')} placeholder="Как называется материал" maxLength="200" /></${Field}>
      <${Field} label="Комментарий"><${AutoTextarea} value=${f.note} onInput=${set('note')} placeholder="Зачем смотреть, на что обратить внимание" rows=${2} /></${Field}>
    </div>
  </${SheetLayout}>`;
}

function Favicon({ url }) {
  const host = hostOf(url);
  const [ok, setOk] = useState(true);
  return html`<div class="favicon">${ok && host ? html`<img src=${`https://icons.duckduckgo.com/ip3/${host}.ico`} alt="" loading="lazy" onError=${() => setOk(false)} />` : (host[0] || '🔗').toUpperCase()}</div>`;
}

export function MaterialsPage({ folder, dir }) {
  const [q, setQ] = useState('');
  const st = useG(`/materials${folder ? `?folder=${folder}` : ''}${q.trim() ? `${folder ? '&' : '?'}q=${encodeURIComponent(q.trim())}` : ''}`);
  const d = st.data;
  const parentPath = d?.path?.length > 1 ? `/materials/${d.path[d.path.length - 2].id}` : '/materials';

  const add = () => actionSheet([
    { label: 'Ссылка', onClick: () => openSheet(LinkForm, { folderId: folder ? +folder : null, onSaved: st.reload }) },
    { label: 'Папка', onClick: () => openSheet(FolderForm, { parentId: folder ? +folder : null, onSaved: st.reload }) },
  ], 'Добавить');
  const itemMenu = (m) => actionSheet([
    { label: 'Изменить', onClick: () => openSheet(LinkForm, { item: m, onSaved: st.reload }) },
    { label: 'Удалить', danger: true, onClick: async () => { if (await confirm(`Удалить «${m.title}»?`, { ok: 'Удалить', danger: true })) { await attempt(() => gapi(`/materials/${m.id}`, { method: 'DELETE' })); st.reload(); } } },
  ]);
  const folderMenu = () => actionSheet([
    { label: 'Переименовать', onClick: () => openSheet(FolderForm, { folder: d.folder, onSaved: st.reload }) },
    { label: 'Удалить папку', danger: true, onClick: async () => {
      if (await confirm('Удалить папку со всем содержимым?', { ok: 'Удалить', danger: true }) && await attempt(() => gapi(`/folders/${folder}`, { method: 'DELETE' }))) navigate(parentPath, { replace: true });
    } },
  ]);

  const linkRow = (m) => html`<div class="row" key=${m.id}>
    <button class="row-flex tap" style="flex:1;min-width:0;gap:12px;text-align:left" onClick=${() => openLink(m.url)}>
      <${Favicon} url=${m.url} />
      <div class="row-main"><div class="row-title bold">${m.title}</div><div class="row-sub">${m.note || hostOf(m.url)}${m.folder_name ? ` · ${m.folder_name}` : ''}</div></div>
    </button>
    ${d.can_edit ? html`<button class="nav-btn" style="color:var(--label-3)" onClick=${() => itemMenu(m)} aria-label="Действия"><${Icon} name="ellipsis" size=${20} /></button>`
      : html`<${Icon} name="external-link" size=${18} style="color:var(--label-3);flex:none" />`}
  </div>`;

  return html`<${Page} title=${d?.folder ? `${d.folder.emoji} ${d.folder.name}` : 'Материалы'} back=${folder ? parentPath : '/menu'} dir=${dir}
    right=${d?.can_edit && html`${folder && html`<${NavButton} icon="pencil" label="Папка" onClick=${folderMenu} />`}<${NavButton} icon="plus" label="Добавить" accent onClick=${add} />`}>
    ${!folder && html`<div class="search"><${Icon} name="search" /><input class="input" type="search" placeholder="Поиск по материалам" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>`}
    ${d?.path?.length > 1 && html`<div class="crumbs"><button onClick=${() => navigate('/materials')}>Материалы</button>${d.path.slice(0, -1).map((p) => html`<span>›</span><button onClick=${() => navigate(`/materials/${p.id}`)}>${p.name}</button>`)}</div>`}
    <${Async} state=${st}>${(d) => d.found ? html`
      ${d.found.length ? html`<${List}>${d.found.map(linkRow)}</${List}>` : html`<${Empty} emoji="🔍" title="Ничего не нашли" />`}`
      : html`
      ${d.folders.length > 0 && html`<div class="folder-grid">${d.folders.map((f) => html`<button key=${f.id} class="folder tap" onClick=${() => navigate(`/materials/${f.id}`)}>
        <span class="fe">${f.emoji}</span><span class="spacer"></span><div><div class="fn">${f.name}</div><div class="fc">${f.items ? `${f.items} шт.` : 'Пусто'}</div></div>
      </button>`)}</div>`}
      ${d.materials.length > 0 && html`<${List}>${d.materials.map(linkRow)}</${List}>`}
      ${!d.folders.length && !d.materials.length && html`<${Empty} emoji=${folder ? '📂' : '📚'} title=${folder ? 'Папка пуста' : 'Материалов пока нет'}
        text=${d.can_edit ? 'Собирайте полезные ссылки по папкам: статьи, видео, записи эфиров, шаблоны.' : 'Здесь появятся полезные ссылки от наставника.'}
        action=${d.can_edit ? 'Добавить' : null} onAction=${add} />`}
      ${d.materials.length > 0 && html`<div class="hint center">Обновлено ${relative(d.materials[0].created_at)}</div>`}
    `}</${Async}>
  </${Page}>`;
}

