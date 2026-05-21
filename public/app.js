const appState = {
  session: null,
  dashboard: null,
  reports: null,
  loading: false,
  error: '',
  reportFilters: defaultFilters(),
};

const COMPANY_CLASS = {
  Carbone: 'c0',
  Seubone: 'c1',
  Onevo: 'c2',
};

function defaultFilters() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    from: toDateInput(monthStart),
    to: toDateInput(now),
    userId: '',
    companyId: '',
  };
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
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtLive(startAt) {
  const diff = Date.now() - new Date(startAt).getTime();
  const safeSeconds = Math.max(0, Math.floor(diff / 1000));
  const hours = Math.floor(safeSeconds / 3600);
  const mins = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  return `${hours}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
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
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

async function loadSession() {
  appState.session = await request('/api/session');
}

async function loadDashboard() {
  appState.dashboard = await request('/api/dashboard');
}

async function loadReports() {
  const query = new URLSearchParams();
  const filters = appState.reportFilters;
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (filters.userId) query.set('userId', filters.userId);
  if (filters.companyId) query.set('companyId', filters.companyId);
  appState.reports = await request(`/api/reports?${query.toString()}`);
}

async function refreshAuthenticatedView() {
  await Promise.all([loadSession(), loadDashboard(), loadReports()]);
}

function setError(message) {
  appState.error = message;
  render();
}

async function boot() {
  try {
    await loadSession();
    if (appState.session.authenticated) {
      await Promise.all([loadDashboard(), loadReports()]);
    }
    render();
  } catch (error) {
    setError(error.message);
  }
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

function loginView() {
  const errorHtml = appState.error ? `<div class="lp-error">${appState.error}</div>` : '';

  return `
    <main class="login-page">
      <div class="lp-left">
        <img src="/logo.png" alt="logo" class="lp-logo" />
      </div>
      <div class="lp-right">
        <div class="lp-watermark">45</div>
        <div class="lp-card">
          <h2 class="lp-title">login</h2>
          ${errorHtml}
          <form id="login-form">
            <div class="lp-field">
              <label class="lp-label" for="login">name:</label>
              <input class="lp-input" id="login" name="login" autocomplete="username" placeholder="usuario" required />
            </div>
            <div class="lp-field">
              <label class="lp-label" for="password">senha:</label>
              <input class="lp-input" id="password" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required />
            </div>
            <button class="lp-btn" type="submit">entrar</button>
          </form>
        </div>
      </div>
    </main>
  `;
}

function dashboardView() {
  const { user, companies, users } = appState.session;
  const data = appState.dashboard;
  const reports = appState.reports;
  const activeEntry = data.activeEntry;
  const errorHtml = appState.error ? `<div class="error">${appState.error}</div>` : '';

  const companyCards = data.companyStats.map(company => {
    const className = COMPANY_CLASS[company.name] || 'c0';
    const isActive = activeEntry && activeEntry.companyId === company.id;
    const blocked = activeEntry && activeEntry.companyId !== company.id;
    const userEntries = data.recentEntries.filter(entry => entry.companyId === company.id);
    const userMinutesWeek = userEntries
      .filter(entry => sameMonthOrWeek(entry.startAt, 'week'))
      .reduce((sum, entry) => sum + minutesDiff(entry), 0);
    const userMinutesMonth = userEntries
      .filter(entry => sameMonthOrWeek(entry.startAt, 'month'))
      .reduce((sum, entry) => sum + minutesDiff(entry), 0);

    return `
      <article class="company-card">
        <header>
          <div>
            <div class="small-pill"><span class="company-tone ${className}"></span>${company.name}</div>
            <h3>${company.name}</h3>
            <p class="muted">Controle individual e consolidado por empresa.</p>
          </div>
          <div class="company-tone ${className}"></div>
        </header>

        <div class="mini-metrics">
          <div class="mini-card">
            <div class="mini-label">Sua semana</div>
            <strong>${fmtDuration(userMinutesWeek)}</strong>
          </div>
          <div class="mini-card">
            <div class="mini-label">Seu mes</div>
            <strong>${fmtDuration(userMinutesMonth)}</strong>
          </div>
          <div class="mini-card">
            <div class="mini-label">Equipe semana</div>
            <strong>${fmtDuration(company.weekMinutes)}</strong>
          </div>
          <div class="mini-card">
            <div class="mini-label">Equipe mes</div>
            <strong>${fmtDuration(company.monthMinutes)}</strong>
          </div>
        </div>

        <div class="company-state">
          <div>
            <strong>${isActive ? 'Relogio em andamento' : 'Relogio parado'}</strong>
            <span>${isActive ? `Contando desde ${fmtDateTime(activeEntry.startAt)}.` : 'Inicie para registrar horas nesta empresa.'}</span>
          </div>
          <div class="status ${isActive ? 'live' : 'idle'}">${isActive ? 'Ao vivo' : 'Disponivel'}</div>
        </div>

        <div class="button-row">
          <button class="${isActive ? 'btn-danger' : 'btn-secondary'}" data-action="${isActive ? 'stop' : 'start'}" data-company-id="${company.id}" ${blocked ? 'disabled' : ''}>
            ${isActive ? 'Encerrar relogio' : 'Iniciar relogio'}
          </button>
          <button class="btn-ghost" disabled>${blocked ? 'Existe outro relogio aberto' : 'Uma empresa por vez'}</button>
        </div>
      </article>
    `;
  }).join('');

  const rankingRows = data.ranking.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${item.name}</td>
      <td>${fmtDuration(item.weekMinutes)}</td>
      <td>${fmtDuration(item.monthMinutes)}</td>
      <td>${item.activeEntry ? '<span class="status live">Ativo</span>' : '<span class="status idle">Livre</span>'}</td>
    </tr>
  `).join('');

  const recentRows = data.recentEntries.map(entry => `
    <tr>
      <td>${entry.companyName}</td>
      <td>${fmtDateTime(entry.startAt)}</td>
      <td>${entry.endAt ? fmtDateTime(entry.endAt) : '<span class="status live">Em andamento</span>'}</td>
      <td>${entry.endAt ? fmtDuration(minutesDiff(entry)) : fmtLive(entry.startAt)}</td>
      <td>${entry.endAt ? `<button class="btn-ghost" data-delete-entry="${entry.id}">Excluir</button>` : '<span class="status live">Ativo</span>'}</td>
    </tr>
  `).join('');

  const reportRows = reports.entries.map(entry => `
    <tr>
      <td>${entry.userName}</td>
      <td>${entry.companyName}</td>
      <td>${fmtDateTime(entry.startAt)}</td>
      <td>${entry.endAt ? fmtDateTime(entry.endAt) : '-'}</td>
      <td>${fmtDuration(minutesDiff(entry))}</td>
    </tr>
  `).join('');

  return `
    <main class="app-shell">
      <section class="hero">
        <div>
          <div class="small-pill">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</div>
          <h1>Painel de horas compartilhado</h1>
          <p>${user.name}, esta tela consolida login real, relogio por empresa, visao semanal e mensal, filtros por periodo e exportacao de relatorios.</p>
        </div>
        <div class="hero-actions">
          <div class="pill"><strong>${user.name}</strong><br /><span class="muted">${user.login} · ${user.role}</span></div>
          <div class="pill">${activeEntry ? `Em ${activeEntry.companyName}: <span id="live-active">${fmtLive(activeEntry.startAt)}</span>` : 'Nenhum relogio ativo'}</div>
          <button class="btn-ghost" id="logout-btn">Sair</button>
        </div>
      </section>

      <section class="notice">
        Banco compartilhado ativo neste projeto. Se voce publicar esse servidor em uma rede ou hospedagem, a equipe passa a usar o mesmo conjunto de dados.
      </section>

      ${errorHtml}

      <section class="metric-grid">
        <article class="metric-card">
          <div class="label">Sua semana</div>
          <div class="value">${fmtDuration(data.userWeekMinutes)}</div>
          <div class="muted">Somente seus registros.</div>
        </article>
        <article class="metric-card">
          <div class="label">Seu mes</div>
          <div class="value">${fmtDuration(data.userMonthMinutes)}</div>
          <div class="muted">Consolidado do mes atual.</div>
        </article>
        <article class="metric-card">
          <div class="label">Equipe semana</div>
          <div class="value">${fmtDuration(data.totals.teamWeekMinutes)}</div>
          <div class="muted">Todos os colaboradores.</div>
        </article>
        <article class="metric-card">
          <div class="label">Equipe mes</div>
          <div class="value">${fmtDuration(data.totals.teamMonthMinutes)}</div>
          <div class="muted">Todas as empresas somadas.</div>
        </article>
      </section>

      <section>
        <div class="section-head">
          <div>
            <h2>Relogio por empresa</h2>
            <p class="muted">Inicie ou encerre seu apontamento sem misturar empresas.</p>
          </div>
          <div class="small-pill">3 empresas monitoradas</div>
        </div>
        <div class="company-grid">${companyCards}</div>
      </section>

      <section class="content-grid">
        <article class="table-card">
          <h2>Seus registros recentes</h2>
          <p>O relogio ativo entra no total geral e aparece ao vivo nesta lista.</p>
          ${recentRows ? `
            <table>
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Inicio</th>
                  <th>Fim</th>
                  <th>Duracao</th>
                  <th>Acao</th>
                </tr>
              </thead>
              <tbody>${recentRows}</tbody>
            </table>
          ` : '<div class="empty">Nenhum apontamento feito ainda.</div>'}
        </article>

        <article class="table-card">
          <h2>Ranking da equipe</h2>
          <p>Comparativo semanal e mensal entre os colaboradores cadastrados.</p>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Pessoa</th>
                <th>Semana</th>
                <th>Mes</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${rankingRows}</tbody>
          </table>
        </article>
      </section>

      <section class="filters" style="margin-top: 18px;">
        <div class="section-head">
          <div>
            <h2>Relatorios filtraveis</h2>
            <p>Filtre por periodo, colaborador e empresa, depois exporte para CSV.</p>
          </div>
          <button class="btn" id="export-btn">Exportar CSV</button>
        </div>

        <div class="filters-row">
          <div class="field">
            <label for="filter-from">De</label>
            <input id="filter-from" type="date" value="${appState.reportFilters.from}" />
          </div>
          <div class="field">
            <label for="filter-to">Ate</label>
            <input id="filter-to" type="date" value="${appState.reportFilters.to}" />
          </div>
          <div class="field">
            <label for="filter-user">Colaborador</label>
            <select id="filter-user">
              <option value="">Todos</option>
              ${users.map(option => `<option value="${option.id}" ${String(option.id) === String(appState.reportFilters.userId) ? 'selected' : ''}>${option.name}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="filter-company">Empresa</label>
            <select id="filter-company">
              <option value="">Todas</option>
              ${companies.map(option => `<option value="${option.id}" ${String(option.id) === String(appState.reportFilters.companyId) ? 'selected' : ''}>${option.name}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="button-row">
          <button class="btn-secondary" id="apply-filters-btn">Aplicar filtros</button>
          <button class="btn-ghost" id="reset-filters-btn">Limpar filtros</button>
        </div>

        <div class="report-summary">
          <div class="summary-box">
            <div class="mini-label">Total filtrado</div>
            <strong>${fmtDuration(reports.summary.totalMinutes)}</strong>
          </div>
          <div class="summary-box">
            <div class="mini-label">Registros</div>
            <strong>${reports.summary.entriesCount}</strong>
          </div>
          <div class="summary-box">
            <div class="mini-label">Top colaborador</div>
            <strong>${reports.summary.byUser[0] ? `${reports.summary.byUser[0].label} · ${fmtDuration(reports.summary.byUser[0].minutes)}` : '-'}</strong>
          </div>
          <div class="summary-box">
            <div class="mini-label">Top empresa</div>
            <strong>${reports.summary.byCompany[0] ? `${reports.summary.byCompany[0].label} · ${fmtDuration(reports.summary.byCompany[0].minutes)}` : '-'}</strong>
          </div>
        </div>

        ${reportRows ? `
          <table>
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Empresa</th>
                <th>Inicio</th>
                <th>Fim</th>
                <th>Duracao</th>
              </tr>
            </thead>
            <tbody>${reportRows}</tbody>
          </table>
        ` : '<div class="empty">Nenhum registro encontrado com os filtros atuais.</div>'}
      </section>
    </main>
  `;
}

function sameMonthOrWeek(iso, type) {
  const target = new Date(iso);
  const now = new Date();
  if (type === 'month') {
    return target.getMonth() === now.getMonth() && target.getFullYear() === now.getFullYear();
  }

  const monday = new Date(now);
  const day = monday.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  const nextMonday = new Date(monday);
  nextMonday.setDate(nextMonday.getDate() + 7);
  return target >= monday && target < nextMonday;
}

function minutesDiff(entry) {
  if (typeof entry.minutes === 'number') return entry.minutes;
  if (!entry.endAt) return 0;
  return Math.max(0, Math.round((new Date(entry.endAt) - new Date(entry.startAt)) / 60000));
}

function bindLoginView() {
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    appState.error = '';
    const formData = new FormData(form);
    try {
      await request('/api/login', {
        method: 'POST',
        body: JSON.stringify({
          login: formData.get('login'),
          password: formData.get('password'),
        }),
      });
      appState.reportFilters = defaultFilters();
      await refreshAuthenticatedView();
      render();
    } catch (error) {
      setError(error.message);
    }
  });
}

