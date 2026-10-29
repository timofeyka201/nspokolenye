import { html, render, useEffect, api, store, useStore, setToken, hasToken, storage, clearCache, currentGroup } from './lib.js';
import { useRoute, match, navigate, TABS } from './router.js';
import { TabBar, SheetHost, ToastHost, toast } from './ui.js';
import { initTelegram, isTelegram, tg, startParam } from './tg.js';
import { Login, Onboarding, NoGroup, Splash } from './views/auth.js';
import { Home } from './views/home.js';
import { CalendarTab, EventPage, FeedbackPage, FeedbackSummary, FeedbackOverview } from './views/calendar.js';
import { GoalsTab, GoalPage, UserGoals } from './views/goals.js';
import { PeopleTab, MemberPage, ThanksPage, MatchPage } from './views/people.js';
import { MenuTab, ProfileEdit, SettingsPage, AdminPage, AdminMembers, PointsInfo } from './views/menu.js';
import { MaterialsPage } from './views/materials.js';
import { TasksPage, TaskPage } from './views/tasks.js';
import { PollsPage, PollPage } from './views/polls.js';
import { QuestionsPage } from './views/questions.js';
import { CoffeePage } from './views/coffee.js';
import { RatingPage, BadgesPage } from './views/rating.js';
import { PostsPage } from './views/posts.js';

const ROUTES = [
  ['/', Home], ['/calendar', CalendarTab], ['/goals', GoalsTab], ['/people', PeopleTab], ['/menu', MenuTab],
  ['/event/:id', EventPage], ['/event/:id/feedback', FeedbackPage], ['/event/:id/feedback-summary', FeedbackSummary], ['/feedback', FeedbackOverview],
  ['/goal/:id', GoalPage], ['/goals/user/:uid', UserGoals],
  ['/member/:id', MemberPage], ['/thanks', ThanksPage], ['/match', MatchPage],
  ['/profile', ProfileEdit], ['/settings', SettingsPage], ['/admin', AdminPage], ['/admin/members', AdminMembers], ['/points', PointsInfo],
  ['/materials', MaterialsPage], ['/materials/:folder', MaterialsPage],
  ['/tasks', TasksPage], ['/task/:id', TaskPage],
  ['/polls', PollsPage], ['/poll/:id', PollPage],
  ['/questions', QuestionsPage], ['/questions/:tab', QuestionsPage],
  ['/coffee', CoffeePage], ['/rating', RatingPage], ['/badges', BadgesPage], ['/posts', PostsPage],
];

function resolve(path) {
  for (const [p, C] of ROUTES) {
    const params = match(p, path);
    if (params) return { C, params };
  }
  return { C: Home, params: {} };
}

// Выбор текущей группы: сохранённая → последняя на сервере → первая активная
function pickGroup(me) {
  const active = me.groups.filter((g) => g.status === 'active');
  const saved = +storage.get('pk_gid');
  const g = active.find((x) => x.id === saved) || active.find((x) => x.id === me.user.current_group) || active.find((x) => !x.admin_view) || active[0];
  return g?.id ?? null;
}

export function switchGroup(id) {
  storage.set('pk_gid', String(id));
  clearCache();
  store.set({ gid: id });
  api('/me', { method: 'PATCH', body: { current_group: id } }).catch(() => {});
  navigate('/', { replace: true });
}

// Параметр запуска Mini App: join_КОД — вступить в группу, иначе это путь экрана (event-12 → /event/12)
async function handleStart(param) {
  if (!param) return;
  if (param.startsWith('join_')) {
    try {
      const r = await api('/join', { method: 'POST', body: { code: param.slice(5) } });
      store.set({ me: r.me });
      if (r.status === 'active') storage.set('pk_gid', String(r.group.id));
      toast(r.status === 'active' ? `Добро пожаловать в «${r.group.name}»!` : 'Заявка в группу отправлена');
    } catch (e) {
      toast(e.message, { error: true });
    }
    return;
  }
  navigate('/' + param.replace(/-/g, '/'), { replace: true });
}

export async function boot() {
  let param = '';
  const joinMatch = location.pathname.match(/^\/join\/([\w-]+)/);
  if (joinMatch) { storage.set('pk_join', joinMatch[1]); history.replaceState({ depth: 0 }, '', '/'); }
  try {
    if (isTelegram) {
      const r = await api('/auth/telegram', { method: 'POST', body: { initData: tg.initData } });
      setToken(r.token);
      param = r.startParam || startParam();
    }
    if (!hasToken()) { store.set({ me: null, booted: true }); return; }
    let me = await api('/me');
    store.set({ me });
    const pendingJoin = storage.get('pk_join');
    if (pendingJoin) { storage.set('pk_join', null); param = `join_${pendingJoin}`; }
    if (param && boot.handled !== param) { boot.handled = param; await handleStart(param); me = store.get().me; }
    store.set({ me, gid: pickGroup(me), booted: true });
  } catch (e) {
    if (e.status === 401 || !hasToken()) store.set({ me: null, booted: true });
    else { store.set({ booted: true, fatal: e.message }); }
  }
}

function Fatal({ text }) {
  return html`<div class="empty" style="min-height:100dvh;justify-content:center">
    <div class="em">😕</div><h3>Не удалось загрузить</h3><p>${text}</p>
    <button class="btn tinted sm" onClick=${() => location.reload()}>Обновить</button>
  </div>`;
}

function Shell() {
  const route = useRoute();
  const badges = useStore((s) => s.badges) || {};
  useStore((s) => s.gid);
  const { C, params } = resolve(route.path);
  const isTab = TABS.includes(route.path);
  return html`<${C} key=${route.path + route.search} ...${params} dir=${isTab ? 'none' : route.dir} />
    <${TabBar} path=${isTab ? route.path : null} badges=${badges} />`;
}

function App() {
  const s = useStore();
  useEffect(() => {
    const out = () => store.set({ me: null });
    window.addEventListener('pk:logout', out);
    return () => window.removeEventListener('pk:logout', out);
  }, []);
  let body;
  if (!s.booted) body = html`<${Splash} />`;
  else if (s.fatal) body = html`<${Fatal} text=${s.fatal} />`;
  else if (!s.me) body = html`<${Login} />`;
  else if (!s.me.user.onboarded) body = html`<${Onboarding} />`;
  else if (!currentGroup() || currentGroup().status !== 'active') body = html`<${NoGroup} />`;
  else body = html`<${Shell} key=${s.gid} />`;
  return html`${body}<${SheetHost} /><${ToastHost} />`;
}

initTelegram();
render(html`<${App} />`, document.getElementById('app'));
boot();
