import { html, useG, gapi, useState } from '../lib.js';
import { Page, List, Row, Section, Async, Empty, Button, Field, SheetLayout, openSheet, attempt } from '../ui.js';

const guide = [
  ['/', 'Главная', 'Посмотрите ближайшую встречу, объявления и быстрые действия.'],
  ['/calendar', 'Календарь', 'Откройте встречу, чтобы узнать детали. Когда откроется отметка, отсканируйте QR-код или введите код встречи.'],
  ['/goals', 'Цели', 'Создайте цель, разбейте её на шаги и отмечайте прогресс.'],
  ['/people', 'Люди', 'Посмотрите профили и узнайте, кто может помочь.'],
  ['/tasks', 'Задания', 'Откройте задание, отметьте выполнение и при необходимости добавьте комментарий.'],
  ['/materials', 'Материалы', 'Ищите ссылки и папки, которые собрала команда.'],
  ['/questions', 'Анонимные вопросы', 'Выберите получателя и напишите вопрос. Ответ появится в этом же разделе.'],
  ['/settings', 'Уведомления', 'Выберите уведомления от бота и настройте тихие часы.'],
];

export function GuidePage({ dir }) {
  return html`<${Page} title="Как пользоваться приложением" back="/menu" dir=${dir}>
    <${Section} title="С чего начать">
      <p class="small">Войдите через Telegram, заполните профиль и вступите в группу по приглашению.</p>
    </${Section}>
    <${List}>${guide.map(([href, title, sub]) => html`<${Row} key=${href} href=${href} title=${title} sub=${sub} />`)}</${List}>
  </${Page}>`;
}

function ConstitutionEditor({ close, initialText, save }) {
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const done = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (await save(text)) close();
    } finally {
      setSaving(false);
    }
  };
  return html`<${SheetLayout} title="Редактировать конституцию" close=${close} done=${done}
    doneLabel="Сохранить" doneDisabled=${saving || text === initialText}>
    <${Field} label="Правила и договорённости">
      <textarea class="input" rows="10" maxlength="12000" value=${text}
        onInput=${(e) => setText(e.target.value)} />
    </${Field}>
  </${SheetLayout}>`;
}

export function ConstitutionPage({ dir }) {
  const state = useG('/constitution');
  const edit = (initialText) => openSheet(ConstitutionEditor, {
    initialText,
    save: async (text) => {
      const saved = await attempt(() => gapi('/constitution', { method: 'PATCH', body: { text } }), 'Конституция сохранена');
      if (saved) state.setData(saved);
      return saved;
    },
  });
  return html`<${Page} title="Конституция группы" back="/menu" dir=${dir}>
    <${Async} state=${state}>${(data) => html`
      ${data.text ? html`<div class="card pre">${data.text}</div>`
        : html`<${Empty} title="Конституция пока не заполнена" text="Здесь будут правила и договорённости вашей группы." />`}
      ${data.can_edit && html`<${Button} kind="secondary" icon="pencil" onClick=${() => edit(data.text)}>Редактировать</${Button}>`}
    `}</${Async}>
  </${Page}>`;
}