function bindDashboardView() {
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await request('/api/logout', { method: 'POST' });
        appState.session = { authenticated: false };
        appState.dashboard = null;
        appState.reports = null;
        appState.error = '';
        render();
      } catch (error) {
        setError(error.message);
      }
    });
  }

  document.querySelectorAll('[data-action="start"]').forEach(button => {
    button.addEventListener('click', async () => {
      try {
        await request('/api/timer/start', {
          method: 'POST',
          body: JSON.stringify({ companyId: Number(button.dataset.companyId) }),
        });
        await refreshAuthenticatedView();
        render();
      } catch (error) {
        setError(error.message);
      }
    });
  });

  document.querySelectorAll('[data-action="stop"]').forEach(button => {
    button.addEventListener('click', async () => {
      try {
        await request('/api/timer/stop', { method: 'POST' });
        await refreshAuthenticatedView();
        render();
      } catch (error) {
        setError(error.message);
      }
    });
  });

  document.querySelectorAll('[data-delete-entry]').forEach(button => {
    button.addEventListener('click', async () => {
      try {
        await request(`/api/entries/${button.dataset.deleteEntry}`, { method: 'DELETE' });
        await refreshAuthenticatedView();
        render();
      } catch (error) {
        setError(error.message);
      }
    });
  });

  const applyBtn = document.getElementById('apply-filters-btn');
  if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
      appState.reportFilters = collectFilters();
      try {
        await loadReports();
        render();
      } catch (error) {
        setError(error.message);
      }
    });
  }

  const resetBtn = document.getElementById('reset-filters-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      appState.reportFilters = defaultFilters();
      try {
        await loadReports();
        render();
      } catch (error) {
        setError(error.message);
      }
    });
  }

  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const filters = collectFilters();
      const query = new URLSearchParams();
      if (filters.from) query.set('from', filters.from);
      if (filters.to) query.set('to', filters.to);
      if (filters.userId) query.set('userId', filters.userId);
      if (filters.companyId) query.set('companyId', filters.companyId);
      window.open(`/api/reports/export?${query.toString()}`, '_blank');
    });
  }

  startLiveTicker();
}

let liveInterval;

function startLiveTicker() {
  if (liveInterval) {
    window.clearInterval(liveInterval);
    liveInterval = null;
  }
  const liveEl = document.getElementById('live-active');
  if (!liveEl || !appState.dashboard || !appState.dashboard.activeEntry) return;

  liveInterval = window.setInterval(() => {
    const nextLiveEl = document.getElementById('live-active');
    if (!nextLiveEl) return;
    nextLiveEl.textContent = fmtLive(appState.dashboard.activeEntry.startAt);
  }, 1000);
}

function collectFilters() {
  return {
    from: document.getElementById('filter-from')?.value || '',
    to: document.getElementById('filter-to')?.value || '',
    userId: document.getElementById('filter-user')?.value || '',
    companyId: document.getElementById('filter-company')?.value || '',
  };
}

boot();