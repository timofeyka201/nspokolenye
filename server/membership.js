import { get, run } from './db.js';
import { STAFF_ROLES } from './auth.js';
import { notifyMembers } from './notify.js';
import { isChatMember } from './bot.js';
import { HttpError, fullName } from './api/util.js';

// Вступление в группу по коду приглашения (из Mini App, сайта или ссылки t.me/бот?start=join_КОД)
export async function joinGroup(user, code) {
  const g = get('SELECT * FROM groups WHERE invite_code = ?', String(code || '').trim());
  if (!g) throw new HttpError(404, 'Приглашение не найдено или устарело. Попросите у куратора новую ссылку.');
  const m = get('SELECT * FROM members WHERE group_id = ? AND user_id = ?', g.id, user.id);
  if (m?.status === 'active') return { group: g, status: 'active', already: true };
  // Если человек уже в чате группы — подтверждаем сразу, иначе заявку одобряет команда
  const inChat = g.chat_id && user.tg_id ? await isChatMember(g.chat_id, user.tg_id) : false;
  const status = inChat ? 'active' : 'pending';
  run(`INSERT INTO members (group_id, user_id, status) VALUES (?, ?, ?)
    ON CONFLICT (group_id, user_id) DO UPDATE SET status = excluded.status, joined_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`, g.id, user.id, status);
  if (!user.current_group || status === 'active') run('UPDATE users SET current_group = ? WHERE id = ?', g.id, user.id);
  if (status === 'pending') {
    notifyMembers(g.id, `🙋 <b>${fullName(user)}</b> хочет вступить в группу «${g.name}»`, {
      roles: STAFF_ROLES, buttons: [[{ text: 'Посмотреть заявки', app: '/admin/members' }]],
    });
  }
  return { group: g, status };
}
