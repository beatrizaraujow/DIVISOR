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
  taskFilter: 'today',
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
  const infoHtml  = appState.info  ? `<div class="lp-info">${appState.info}</div>`   : '';

  if (appState.loginMode === 'change-password') {
    return `
    <main class="login-page">
      <div class="lp-left">
        <img src="/logo/logo.png" alt="logo" class="lp-logo" />
      </div>
      <div class="lp-right">
        <div class="lp-card">
          <h2 class="lp-title">Alterar Senha</h2>
          ${errorHtml}
          <form id="change-password-form">
            <div class="lp-field">
              <label class="lp-label" for="cp-login">NOME</label>
              <input class="lp-input" id="cp-login" name="login" autocomplete="username" placeholder="seu nome" required />
            </div>
            <div class="lp-field">
              <label class="lp-label" for="cp-current">SENHA ATUAL</label>
              <input class="lp-input" id="cp-current" name="currentPassword" type="password" autocomplete="current-password" placeholder="••••••••" required />
            </div>
            <div class="lp-field">
              <label class="lp-label" for="cp-new">NOVA SENHA</label>
              <input class="lp-input" id="cp-new" name="newPassword" type="password" autocomplete="new-password" placeholder="••••••••" required />
            </div>
            <div class="lp-field">
              <label class="lp-label" for="cp-confirm">CONFIRMAR NOVA SENHA</label>
              <input class="lp-input" id="cp-confirm" name="confirmPassword" type="password" autocomplete="new-password" placeholder="••••••••" required />
            </div>
            <button class="lp-btn" type="submit">ALTERAR SENHA</button>
          </form>
          <span class="lp-link" id="back-to-login">← Voltar ao login</span>
        </div>
      </div>
    </main>`;
  }

  return `
    <main class="login-page">
      <div class="lp-left">
        <img src="/logo/logo.png" alt="logo" class="lp-logo" />
      </div>
      <div class="lp-right">
        <div class="lp-card">
          <h2 class="lp-title">Entrar</h2>
          ${errorHtml}
          ${infoHtml}
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
          <span class="lp-link" id="show-change-password">Alterar senha</span>
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
  const errorHtml = appState.error ? `<div class="nd-error">${appState.error}</div>` : '';

  const COLORS = ['c0', 'c1', 'c2'];
  const colorMap = {};
  companies.forEach((c, i) => { colorMap[c.id] = COLORS[i % 3]; colorMap[c.name] = COLORS[i % 3]; });

  const dailyGoalMin  = appState.goals.daily;
  const weeklyGoalMin = appState.goals.weekly;
  const todayMin = data.recentEntries.filter(e => isToday(e.startAt)).reduce((s, e) => s + minutesDiff(e), 0);
  const weekMin  = data.userWeekMinutes;
  const excWeek  = Math.max(0, weekMin - weeklyGoalMin);
  const remWeek  = Math.max(0, weeklyGoalMin - weekMin);
  const weekPct  = Math.min(100, weeklyGoalMin > 0 ? Math.round(weekMin / weeklyGoalMin * 100) : 0);

  const activeCompanyName = activeEntry ? (companies.find(c => c.id === activeEntry.companyId)?.name || '') : '';

  const sidebarCompanies = companies.map((c, i) => {
    const isAct = activeEntry && activeEntry.companyId === c.id;
    return `
      <button class="nd-nav-item${isAct ? ' active' : ''}" data-action="start" data-company-id="${c.id}">
        <span class="nd-nav-item-left">
          <span class="nd-nav-dot ${COLORS[i % 3]}"></span>
          <span>${c.name}</span>
        </span>
        <span class="nd-nav-chevron">${isAct ? '●' : '›'}</span>
      </button>`;
  }).join('');

  const timerHtml = activeEntry ? `
    <div class="nd-timer-kicker">CRONÔMETRO · TAREFA ATUAL</div>
    <div class="nd-timer-display live-tick">${fmtLive(activeEntry.startAt)}</div>
    <div class="nd-timer-info">${activeCompanyName}</div>
    <div class="nd-timer-actions">
      <button class="nd-timer-btn stop" data-action="stop">&#9209; Parar</button>
    </div>` : `
    <div class="nd-timer-kicker">CRONÔMETRO · TAREFA ATUAL</div>
    <div class="nd-timer-display idle">--:--:--</div>
    <div class="nd-timer-info">Selecione uma empresa ao lado para iniciar</div>`;

  const filter = appState.taskFilter;
  const filteredEntries = data.recentEntries.filter(e => {
    if (filter === 'today') return isToday(e.startAt);
    if (filter === 'week')  return sameMonthOrWeek(e.startAt, 'week');
    return true;
  });

  const taskRows = filteredEntries.slice(0, 20).map(entry => {
    const colorCls = colorMap[entry.companyId] || colorMap[entry.companyName] || 'c0';
    const isActive = !entry.endAt;
    const isBlocked = activeEntry && !isActive;
    const dateLabel = new Date(entry.startAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const statusBadge = isActive
      ? `<span class="nd-badge nd-badge-active">Em andamento</span>`
      : `<span class="nd-badge nd-badge-done">Conclu\u00edda</span>`;
    const tempoDisplay = isActive
      ? `<span class="live-tick nd-time-cell">${fmtLive(entry.startAt)}</span>`
      : `<span class="nd-time-cell">${fmtDuration(minutesDiff(entry))}</span>`;
    const actionBtns = isActive
      ? `<button class="nd-action-btn stop" data-action="stop" title="Parar">&#9209;</button>`
      : `<button class="nd-action-btn play" data-action="start" data-company-id="${entry.companyId}"${isBlocked ? ' disabled style="opacity:.3;cursor:not-allowed"' : ''} title="Iniciar">&#9654;</button>
         <button class="nd-action-btn del" data-delete-entry="${entry.id}" title="Excluir">&#10005;</button>`;
    return `
      <tr>
        <td>
          <div class="nd-task-name">${entry.companyName}</div>
          <div class="nd-task-sub">${dateLabel} &middot; ${fmtDateTime(entry.startAt)}</div>
        </td>
        <td><div class="nd-company-cell"><span class="nd-company-dot ${colorCls}"></span><span>${entry.companyName}</span></div></td>
        <td>${statusBadge}</td>
        <td>${tempoDisplay}</td>
        <td><span style="color:rgba(255,255,255,0.2)">&mdash;</span></td>
        <td><div class="nd-action-btns">${actionBtns}</div></td>
      </tr>`;
  }).join('');

  return `
    <div class="nd-layout">
      <aside class="nd-sidebar">
        <div class="nd-user">
          <div class="nd-avatar">${user.name.charAt(0).toUpperCase()}</div>
          <div>
            <div class="nd-user-name">Bem-vindo, ${user.name}</div>
            <div class="nd-user-sub">${activeCompanyName || new Date().toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}</div>
          </div>
        </div>
        <div class="nd-search-wrap">
          <div class="nd-search">
            <span class="nd-search-icon">&#128269;</span>
            <input type="text" placeholder="Buscar empresa..." readonly />
          </div>
        </div>
        <div class="nd-nav-section">
          <div class="nd-nav-label">Empresas</div>
          ${sidebarCompanies}
        </div>
        <div class="nd-nav-section">
          <div class="nd-nav-label">Geral</div>
          <button class="nd-nav-item" id="export-btn">
            <span class="nd-nav-item-left"><span class="nd-nav-icon">&#128202;</span><span>Exportar CSV</span></span>
          </button>
          ${user.role === 'admin' ? `
          <button class="nd-nav-item" id="reset-store-btn">
            <span class="nd-nav-item-left"><span class="nd-nav-icon">&#9881;&#65039;</span><span>Resetar banco</span></span>
          </button>` : ''}
        </div>
        <div class="nd-spacer"></div>
        <button class="nd-logout" id="logout-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span>Sair</span>
        </button>
      </aside>

      <div class="nd-content">
        <header class="nd-topbar">
          <button class="nd-topbar-icon" title="Notifica\u00e7\u00f5es">&#128276;</button>
        </header>

        <div class="nd-body">
          ${errorHtml}

          <div class="nd-metrics">
            <div class="nd-mcard">
              <div class="nd-mcard-head"><div class="nd-mcard-icon yellow">&#128336;</div><span class="nd-mcard-menu">&bull;&bull;&bull;</span></div>
              <div class="nd-mcard-value">${fmtDuration(todayMin)}</div>
              <div class="nd-mcard-label">Horas hoje</div>
              <div class="nd-mcard-sub"><span class="up">&#9650;</span> Meta: ${fmtDuration(dailyGoalMin)}</div>
            </div>
            <div class="nd-mcard">
              <div class="nd-mcard-head"><div class="nd-mcard-icon cyan">&#128197;</div><span class="nd-mcard-menu">&bull;&bull;&bull;</span></div>
              <div class="nd-mcard-value">${fmtDuration(weekMin)}</div>
              <div class="nd-mcard-label">Horas semana</div>
              <div class="nd-mcard-sub"><span class="warn">${weekPct}%</span>&nbsp;da meta</div>
            </div>
            <div class="nd-mcard">
              <div class="nd-mcard-head"><div class="nd-mcard-icon green">&#9889;</div><span class="nd-mcard-menu">&bull;&bull;&bull;</span></div>
              <div class="nd-mcard-value">${fmtDuration(dailyGoalMin)} / ${fmtDuration(weeklyGoalMin)}</div>
              <div class="nd-mcard-label">Meta di\u00e1ria / semanal</div>
              <div class="nd-mcard-sub"><span class="${weekPct >= 80 ? 'up' : 'over'}">${weekPct >= 80 ? 'No ritmo certo' : 'Abaixo da meta'}</span></div>
            </div>
            <div class="nd-mcard">
              <div class="nd-mcard-head"><div class="nd-mcard-icon ${excWeek > 0 ? 'red' : 'yellow'}">&#9888;&#65039;</div><span class="nd-mcard-menu">&bull;&bull;&bull;</span></div>
              <div class="nd-mcard-value${excWeek > 0 ? ' amber' : ''}">${excWeek > 0 ? '+' + fmtDuration(excWeek) : fmtDuration(remWeek)}</div>
              <div class="nd-mcard-label">Horas excedidas (semana)</div>
              <div class="nd-mcard-sub"><span class="${excWeek > 0 ? 'over' : ''}">${excWeek > 0 ? 'Acima da meta' : 'Restam para a meta'}</span></div>
            </div>
          </div>

          <div class="nd-mid">
            <div class="nd-card">
              <div class="nd-card-head">
                <h3>Horas registradas</h3>
                <div class="nd-tabs">
                  <button class="nd-tab${appState.chartMode === 'week' ? ' on' : ''}" id="tab-week">Semanal</button>
                  <button class="nd-tab${appState.chartMode === 'month' ? ' on' : ''}" id="tab-month">Mensal</button>
                </div>
              </div>
              <div class="nd-chart-area"><canvas id="hours-chart"></canvas></div>
            </div>

            <div class="nd-right-panel">
              <div class="nd-card">
                <div class="nd-card-head">
                  <h3>Cron\u00f4metro</h3>
                  ${activeEntry ? `<span style="width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;animation:nd-pulse 1.4s infinite"></span>` : ''}
                </div>
                <div class="nd-timer-body">${timerHtml}</div>
              </div>

              <div class="nd-card">
                <div class="nd-card-head"><h3>Metas de horas</h3></div>
                <div class="nd-goals-body">
                  <div class="nd-goal-row">
                    <span class="nd-goal-label">Meta di\u00e1ria</span>
                    <div class="nd-goal-ctrl">
                      <button class="nd-goal-btn" id="nd-daily-dec">&minus;</button>
                      <span class="nd-goal-val" id="nd-daily-val">${(dailyGoalMin / 60).toFixed(0)}</span>
                      <span class="nd-goal-unit">h/dia</span>
                      <button class="nd-goal-btn" id="nd-daily-inc">+</button>
                    </div>
                  </div>
                  <div class="nd-goal-row">
                    <span class="nd-goal-label">Meta semanal</span>
                    <div class="nd-goal-ctrl">
                      <button class="nd-goal-btn" id="nd-weekly-dec">&minus;</button>
                      <span class="nd-goal-val" id="nd-weekly-val">${(weeklyGoalMin / 60).toFixed(0)}</span>
                      <span class="nd-goal-unit">h/semana</span>
                      <button class="nd-goal-btn" id="nd-weekly-inc">+</button>
                    </div>
                  </div>
                  <div class="nd-goal-bar">
                    <div class="nd-goal-bar-info">
                      <span>${fmtDuration(weekMin)} de ${fmtDuration(weeklyGoalMin)}</span>
                      <span>${weekPct}%</span>
                    </div>
                    <div class="nd-goal-bar-track">
                      <div class="nd-goal-bar-fill${excWeek > 0 ? ' over' : ''}" style="width:${weekPct}%"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="nd-card">
            <div class="nd-tasks-head">
              <h3>Registros de horas</h3>
              <div class="nd-task-tabs">
                <button class="nd-task-tab${filter === 'today' ? ' on' : ''}" data-task-tab="today">Hoje</button>
                <button class="nd-task-tab${filter === 'week'  ? ' on' : ''}" data-task-tab="week">Semana</button>
                <button class="nd-task-tab${filter === 'all'   ? ' on' : ''}" data-task-tab="all">Tudo</button>
              </div>
              <button class="nd-export-btn" id="export-btn">&#8595; Exportar CSV</button>
            </div>
            ${taskRows
              ? `<div class="nd-tasks-scroll"><table class="nd-tasks-table">
                  <thead><tr><th>Empresa / Sess\u00e3o</th><th>Empresa</th><th>Status</th><th>Tempo</th><th>Meta</th><th>A\u00e7\u00f5es</th></tr></thead>
                  <tbody>${taskRows}</tbody>
                </table></div>`
              : `<div class="nd-empty">Nenhum registro encontrado para este per\u00edodo.</div>`}
          </div>

          ${user.role === 'admin' ? `
          <div class="nd-card" style="border-color:rgba(239,68,68,.15)">
            <div class="nd-card-head">
              <h3>Administra\u00e7\u00e3o</h3>
              <span class="nd-badge nd-badge-pending">Admin only</span>
            </div>
            <div class="nd-admin-body">
              <p class="nd-admin-desc">Reseta o banco de dados para o estado inicial. <strong>Todos os registros de horas ser\u00e3o apagados.</strong></p>
              <button class="nd-timer-btn stop" id="reset-store-btn" style="width:auto;padding:9px 20px">Resetar banco de dados</button>
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
      const companyId = Number(btn.dataset.companyId);
      if (!companyId) return;
      try {
        await request('/api/timer/start', { method: 'POST', body: JSON.stringify({ companyId }) });
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

  // Goals ± buttons
  function updateGoal(key, delta, valId, min, max) {
    const current = Math.round(appState.goals[key] / 60);
    const next = Math.max(min, Math.min(max, current + delta));
    appState.goals[key] = next * 60;
    localStorage.setItem('mktime_goals', JSON.stringify(appState.goals));
    const el = document.getElementById(valId);
    if (el) el.textContent = next;
  }
  document.getElementById('nd-daily-dec')?.addEventListener('click',  () => updateGoal('daily',  -1, 'nd-daily-val',  1, 24));
  document.getElementById('nd-daily-inc')?.addEventListener('click',  () => updateGoal('daily',  +1, 'nd-daily-val',  1, 24));
  document.getElementById('nd-weekly-dec')?.addEventListener('click', () => updateGoal('weekly', -1, 'nd-weekly-val', 1, 168));
  document.getElementById('nd-weekly-inc')?.addEventListener('click', () => updateGoal('weekly', +1, 'nd-weekly-val', 1, 168));

  // Chart tabs
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

  // Task filter tabs
  document.querySelectorAll('[data-task-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      appState.taskFilter = btn.dataset.taskTab;
      render();
    });
  });

  document.getElementById('export-btn')?.addEventListener('click', () => {
    window.open('/api/reports/export', '_blank');
  });

  document.getElementById('reset-store-btn')?.addEventListener('click', async () => {
    if (!confirm('Tem certeza? Isso apagar\u00e1 TODOS os registros de horas e redefinir\u00e1 os usu\u00e1rios.')) return;
    try {
      await request('/api/reset', { method: 'POST' });
      await request('/api/logout', { method: 'POST' });
      appState.session = { authenticated: false }; appState.dashboard = null;
      appState.reports = null; appState.error = '';
      appState.info = '\u2713 Banco de dados resetado. Fa\u00e7a login com os novos usu\u00e1rios.';
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
