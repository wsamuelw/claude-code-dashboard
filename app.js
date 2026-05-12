// ── Helpers ──────────────────────────────────────────────────────────
const fmt = n => {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
};

const pctChange = (cur, prev) => {
  if (prev === 0) return cur > 0 ? '+∞' : '0';
  const p = ((cur - prev) / prev * 100).toFixed(0);
  return p > 0 ? `+${p}%` : `${p}%`;
};

const trendClass = (cur, prev) => {
  if (prev === 0) return '';
  return cur > prev ? 'trend-up' : cur < prev ? 'trend-down' : 'trend-flat';
};

// ── Color system ─────────────────────────────────────────────────────
const colors = {
  primary:    '#6366f1',  // indigo
  accent:     '#06b6d4',  // cyan
  success:    '#10b981',  // emerald
  warning:    '#f59e0b',  // amber
  muted:      '#64748b',
  bg:         '#0f172a',
  cardBg:     '#1e293b',
  border:     '#334155',
  text:       '#e2e8f0',
  textMuted:  '#94a3b8',
};

const palette = [
  '#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#3b82f6',
  '#a855f7', '#22d3ee', '#84cc16', '#e11d48', '#0ea5e9',
];

// ── State ────────────────────────────────────────────────────────────
let chartInstances = {};
let currentData = null;
let selectedRange = 'all';

// ── Range logic ──────────────────────────────────────────────────────
function filterByRange(data, range) {
  if (range === 'all') return data;
  const days = { '7d': 7, '14d': 14, '30d': 30, '90d': 90 }[range];
  if (!days) return data;

  const cutoff = new Date(data.dailyActivity[data.dailyActivity.length - 1].date);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const dailyActivity = data.dailyActivity.filter(d => d.date >= cutoffStr);
  const dailyModelTokens = data.dailyModelTokens.filter(d => d.date >= cutoffStr);

  // Aggregate model usage from dailyModelTokens (accurate per-model totals)
  const modelUsage = {};
  dailyModelTokens.forEach(d => {
    Object.entries(d.tokensByModel).forEach(([model, tokens]) => {
      if (!modelUsage[model]) {
        modelUsage[model] = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 };
      }
      modelUsage[model].inputTokens += tokens;
    });
  });

  return { ...data, dailyActivity, dailyModelTokens, modelUsage };
}

// ── Previous period for trend ────────────────────────────────────────
function getPreviousPeriod(data, range) {
  if (range === 'all') return null;
  const days = { '7d': 7, '14d': 14, '30d': 30, '90d': 90 }[range];
  const len = data.dailyActivity.length;
  if (len < days * 2) return null;

  const endIdx = len - days;
  const startIdx = endIdx - days;
  if (startIdx < 0) return null;

  const dailyActivity = data.dailyActivity.slice(startIdx, endIdx);
  const dailyModelTokens = data.dailyModelTokens.slice(startIdx, endIdx);

  const modelUsage = {};
  dailyModelTokens.forEach(d => {
    Object.entries(d.tokensByModel).forEach(([model, tokens]) => {
      if (!modelUsage[model]) modelUsage[model] = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 };
      modelUsage[model].inputTokens += tokens;
    });
  });

  return { dailyActivity, dailyModelTokens, modelUsage };
}

// ── Sparkline (tiny canvas) ──────────────────────────────────────────
function drawSparkline(canvasId, values, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || values.length < 2) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.offsetWidth * 2;
  const h = canvas.height = canvas.offsetHeight * 2;
  ctx.scale(2, 2);
  const dw = canvas.offsetWidth;
  const dh = canvas.offsetHeight;

  const max = Math.max(...values) || 1;
  const step = dw / (values.length - 1);

  ctx.clearRect(0, 0, dw, dh);
  ctx.beginPath();
  ctx.moveTo(0, dh - (values[0] / max) * dh);
  values.forEach((v, i) => ctx.lineTo(i * step, dh - (v / max) * dh));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Gradient fill
  ctx.lineTo(dw, dh);
  ctx.lineTo(0, dh);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, dh);
  grad.addColorStop(0, color + '30');
  grad.addColorStop(1, color + '00');
  ctx.fillStyle = grad;
  ctx.fill();
}

