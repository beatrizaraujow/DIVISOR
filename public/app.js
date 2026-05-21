const appState = {
  session: null,
  dashboard: null,
  reports: null,
  loading: false,
  error: '',
  info: '',
  loginMode: 'login',
  reportFilters: defaultFilters(),
  goals: JSON.parse(localStorage.getItem('mktime_goals') || '{"daily":480,"weekly":2400}'),
  chartMode: 'week',
};

const COMPANY_CLASS = { Carbone: 'c0', Seubone: 'c1', Onevo: 'c2' };

function defaultFilters() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: toDateInput(monthStart), to: toDateInput(now), userId: '', companyId: '' };
}

function toDateInput(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function fmtDuration(minutes) {
  const safe = Math.max(0, Math.round(minutes || 0));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hours === 0) return `${mins}min`;
  return mins ? `${hours}h${String(mins).padStart(2, '0')}` : `${hours}h`;
}

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtLive(startAt) {
  const diff = Date.now() - new Date(startAt).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Falha na requisicao.');
  }
  const contentType = response.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) return response.json();
  return response.text();
}

async function loadSession() { appState.session = await request('/api/session'); }
async function loadDashboard() { appState.dashboard = await request('/api/dashboard'); }
async function loadReports() {
  const query = new URLSearchParams();
  const f = appState.reportFilters;
  if (f.from) query.set('from', f.from);
  if (f.to) query.set('to', f.to);
  if (f.userId) query.set('userId', f.userId);
  if (f.companyId) query.set('companyId', f.companyId);
  appState.reports = await request(`/api/reports?${query.toString()}`);
}
async function refreshAuthenticatedView() {
  await Promise.all([loadSession(), loadDashboard(), loadReports()]);
}
function setError(message) { appState.error = message; render(); }

async function boot() {
  try {
    await loadSession();
    if (appState.session.authenticated) await Promise.all([loadDashboard(), loadReports()]);
    render();
  } catch (error) { setError(error.message); }
}

function render() {
  const root = document.getElementById('app');
  if (!appState.session || !appState.session.authenticated) {
    root.innerHTML = loginView();
    bindLoginView();
    return;
  }
  root.innerHTML = dashboardView();
  bindDashboardView();
}

/* ============ LOGIN ============ */
function loginView() {
  const errorHtml = appState.error ? `<div class="lp-error">${appState.error}</div>` : '';
  return `
    <main class="login-page">
      <div class="lp-left">
        <img src="/logo/logo.png" alt="logo" class="lp-logo" />
      </div>
      <div class="lp-right">
        <div class="lp-card">
          <h2 class="lp-title">Entrar</h2>
          ${errorHtml}
          <form id="login-form">
            <div class="lp-field">
              <label class="lp-label" for="login">NOME</label>
              <input class="lp-input" id="login" name="login" autocomplete="username" placeholder="seu nome" required />
            </div>
            <div class="lp-field">
              <label class="lp-label" for="password">SENHA</label>
              <input class="lp-input" id="password" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required />
            </div>
            <button class="lp-btn" type="submit">ACESSAR</button>
          </form>
          <span class="lp-link">Alterar senha</span>
        </div>
      </div>
    </main>`;
}

function bindLoginView() {
  const form = document.getElementById('login-form');
  if (form) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      appState.error = '';
      const fd = new FormData(form);
      try {
        await request('/api/login', { method: 'POST', body: JSON.stringify({ login: fd.get('login'), password: fd.get('password') }) });
        appState.reportFilters = defaultFilters();
        appState.info = '';
        await refreshAuthenticatedView();
        render();
      } catch (err) { setError(err.message); }
    });
  }

  document.getElementById('show-change-password')?.addEventListener('click', () => {
    appState.loginMode = 'change-password';
    appState.error = '';
    render();
  });

  const cpForm = document.getElementById('change-password-form');
  if (cpForm) {
    cpForm.addEventListener('submit', async e => {
      e.preventDefault();
      appState.error = '';
      const fd = new FormData(cpForm);
      const login = fd.get('login');
      const currentPassword = fd.get('currentPassword');
      const newPassword = fd.get('newPassword');
      const confirmPassword = fd.get('confirmPassword');
      if (newPassword !== confirmPassword) { setError('As senhas n\u00e3o coincidem.'); return; }
      if (newPassword.length < 4) { setError('A nova senha deve ter ao menos 4 caracteres.'); return; }
      try {
        await request('/api/password', { method: 'POST', body: JSON.stringify({ login, currentPassword, newPassword }) });
        appState.loginMode = 'login';
        appState.error = '';
        appState.info = '\u2713 Senha alterada com sucesso. Fa\u00e7a login com a nova senha.';
        render();
      } catch (err) { setError(err.message); }
    });
  }

  document.getElementById('back-to-login')?.addEventListener('click', () => {
    appState.loginMode = 'login';
    appState.error = '';
    render();
  });
}

