import crypto from 'node:crypto';
import { SECRET, all } from './db.js';

// Анонимность: в базе хранится не автор, а HMAC от его id с секретом сервера.
// По хэшу нельзя узнать человека, но можно: не дать оставить отзыв дважды,
// показать автору его же вопросы, доставить ответ и заблокировать спамера, не раскрывая его.
const hmac = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');

export const questionAuthorHash = (groupId, userId) => hmac(`q:${groupId}:${userId}`);
export const feedbackAuthorHash = (eventId, userId) => hmac(`fb:${eventId}:${userId}`);

// Найти автора вопроса среди участников группы — только чтобы отправить ему уведомление об ответе
export function findQuestionAuthor(groupId, hash) {
  const ids = all("SELECT user_id FROM members WHERE group_id = ? AND status = 'active'", groupId);
  return ids.find((m) => questionAuthorHash(groupId, m.user_id) === hash)?.user_id ?? null;
}