// ── Main render ──────────────────────────────────────────────────────
function render(data) {
  currentData = data;
  const el = document.getElementById.bind(document);
  const filtered = filterByRange(data, selectedRange);
  const prev = getPreviousPeriod(data, selectedRange);

  // Destroy old charts
  Object.values(chartInstances).forEach(c => c.destroy());
  chartInstances = {};

  // ── Summary stats ────────────────────────────────────────────────
  const totalTokens = Object.values(filtered.modelUsage).reduce(
    (s, m) => s + (m.inputTokens || 0) + (m.outputTokens || 0), 0
  );
  const totalSessions = filtered.dailyActivity.reduce((s, d) => s + d.sessionCount, 0);
  const totalMessages = filtered.dailyActivity.reduce((s, d) => s + d.messageCount, 0);
  const activeDays = filtered.dailyActivity.length;
  const avgPerDay = activeDays ? Math.round(totalTokens / activeDays) : 0;

  // Previous period totals for trends
  let prevTokens = 0, prevSessions = 0, prevMessages = 0, prevAvg = 0;
  if (prev) {
    prevTokens = Object.values(prev.modelUsage).reduce((s, m) => s + (m.inputTokens || 0) + (m.outputTokens || 0), 0);
    prevSessions = prev.dailyActivity.reduce((s, d) => s + d.sessionCount, 0);
    prevMessages = prev.dailyActivity.reduce((s, d) => s + d.messageCount, 0);
    prevAvg = prev.dailyActivity.length ? Math.round(prevTokens / prev.dailyActivity.length) : 0;
  }

  const firstDate = filtered.dailyActivity[0]?.date || '?';
  const lastDate = filtered.dailyActivity[filtered.dailyActivity.length - 1]?.date || '?';
  el('date-range').textContent = `${firstDate} to ${lastDate}`;

  el('stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-header">
        <div class="stat-value">${fmt(totalTokens)}</div>
        <div class="stat-trend ${trendClass(totalTokens, prevTokens)}">${prev ? pctChange(totalTokens, prevTokens) : ''}</div>
      </div>
      <div class="stat-label">Total Tokens</div>
      <canvas class="sparkline" id="spark-tokens"></canvas>
    </div>
    <div class="stat-card">
      <div class="stat-header">
        <div class="stat-value">${fmt(totalSessions)}</div>
        <div class="stat-trend ${trendClass(totalSessions, prevSessions)}">${prev ? pctChange(totalSessions, prevSessions) : ''}</div>
      </div>
      <div class="stat-label">Sessions</div>
      <canvas class="sparkline" id="spark-sessions"></canvas>
    </div>
    <div class="stat-card">
      <div class="stat-header">
        <div class="stat-value">${fmt(totalMessages)}</div>
        <div class="stat-trend ${trendClass(totalMessages, prevMessages)}">${prev ? pctChange(totalMessages, prevMessages) : ''}</div>
      </div>
      <div class="stat-label">Messages</div>
      <canvas class="sparkline" id="spark-messages"></canvas>
    </div>
    <div class="stat-card">
      <div class="stat-header">
        <div class="stat-value">${fmt(avgPerDay)}</div>
        <div class="stat-trend ${trendClass(avgPerDay, prevAvg)}">${prev ? pctChange(avgPerDay, prevAvg) : ''}</div>
      </div>
      <div class="stat-label">Avg Tokens / Day</div>
      <canvas class="sparkline" id="spark-avg"></canvas>
    </div>
  `;

  // Draw sparklines
  const dailyTotals = filtered.dailyModelTokens.map(d =>
    Object.values(d.tokensByModel).reduce((s, v) => s + v, 0)
  );
  const dailySessionCounts = filtered.dailyActivity.map(d => d.sessionCount);
  const dailyMessageCounts = filtered.dailyActivity.map(d => d.messageCount);
  const dailyAvgs = dailyTotals.map((t, i) =>
    filtered.dailyActivity[i]?.sessionCount ? Math.round(t / filtered.dailyActivity[i].sessionCount) : 0
  );

  requestAnimationFrame(() => {
    drawSparkline('spark-tokens', dailyTotals, colors.primary);
    drawSparkline('spark-sessions', dailySessionCounts, colors.accent);
    drawSparkline('spark-messages', dailyMessageCounts, colors.success);
    drawSparkline('spark-avg', dailyAvgs, colors.warning);
  });

  // ── Daily trend chart ────────────────────────────────────────────
  const labels = filtered.dailyActivity.map(d => {
    const dt = new Date(d.date + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  chartInstances.daily = new Chart(el('dailyChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: dailyTotals,
        borderColor: colors.primary,
        backgroundColor: colors.primary + '18',
        fill: true,
        tension: 0.35,
        pointRadius: selectedRange === 'all' ? 0 : 3,
        pointHoverRadius: 6,
        pointBackgroundColor: colors.primary,
        pointBorderColor: colors.cardBg,
        pointBorderWidth: 2,
        borderWidth: 2.5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: colors.border,
          borderWidth: 1,
          titleColor: colors.text,
          bodyColor: colors.textMuted,
          padding: 12,
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            label: ctx => `${fmt(ctx.raw)} tokens`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: colors.muted, maxTicksLimit: 10, font: { size: 11 } },
        },
        y: {
          grid: { color: colors.border + '80' },
          ticks: { color: colors.muted, callback: v => fmt(v), font: { size: 11 } },
        },
      },
    },
  });

  // ── Model bar chart ──────────────────────────────────────────────
  const shorten = name => ({
    'qwen/qwen3.6-plus-04-02:free': 'qwen3.6-plus',
    'huihui_ai/qwen3.5-abliterated:0.8b': 'abliterated-0.8b',
    'qwen3-coder:480b-cloud': 'qwen3-coder',
    'qwen3.5:397b-cloud': 'qwen3.5-397b-cld',
    'gpt-oss:120b': 'gpt-oss-120b',
    'qwen3.5:9b-q4_K_M': 'qwen3.5-9b-q4',
  }[name] || name);

  const models = Object.entries(filtered.modelUsage)
    .map(([name, m]) => ({ name, total: (m.inputTokens || 0) + (m.outputTokens || 0) }))
    .filter(m => m.total > 0)
    .sort((a, b) => b.total - a.total);

  const threshold = totalTokens * 0.01;
  const main = models.filter(m => m.total >= threshold);
  const otherTotal = models.filter(m => m.total < threshold).reduce((s, m) => s + m.total, 0);
  const chartModels = otherTotal > 0 ? [...main, { name: 'Other', total: otherTotal }] : main;

  chartInstances.model = new Chart(el('modelChart'), {
    type: 'bar',
    data: {
      labels: chartModels.map(m => shorten(m.name)),
      datasets: [{
        data: chartModels.map(m => m.total),
        backgroundColor: colors.primary + 'cc',
        hoverBackgroundColor: colors.primary,
        borderRadius: 4,
        barThickness: 18,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: colors.border,
          borderWidth: 1,
          titleColor: colors.text,
          bodyColor: colors.textMuted,
          padding: 12,
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            label: ctx => `${fmt(ctx.raw)} tokens (${((ctx.raw / totalTokens) * 100).toFixed(1)}%)`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: colors.border + '80' },
          ticks: { color: colors.muted, callback: v => fmt(v), font: { size: 11 } },
        },
        y: {
          grid: { display: false },
          ticks: { color: colors.textMuted, font: { size: 11 } },
        },
      },
    },
  });

  // ── Token type chart ─────────────────────────────────────────────
  const typeTotals = Object.values(filtered.modelUsage).reduce(
    (acc, m) => {
      acc.input += m.inputTokens || 0;
      acc.output += m.outputTokens || 0;
      acc.cache += m.cacheReadInputTokens || 0;
      return acc;
    },
    { input: 0, output: 0, cache: 0 }
  );

  chartInstances.type = new Chart(el('typeChart'), {
    type: 'bar',
    data: {
      labels: ['Input', 'Output', 'Cache Read'],
      datasets: [{
        data: [typeTotals.input, typeTotals.output, typeTotals.cache],
        backgroundColor: [colors.primary, colors.accent, colors.success],
        hoverBackgroundColor: [colors.primary, colors.accent, colors.success],
        borderRadius: 6,
        barThickness: 36,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: colors.border,
          borderWidth: 1,
          titleColor: colors.text,
          bodyColor: colors.textMuted,
          padding: 12,
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            label: ctx => `${fmt(ctx.raw)} tokens`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: colors.border + '80' },
          ticks: { color: colors.muted, callback: v => fmt(v), font: { size: 11 } },
        },
        y: {
          grid: { display: false },
          ticks: { color: colors.textMuted, font: { size: 13 } },
        },
      },
    },
  });

  // ── Usage by hour of day ──────────────────────────────────────────
  const hourLabels = Array.from({ length: 24 }, (_, i) => {
    if (i === 0) return '12am';
    if (i === 12) return '12pm';
    return i < 12 ? `${i}am` : `${i - 12}pm`;
  });
  const hourData = hourLabels.map((_, i) => data.hourCounts[String(i)] || 0);
  const maxHour = Math.max(...hourData) || 1;

  chartInstances.hour = new Chart(el('hourChart'), {
    type: 'bar',
    data: {
      labels: hourLabels,
      datasets: [{
        data: hourData,
        backgroundColor: hourData.map(v => v === maxHour ? colors.warning : colors.accent + '99'),
        hoverBackgroundColor: colors.accent,
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: colors.border,
          borderWidth: 1,
          titleColor: colors.text,
          bodyColor: colors.textMuted,
          padding: 12,
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            title: items => items[0].label,
            label: ctx => `${ctx.raw} messages`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: colors.muted, maxTicksLimit: 12, font: { size: 10 } },
        },
        y: {
          grid: { color: colors.border + '80' },
          ticks: { color: colors.muted, font: { size: 11 } },
        },
      },
    },
  });

  // ── Tool calls trend ──────────────────────────────────────────────
  const toolCallData = filtered.dailyActivity.map(d => d.toolCallCount);

  chartInstances.tools = new Chart(el('toolsChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: toolCallData,
        borderColor: colors.success,
        backgroundColor: colors.success + '18',
        fill: true,
        tension: 0.35,
        pointRadius: selectedRange === 'all' ? 0 : 3,
        pointHoverRadius: 5,
        pointBackgroundColor: colors.success,
        pointBorderColor: colors.cardBg,
        pointBorderWidth: 2,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: colors.border,
          borderWidth: 1,
          titleColor: colors.text,
          bodyColor: colors.textMuted,
          padding: 12,
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            label: ctx => `${ctx.raw} tool calls`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: colors.muted, maxTicksLimit: 10, font: { size: 11 } },
        },
        y: {
          grid: { color: colors.border + '80' },
          ticks: { color: colors.muted, font: { size: 11 } },
        },
      },
    },
  });

  // ── Sessions per day ──────────────────────────────────────────────
  chartInstances.sessions = new Chart(el('sessionsChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: filtered.dailyActivity.map(d => d.sessionCount),
        backgroundColor: colors.accent + '99',
        hoverBackgroundColor: colors.accent,
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: colors.border,
          borderWidth: 1,
          titleColor: colors.text,
          bodyColor: colors.textMuted,
          padding: 12,
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            label: ctx => `${ctx.raw} sessions`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: colors.muted, maxTicksLimit: 10, font: { size: 11 } },
        },
        y: {
          grid: { color: colors.border + '80' },
          ticks: { color: colors.muted, font: { size: 11 } },
        },
      },
    },
  });

  // ── Busiest days ──────────────────────────────────────────────────
  const dayTotals = filtered.dailyActivity.map((d, i) => ({
    date: d.date,
    tokens: dailyTotals[i],
    sessions: d.sessionCount,
    messages: d.messageCount,
    tools: d.toolCallCount,
  }));
  dayTotals.sort((a, b) => b.tokens - a.tokens);
  const top5 = dayTotals.slice(0, 5);

  el('busiest-list').innerHTML = top5.map((d, i) => {
    const dt = new Date(d.date + 'T00:00:00');
    const dayName = dt.toLocaleDateString('en-US', { weekday: 'short' });
    const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `
      <div class="busiest-row">
        <div class="busiest-rank">${i + 1}</div>
        <div class="busiest-date">
          <div class="busiest-day">${dayName}, ${dateStr}</div>
          <div class="busiest-meta">${d.sessions} sessions, ${d.messages} messages, ${d.tools} tools</div>
        </div>
        <div class="busiest-tokens">${fmt(d.tokens)}</div>
      </div>
    `;
  }).join('');
}

// ── Drop zone ────────────────────────────────────────────────────────
function showDropZone() {
  const el = document.getElementById.bind(document);
  el('drop-zone').style.display = 'flex';
  el('charts').style.display = 'none';

  const zone = el('drop-zone');
  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        el('drop-zone').style.display = 'none';
        el('charts').style.display = 'block';
        render(data);
      } catch {
        el('drop-error').textContent = 'Invalid JSON file. Please drop a stats-cache.json file.';
      }
    };
    reader.readAsText(file);
  });
}

// ── Range buttons ────────────────────────────────────────────────────
function setupRangeButtons() {
  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedRange = btn.dataset.range;
      if (currentData) render(currentData);
    });
  });
}

// ── Init ─────────────────────────────────────────────────────────────
async function init() {
  const el = document.getElementById.bind(document);
  setupRangeButtons();
  try {
    const res = await fetch('stats-cache.json');
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    el('drop-zone').style.display = 'none';
    el('charts').style.display = 'block';
    render(data);
  } catch {
    showDropZone();
  }
}

init();