/* ============ DASHBOARD HELPERS ============ */
function isToday(iso) {
  const d = new Date(iso), n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

function sameMonthOrWeek(iso, type) {
  const target = new Date(iso);
  const now = new Date();
  if (type === 'month') return target.getMonth() === now.getMonth() && target.getFullYear() === now.getFullYear();
  const monday = new Date(now);
  const day = monday.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  const next = new Date(monday); next.setDate(next.getDate() + 7);
  return target >= monday && target < next;
}

function minutesDiff(entry) {
  if (typeof entry.minutes === 'number') return entry.minutes;
  if (!entry.endAt) return 0;
  return Math.max(0, Math.round((new Date(entry.endAt) - new Date(entry.startAt)) / 60000));
}

function buildChartData(entries, mode) {
  if (mode === 'week') {
    const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];
    const buckets = Array(7).fill(0);
    const now = new Date();
    const monday = new Date(now);
    const d = monday.getDay();
    monday.setDate(monday.getDate() + (d === 0 ? -6 : 1 - d));
    monday.setHours(0, 0, 0, 0);
    entries.forEach(e => {
      const ms = new Date(e.startAt) - monday;
      if (ms >= 0 && ms < 7 * 86400000) buckets[Math.floor(ms / 86400000)] += minutesDiff(e) / 60;
    });
    return { labels, data: buckets };
  }
  const now = new Date();
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const labels = Array.from({ length: days }, (_, i) => String(i + 1));
  const buckets = Array(days).fill(0);
  entries.forEach(e => {
    const dt = new Date(e.startAt);
    if (dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear())
      buckets[dt.getDate() - 1] += minutesDiff(e) / 60;
  });
  return { labels, data: buckets };
}

function initHoursChart() {
  const canvas = document.getElementById('hours-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  const user = appState.session?.user;
  const allEntries = (appState.reports?.entries || []).concat(appState.dashboard?.recentEntries || []);
  const entries = allEntries.filter(e => !e.userName || e.userName === user?.name);
  const { labels, data } = buildChartData(entries, appState.chartMode);
  if (window._hoursChart) { window._hoursChart.destroy(); window._hoursChart = null; }
  window._hoursChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Horas', data: data.map(v => parseFloat(v.toFixed(2))),
        backgroundColor: 'rgba(255,194,0,0.22)', borderColor: '#ffc200',
        borderWidth: 1, borderRadius: 6, hoverBackgroundColor: 'rgba(255,194,0,0.45)',
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#1e2533', titleColor: '#fff', bodyColor: 'rgba(255,255,255,0.7)',
          callbacks: { label: ctx => ` ${ctx.parsed.y.toFixed(1)}h` } }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true,
          ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 11 }, callback: v => v + 'h' } }
      }
    }
  });
}

/* ============ DASHBOARD VIEW ============ */
function dashboardView() {
  const { user, companies } = appState.session;
  const data = appState.dashboard;
  const activeEntry = data.activeEntry;
  const errorHtml = appState.error ? `<div class="db-error">${appState.error}</div>` : '';

  const dailyGoalMin  = appState.goals.daily;
  const weeklyGoalMin = appState.goals.weekly;
  const todayMin = data.recentEntries.filter(e => isToday(e.startAt)).reduce((s, e) => s + minutesDiff(e), 0);
  const weekMin  = data.userWeekMinutes;
  const excWeek  = Math.max(0, weekMin  - weeklyGoalMin);
  const excDay   = Math.max(0, todayMin - dailyGoalMin);
  const remWeek  = Math.max(0, weeklyGoalMin - weekMin);
  const weekPct  = Math.min(100, weeklyGoalMin > 0 ? Math.round(weekMin  / weeklyGoalMin * 100) : 0);
  const dayPct   = Math.min(100, dailyGoalMin  > 0 ? Math.round(todayMin / dailyGoalMin  * 100) : 0);

  const COLORS = ['c0', 'c1', 'c2'];
  const colorMap = {};
  companies.forEach((c, i) => { colorMap[c.id] = COLORS[i % 3]; colorMap[c.name] = COLORS[i % 3]; });

  const sidebarItems = companies.map((c, i) => {
    const isAct = activeEntry && activeEntry.companyId === c.id;
    return `
      <button class="db-nav-item${isAct ? ' active' : ''}" data-company-nav="${c.id}">
        <span class="db-nav-dot ${COLORS[i % 3]}"></span>
        <span>${c.name}</span>
        ${isAct ? '<span class="db-nav-live">●</span>' : ''}
      </button>`;
  }).join('');

  const timerCards = data.companyStats.map((co, i) => {
    const isAct = activeEntry && activeEntry.companyId === co.id;
    const blocked = activeEntry && !isAct;
    return `
      <div class="db-timer-row${isAct ? ' is-active' : ''}" id="company-${co.id}">
        <div class="db-timer-meta">
          <span class="db-tdot ${COLORS[i % 3]}"></span>
          <div>
            <strong>${co.name}</strong>
            <span class="db-timer-sub">${fmtDuration(co.weekMinutes)} esta semana · ${fmtDuration(co.monthMinutes)} este mes</span>
          </div>
        </div>
        <div class="db-clock${isAct ? ' ticking live-tick' : ''}">${isAct ? fmtLive(activeEntry.startAt) : '--h --m --s'}</div>
        <button class="db-timer-btn${isAct ? ' stop' : ' start'}"
          data-action="${isAct ? 'stop' : 'start'}" data-company-id="${co.id}" ${blocked ? 'disabled' : ''}>
          ${isAct ? '&#9209; Parar' : '&#9654; Iniciar'}
        </button>
      </div>`;
  }).join('');

  const entryRows = data.recentEntries.slice(0, 15).map(entry => `
    <tr>
      <td><span class="db-tag ${colorMap[entry.companyName] || 'c0'}">${entry.companyName}</span></td>
      <td>${fmtDateTime(entry.startAt)}</td>
      <td>${entry.endAt ? fmtDateTime(entry.endAt) : '<span class="db-live-badge">Ao vivo</span>'}</td>
      <td class="db-dur">${entry.endAt ? fmtDuration(minutesDiff(entry)) : `<span class="live-tick">${fmtLive(entry.startAt)}</span>`}</td>
      <td>${entry.endAt ? `<button class="db-del-btn" data-delete-entry="${entry.id}">&#10005;</button>` : ''}</td>
    </tr>`).join('');

  return `
    <div class="db-layout">
      <aside class="db-sidebar">
        <div class="db-brand">
          <img src="/logo/logo.png" alt="logo" class="db-brand-img" />
        </div>
        <div class="db-sb-user">
          <div class="db-avatar">${user.name.charAt(0).toUpperCase()}</div>
          <div>
            <div class="db-sb-name">${user.name}</div>
            <div class="db-sb-role">${user.role === 'admin' ? 'Admin' : 'Colaborador'}</div>
          </div>
        </div>
        <div class="db-nav-group">
          <div class="db-nav-label">Empresas</div>
          ${sidebarItems}
        </div>
        <button class="db-logout" id="logout-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Log Out
        </button>
      </aside>

      <div class="db-main">
        <header class="db-topbar">
          <div>
            <h1 class="db-topbar-title">Bem-vindo, ${user.name}</h1>
            <p class="db-topbar-sub">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</p>
          </div>
          ${activeEntry ? `<div class="db-active-badge">&#9679; ${activeEntry.companyName} &mdash; <span class="live-tick">${fmtLive(activeEntry.startAt)}</span></div>` : ''}
        </header>

        <div class="db-body">
          ${errorHtml}

          <div class="db-metrics-row">
            <div class="db-mcard">
              <div class="db-mcard-label">Hoje</div>
              <div class="db-mcard-value">${fmtDuration(todayMin)}</div>
              <div class="db-mcard-sub">Meta: ${fmtDuration(dailyGoalMin)}</div>
            </div>
            <div class="db-mcard">
              <div class="db-mcard-label">Esta semana</div>
              <div class="db-mcard-value">${fmtDuration(weekMin)}</div>
              <div class="db-mcard-sub">Meta: ${fmtDuration(weeklyGoalMin)}</div>
            </div>
            <div class="db-mcard">
              <div class="db-mcard-label">Este mes</div>
              <div class="db-mcard-value">${fmtDuration(data.userMonthMinutes)}</div>
              <div class="db-mcard-sub">Equipe: ${fmtDuration(data.totals.teamMonthMinutes)}</div>
            </div>
            <div class="db-mcard${excWeek > 0 ? ' db-mcard-accent' : ''}">
              <div class="db-mcard-label">Horas excedidas</div>
              <div class="db-mcard-value${excWeek > 0 ? ' over' : ''}">${excWeek > 0 ? '+' + fmtDuration(excWeek) : fmtDuration(remWeek) + ' rest.'}</div>
              <div class="db-mcard-sub">${excWeek > 0 ? 'acima da meta semanal' : 'para atingir a meta'}</div>
            </div>
          </div>

          <div class="db-mid-row">
            <div class="db-card db-chart-card">
              <div class="db-card-head">
                <h3>Horas trabalhadas</h3>
                <div class="db-tabs">
                  <button class="db-tab${appState.chartMode === 'week' ? ' on' : ''}" id="tab-week">Semanal</button>
                  <button class="db-tab${appState.chartMode === 'month' ? ' on' : ''}" id="tab-month">Mensal</button>
                </div>
              </div>
              <div class="db-chart-area"><canvas id="hours-chart"></canvas></div>
            </div>

            <div class="db-card db-goals-card">
              <div class="db-card-head"><h3>Metas de horas</h3></div>
              <div class="db-goals-body">
                <label class="db-glabel">Meta diaria (h)</label>
                <div class="db-ginput-row">
                  <input class="db-ginput" id="goal-daily" type="number" min="1" max="24" value="${(dailyGoalMin / 60).toFixed(0)}" />
                  <span>h / dia</span>
                </div>
                <label class="db-glabel">Meta semanal (h)</label>
                <div class="db-ginput-row">
                  <input class="db-ginput" id="goal-weekly" type="number" min="1" max="168" value="${(weeklyGoalMin / 60).toFixed(0)}" />
                  <span>h / semana</span>
                </div>
                <button class="db-gsave" id="save-goals-btn">Salvar metas</button>
                <div class="db-prog-section">
                  <div class="db-prog-info"><span>Semana</span><span>${weekPct}%</span></div>
                  <div class="db-progbar"><div class="db-progfill${excWeek > 0 ? ' over' : ''}" style="width:${weekPct}%"></div></div>
                  <div class="db-prog-info" style="margin-top:12px"><span>Hoje</span><span>${dayPct}%</span></div>
                  <div class="db-progbar"><div class="db-progfill${excDay > 0 ? ' over' : ''}" style="width:${dayPct}%"></div></div>
                </div>
              </div>
            </div>
          </div>

          <div class="db-card">
            <div class="db-card-head">
              <h3>Cronometro por empresa</h3>
              <span class="db-badge ${activeEntry ? 'on' : 'off'}">${activeEntry ? '&#9679; Em andamento' : '&#9679; Parado'}</span>
            </div>
            <div class="db-timers">${timerCards}</div>
          </div>

          <div class="db-card">
            <div class="db-card-head">
              <h3>Registros de horas</h3>
              <button class="db-export" id="export-btn">&#8595; Exportar CSV</button>
            </div>
            ${entryRows ? `
              <div class="db-tscroll">
                <table class="db-table">
                  <thead><tr><th>Empresa</th><th>Inicio</th><th>Fim</th><th>Duracao</th><th></th></tr></thead>
                  <tbody>${entryRows}</tbody>
                </table>
              </div>` : '<p class="db-empty">Nenhum registro. Inicie um cronometro para comecar.</p>'}
          </div>

          ${user.role === 'admin' ? `
          <div class="db-card">
            <div class="db-card-head">
              <h3>Administração</h3>
              <span class="db-badge off">Admin only</span>
            </div>
            <div class="db-admin-body">
              <p class="db-admin-desc">Reseta o banco de dados para o estado inicial com os novos usuários seed. <strong>Todos os registros de horas serão apagados.</strong></p>
              <button class="db-timer-btn stop" id="reset-store-btn">Resetar banco de dados</button>
            </div>
          </div>` : ''}
        </div>
      </div>
    </div>`;
}

/* ============ BIND DASHBOARD ============ */
function bindDashboardView() {
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
      await request('/api/logout', { method: 'POST' });
      appState.session = { authenticated: false }; appState.dashboard = null;
      appState.reports = null; appState.error = ''; render();
    } catch (e) { setError(e.message); }
  });

  document.querySelectorAll('[data-action="start"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await request('/api/timer/start', { method: 'POST', body: JSON.stringify({ companyId: Number(btn.dataset.companyId) }) });
        await refreshAuthenticatedView(); render();
      } catch (e) { setError(e.message); }
    });
  });

  document.querySelectorAll('[data-action="stop"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await request('/api/timer/stop', { method: 'POST' });
        await refreshAuthenticatedView(); render();
      } catch (e) { setError(e.message); }
    });
  });

  document.querySelectorAll('[data-delete-entry]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await request(`/api/entries/${btn.dataset.deleteEntry}`, { method: 'DELETE' });
        await refreshAuthenticatedView(); render();
      } catch (e) { setError(e.message); }
    });
  });

  document.querySelectorAll('[data-company-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const el = document.getElementById(`company-${btn.dataset.companyNav}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  document.getElementById('save-goals-btn')?.addEventListener('click', () => {
    const daily  = Math.max(1, Math.min(24,  Number(document.getElementById('goal-daily').value)))  * 60;
    const weekly = Math.max(1, Math.min(168, Number(document.getElementById('goal-weekly').value))) * 60;
    appState.goals = { daily, weekly };
    localStorage.setItem('mktime_goals', JSON.stringify(appState.goals));
    render();
  });

  document.getElementById('tab-week')?.addEventListener('click', () => {
    appState.chartMode = 'week'; initHoursChart();
    document.getElementById('tab-week')?.classList.add('on');
    document.getElementById('tab-month')?.classList.remove('on');
  });
  document.getElementById('tab-month')?.addEventListener('click', () => {
    appState.chartMode = 'month'; initHoursChart();
    document.getElementById('tab-month')?.classList.add('on');
    document.getElementById('tab-week')?.classList.remove('on');
  });

  document.getElementById('export-btn')?.addEventListener('click', () => {
    window.open('/api/reports/export', '_blank');
  });

  document.getElementById('reset-store-btn')?.addEventListener('click', async () => {
    if (!confirm('Tem certeza? Isso apagara TODOS os registros de horas e redefinira os usuarios.')) return;
    try {
      await request('/api/reset', { method: 'POST' });
      await request('/api/logout', { method: 'POST' });
      appState.session = { authenticated: false }; appState.dashboard = null;
      appState.reports = null; appState.error = '';
      appState.info = '\u2713 Banco de dados resetado. Faca login com os novos usuarios.';
      render();
    } catch (e) { setError(e.message); }
  });

  startLiveTicker();
  setTimeout(initHoursChart, 60);
}

let liveInterval;

function startLiveTicker() {
  if (liveInterval) { window.clearInterval(liveInterval); liveInterval = null; }
  if (!appState.dashboard?.activeEntry) return;
  liveInterval = window.setInterval(() => {
    const t = fmtLive(appState.dashboard.activeEntry.startAt);
    document.querySelectorAll('.live-tick').forEach(el => { el.textContent = t; });
  }, 1000);
}

boot();
