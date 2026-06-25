async function api(path, method = 'GET') {
  const res = await fetch(path, { method });
  return res.json();
}

function ts(ms) {
  if (!ms) return 'n/a';
  return new Date(ms).toLocaleString();
}

function setTextIf(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

async function refresh() {
  try {
    const s = await api('/api/status');
    setTextIf('state', s.state);
    setTextIf('last', s.lastActionAt ? ts(s.lastActionAt) : 'never');
    setTextIf('interval', s.intervalMs);
    setTextIf('cooldown', s.actionCooldownMs);
    if (s.currentScenario && typeof s.currentScenario === 'object') {
      setTextIf('current-scenario', `${s.currentScenario.label || s.currentScenario.id} (${s.currentScenario.actionId})`);
    } else {
      setTextIf('current-scenario', 'none');
    }

    if (s.latestWeather) {
      setTextIf('weather-clouds', typeof s.latestWeather.clouds === 'number' ? s.latestWeather.clouds : 'n/a');
      setTextIf('weather-uvi', typeof s.latestWeather.uvi === 'number' ? s.latestWeather.uvi : 'n/a');
      setTextIf('weather-range', s.latestWeather.rangeStartIso && s.latestWeather.rangeEndIso ? (s.latestWeather.rangeStartIso + ' → ' + s.latestWeather.rangeEndIso) : 'n/a');
      setTextIf('weather-fetched', s.latestWeather.fetchedAt ? ts(s.latestWeather.fetchedAt) : 'n/a');
      updateWeatherIcon(typeof s.latestWeather.clouds === 'number' ? s.latestWeather.clouds : null);
    } else {
      setTextIf('weather-clouds', 'n/a');
      setTextIf('weather-uvi', 'n/a');
      setTextIf('weather-range', 'n/a');
      setTextIf('weather-fetched', 'n/a');
      updateWeatherIcon(null);
    }

    if (s.latestPower) {
      setTextIf('power-dum', s.latestPower['Dům'] ?? 'n/a');
      setTextIf('power-fve', s.latestPower['FVE'] ?? 'n/a');
      setTextIf('power-baterie', s.latestPower['Baterie'] ?? 'n/a');
      setTextIf('power-sit', s.latestPower['Síť'] ?? 'n/a');
      // plug status provided separately as latestPlug
      setTextIf('power-plug', s.latestPlug ?? 'n/a');
    } else {
      setTextIf('power-dum', 'n/a');
      setTextIf('power-fve', 'n/a');
      setTextIf('power-baterie', 'n/a');
      setTextIf('power-sit', 'n/a');
      setTextIf('power-plug', 'n/a');
    }

    // Passive polling info (server provides passiveNextFetchAt when controller not running)
    if (!s.controllerRunning && s.passiveNextFetchAt) {
      setTextIf('next-refresh', ts(s.passiveNextFetchAt));
      window.__passiveNextFetchAt = s.passiveNextFetchAt;
    } else {
      setTextIf('next-refresh', 'n/a');
      window.__passiveNextFetchAt = null;
      setTextIf('countdown', '—');
    }
  } catch (err) {
    console.error(err);
  }
}

// countdown updater (1s) reading passiveNextFetchAt set by refresh()
function updateCountdown() {
  const next = window.__passiveNextFetchAt || null;
  if (!next) {
    setTextIf('countdown', '—');
    return;
  }
  const remMs = next - Date.now();
  if (remMs <= 0) {
    setTextIf('countdown', '00:00');
    return;
  }
  const sec = Math.floor(remMs / 1000);
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  setTextIf('countdown', `${mm}:${ss}`);
}

// run countdown updater every second
setInterval(updateCountdown, 1000);

async function refreshBrowserViewToggle() {
  try {
    const r = await api('/api/browser-view');
    const btn = document.getElementById('toggle-browser-view');
    if (!btn) return;
    if (r && r.ok) {
      btn.textContent = 'Browser view: ' + (r.visible ? 'on' : 'off');
      btn.dataset.visible = r.visible ? '1' : '0';
    }
  } catch (err) {
    console.error('browser-view fetch', err);
  }
}

console.log('app.js loaded');

function showChartError(msg) {
  console.error(msg);
  const el = document.getElementById('chart-error');
  if (el) {
    el.style.display = 'block';
    el.textContent = String(msg);
  }
}

// Chart handling
let weatherChart = null;
function updateWeatherUIFromSummary(s) {
  if (!s) return;
  setTextIf('weather-clouds', typeof s.clouds === 'number' ? s.clouds : 'n/a');
  setTextIf('weather-uvi', typeof s.uvi === 'number' ? s.uvi : 'n/a');
  setTextIf('weather-range', s.rangeStartIso && s.rangeEndIso ? (s.rangeStartIso + ' → ' + s.rangeEndIso) : 'n/a');
  setTextIf('weather-fetched', s.fetchedAt ? ts(s.fetchedAt) : 'n/a');
  updateWeatherIcon(typeof s.clouds === 'number' ? s.clouds : null);
}
function updateWeatherIcon(clouds) {
  const el = document.getElementById('weather-icon');
  if (!el) return;
  if (typeof clouds !== 'number') {
    el.textContent = '—';
    el.className = 'weather-icon';
    return;
  }
  if (clouds < 20) {
    el.textContent = '☀️';
    el.className = 'weather-icon icon-sunny';
  } else if (clouds < 60) {
    el.textContent = '⛅';
    el.className = 'weather-icon icon-partly';
  } else {
    el.textContent = '☁️';
    el.className = 'weather-icon icon-cloudy';
  }
}

function updateChartFromHourly(hourly) {
  if (!hourly || !hourly.length) return;
  // prepare category-based data (labels as localized strings)
  const labels = hourly.map(h => new Date(h.dt * 1000).toLocaleString());
  const clouds = hourly.map(h => (typeof h.clouds === 'number' ? h.clouds : null));
  const uvis = hourly.map(h => (typeof h.uvi === 'number' ? h.uvi : null));
  const isDayFlags = hourly.map(h => !!h.isDay);

  const ctx = document.getElementById('weatherChart').getContext('2d');
  console.log('updateChartFromHourly', { hourlyLength: hourly.length });
  
  if (!ctx) {
    showChartError('Canvas context not available');
    return;
  }
  if (window.Chart === undefined) {
    showChartError('Chart.js not loaded');
    return;
  }

  // compute night ranges as index ranges using isDay flags
  const nightIndexRanges = [];
  let curStartIdx = null;
  for (let i = 0; i < isDayFlags.length; i++) {
    if (!isDayFlags[i]) {
      if (curStartIdx === null) curStartIdx = i;
    } else {
      if (curStartIdx !== null) {
        nightIndexRanges.push({ startIndex: curStartIdx, endIndex: i - 1 });
        curStartIdx = null;
      }
    }
  }
  if (curStartIdx !== null) nightIndexRanges.push({ startIndex: curStartIdx, endIndex: isDayFlags.length - 1 });

  const pluginNight = {
    id: 'nightShade',
    beforeDraw(chart, args, options) {
      const { ctx, chartArea: ca, scales } = chart;
      const xScale = scales.x;
      ctx.save();
      for (const r of nightIndexRanges) {
        const left = xScale.getPixelForValue(r.startIndex);
        // compute right edge as pixel of endIndex + 1 to cover the full bar width
        const right = xScale.getPixelForValue(r.endIndex);
        const next = xScale.getPixelForValue(r.endIndex + 1);
        const width = (next && !isNaN(next) ? next : right) - left;
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(left, ca.top, width, ca.bottom - ca.top);
      }
      ctx.restore();
    }
  };

  const pluginCurrentLine = {
    id: 'currentLine',
    afterDraw(chart, args, options) {
      const { ctx, chartArea: ca, scales } = chart;
      const xScale = scales.x;
      const idx = chart.currentIndex;
      if (typeof idx !== 'number' || idx < 0) return;
      const x = xScale.getPixelForValue(idx);
      if (!x || isNaN(x)) return;
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = options && options.color ? options.color : 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, ca.top);
      ctx.lineTo(x, ca.bottom);
      ctx.stroke();
      ctx.restore();
    }
  };

  if (weatherChart) {
    weatherChart.data.labels = labels;
    weatherChart.data.datasets[0].data = clouds;
    weatherChart.data.datasets[1].data = uvis;
    setChartNowIndex(hourly);
    weatherChart.update();
    return;
  }

  try {
    weatherChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Clouds (%)',
            data: clouds,
            borderColor: 'rgba(54,162,235,1)',
            backgroundColor: 'rgba(54,162,235,0.2)',
            yAxisID: 'y',
            tension: 0.2,
          },
          {
            label: 'UV Index',
            data: uvis,
            borderColor: 'rgba(255,99,132,1)',
            backgroundColor: 'rgba(255,99,132,0.2)',
            yAxisID: 'y1',
            tension: 0.2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'category',
          },
          y: {
            type: 'linear',
            position: 'left',
            suggestedMin: 0,
            suggestedMax: 100,
            title: { display: true, text: 'Clouds (%)' }
          },
          y1: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            suggestedMin: 0,
            suggestedMax: 11,
            title: { display: true, text: 'UV Index' }
          }
        },
        plugins: {
          legend: { position: 'top' }
        }
      },
      plugins: [pluginNight, pluginCurrentLine]
    });
      setChartNowIndex(hourly);
  } catch (err) {
    showChartError('Failed to create Chart: ' + String(err));
    console.error(err);
  }
}

// Render chart from precomputed series arrays
function updateChartFromSeries(timestamps, labels, clouds, uvis, isDayFlags) {
  if (!labels || !labels.length) return;
  const ctx = document.getElementById('weatherChart').getContext('2d');
  if (!ctx) { showChartError('Canvas context not available'); return; }
  if (window.Chart === undefined) { showChartError('Chart.js not loaded'); return; }

  // compute night ranges as index ranges using isDay flags
  const nightIndexRanges = [];
  let curStartIdx = null;
  for (let i = 0; i < isDayFlags.length; i++) {
    if (!isDayFlags[i]) {
      if (curStartIdx === null) curStartIdx = i;
    } else {
      if (curStartIdx !== null) {
        nightIndexRanges.push({ startIndex: curStartIdx, endIndex: i - 1 });
        curStartIdx = null;
      }
    }
  }
  if (curStartIdx !== null) nightIndexRanges.push({ startIndex: curStartIdx, endIndex: isDayFlags.length - 1 });

  const pluginNight = {
    id: 'nightShade',
    beforeDraw(chart, args, options) {
      const { ctx, chartArea: ca, scales } = chart;
      const xScale = scales.x;
      ctx.save();
      for (const r of nightIndexRanges) {
        const left = xScale.getPixelForValue(r.startIndex);
        const right = xScale.getPixelForValue(r.endIndex);
        const next = xScale.getPixelForValue(r.endIndex + 1);
        const width = (next && !isNaN(next) ? next : right) - left;
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(left, ca.top, width, ca.bottom - ca.top);
      }
      ctx.restore();
    }
  };

  const pluginCurrentLine = {
    id: 'currentLine',
    afterDraw(chart, args, options) {
      const { ctx, chartArea: ca, scales } = chart;
      const xScale = scales.x;
      const idx = chart.currentIndex;
      if (typeof idx !== 'number' || idx < 0) return;
      const x = xScale.getPixelForValue(idx);
      if (!x || isNaN(x)) return;
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = options && options.color ? options.color : 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, ca.top);
      ctx.lineTo(x, ca.bottom);
      ctx.stroke();
      ctx.restore();
    }
  };

  if (weatherChart) {
    weatherChart.data.labels = labels;
    weatherChart.data.datasets[0].data = clouds;
    weatherChart.data.datasets[1].data = uvis;
    weatherChart.update();
    weatherChart.timestamps = timestamps;
    return;
  }

  try {
    weatherChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Clouds (%)',
            data: clouds,
            borderColor: 'rgba(54,162,235,1)',
            backgroundColor: 'rgba(54,162,235,0.2)',
            yAxisID: 'y',
            tension: 0.2,
          },
          {
            label: 'UV Index',
            data: uvis,
            borderColor: 'rgba(255,99,132,1)',
            backgroundColor: 'rgba(255,99,132,0.2)',
            yAxisID: 'y1',
            tension: 0.2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { type: 'category' },
          y: {
            type: 'linear', position: 'left', suggestedMin: 0, suggestedMax: 100, title: { display: true, text: 'Clouds (%)' }
          },
          y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, suggestedMin: 0, suggestedMax: 11, title: { display: true, text: 'UV Index' } }
        },
        plugins: { legend: { position: 'top' } }
      },
      plugins: [pluginNight, pluginCurrentLine]
    });
    weatherChart.timestamps = timestamps;
  } catch (err) {
    showChartError('Failed to create Chart: ' + String(err));
    console.error(err);
  }
}

  // compute and set current index for chart (nearest hour >= now)
  function setChartNowIndex(hourly) {
    if (!weatherChart || !hourly || !hourly.length) return;
    const nowMs = Date.now();
    let idx = hourly.findIndex(h => (h.dt * 1000) >= nowMs);
    if (idx === -1) idx = hourly.length - 1;
    weatherChart.currentIndex = idx;
  }

async function fetchAndRenderWeather() {
  try {
    const r = await api('/api/weather');
    if (r && r.ok && r.weather) {
      const payload = r.weather;
      const summary = payload.summary || payload;
      const hourly = payload.hourly || [];
      updateWeatherUIFromSummary(summary);
      // Fetch N hours of recent metrics (configurable) and combine
      try {
        const histHoursEl = document.getElementById('history-select');
        const histHours = histHoursEl ? Number(histHoursEl.value) : 12;
        const since = Date.now() - (histHours * 60 * 60 * 1000);
        const m = await api('/api/metrics?since=' + since);
        const rows = (m && m.ok && m.rows) ? m.rows : [];

        // Build past N hourly timestamps aligned to hour
        const now = Date.now();
        const startHour = Math.floor((now - histHours * 60 * 60 * 1000) / 3600000) * 3600000;
        const pastCount = histHours;
        const pastTimestamps = [];
        for (let i = 0; i < pastCount; i++) pastTimestamps.push(startHour + i * 3600000);

        const pastLabels = pastTimestamps.map(t => new Date(t).toLocaleString());
        const pastClouds = pastTimestamps.map(t => {
          // find closest row by ts
          let best = null;
          let bestDiff = Infinity;
          for (const row of rows) {
            if (!row || typeof row.ts !== 'number') continue;
            const d = Math.abs(row.ts - t);
            if (d < bestDiff) { bestDiff = d; best = row; }
          }
          if (best && best.weather && typeof best.weather.clouds === 'number') return best.weather.clouds; else return null;
        });
        const pastUvis = pastTimestamps.map(t => {
          let best = null; let bestDiff = Infinity;
          for (const row of rows) {
            if (!row || typeof row.ts !== 'number') continue;
            const d = Math.abs(row.ts - t);
            if (d < bestDiff) { bestDiff = d; best = row; }
          }
          if (best && best.weather && typeof best.weather.uvi === 'number') return best.weather.uvi; else return null;
        });

        // Future forecast series (hourly)
        const futureTimestamps = hourly.map(h => h.dt * 1000);
        const futureLabels = futureTimestamps.map(t => new Date(t).toLocaleString());
        const futureClouds = hourly.map(h => (typeof h.clouds === 'number' ? h.clouds : null));
        const futureUvis = hourly.map(h => (typeof h.uvi === 'number' ? h.uvi : null));
        const futureIsDay = hourly.map(h => !!h.isDay);

        // build combined arrays
        const timestamps = pastTimestamps.concat(futureTimestamps);
        const labels = pastLabels.concat(futureLabels);
        const clouds = pastClouds.concat(futureClouds);
        const uvis = pastUvis.concat(futureUvis);

        // isDay flags: estimate for past based on hour (6..18)
        const pastIsDay = pastTimestamps.map(t => {
          const hr = new Date(t).getHours();
          return hr >= 6 && hr < 18;
        });
        const isDayFlags = pastIsDay.concat(futureIsDay);

        updateChartFromSeries(timestamps, labels, clouds, uvis, isDayFlags);
        // set now index to first timestamp >= now
        const nowIdx = timestamps.findIndex(t => t >= Date.now());
        if (weatherChart) weatherChart.currentIndex = (nowIdx === -1 ? timestamps.length - 1 : nowIdx);
        // Draw sparklines for power values
        try {
          const keys = { dum: 'Dům', fve: 'FVE', baterie: 'Baterie' };
          for (const [cid, key] of Object.entries(keys)) {
            const series = pastTimestamps.map(t => {
              let best = null; let bestDiff = Infinity;
              for (const row of rows) {
                if (!row || typeof row.ts !== 'number') continue;
                const d = Math.abs(row.ts - t);
                if (d < bestDiff) { bestDiff = d; best = row; }
              }
              if (best && best.power && best.power[key]) {
                const m = (best.power[key] || '').toString().match(/[-+]?\d+[,.]?\d*/);
                return m ? Number(m[0].replace(',', '.')) : null;
              }
              return null;
            });
            drawSparkline('spark-' + cid, series);
            // update sample count display
            try {
              const cnt = series.filter(x => x !== null && typeof x === 'number').length;
              const el = document.getElementById('sparkcount-' + cid);
              if (el) el.textContent = `samples: ${cnt}`;
            } catch (e) {}
          }
        } catch (e) {
          console.error('sparkline draw failed', e);
        }
      } catch (err) {
        console.error('fetch metrics failed', err);
        updateChartFromHourly(hourly);
        // render empty sparklines as placeholder
        drawSparkline('spark-dum', []);
        drawSparkline('spark-fve', []);
        drawSparkline('spark-baterie', []);
        try {
          const els = ['dum','fve','baterie'];
          for (const id of els) {
            const el = document.getElementById('sparkcount-' + id);
            if (el) el.textContent = 'samples: 0';
          }
        } catch (e) {}
      }
    }
  } catch (err) {
    console.error('fetchAndRenderWeather error', err);
  }
}

function drawSparkline(canvasId, values) {
  try {
    const c = document.getElementById(canvasId);
    if (!c || !c.getContext) return;
    const ctx = c.getContext('2d');
    const w = c.width; const h = c.height;
    ctx.clearRect(0,0,w,h);
    const nums = values.map(v => (v === null || typeof v !== 'number' || isNaN(v)) ? null : v);
    const valid = nums.filter(x => x !== null);
    if (valid.length === 0) {
      // draw subtle empty indicator
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 1;
      ctx.setLineDash([4,2]);
      ctx.beginPath();
      ctx.moveTo(0, h/2);
      ctx.lineTo(w, h/2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#999';
      ctx.font = '10px sans-serif';
      ctx.fillText('n/a', 4, h - 4);
      return;
    }
    const min = Math.min(...valid); const max = Math.max(...valid);
    const range = (max - min) || 1;
    const step = w / Math.max(1, nums.length - 1);
    ctx.beginPath();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    let first = true;
    for (let i = 0; i < nums.length; i++) {
      const v = nums[i];
      const x = Math.round(i * step);
      if (v === null) { first = true; continue; }
      const y = h - Math.round(((v - min) / range) * (h - 4)) - 2;
      if (first) { ctx.moveTo(x,y); first = false; } else { ctx.lineTo(x,y); }
    }
    ctx.stroke();
  } catch (e) {
    // ignore
  }
}

document.getElementById('start').addEventListener('click', async () => {
  await api('/api/start', 'POST');
  await refresh();
});

document.getElementById('stop').addEventListener('click', async () => {
  await api('/api/stop', 'POST');
  await refresh();
});

document.getElementById('force').addEventListener('click', async () => {
  try {
    const sel = document.getElementById('force-action-select');
    const actionId = sel && sel.value ? sel.value : null;
    await fetch('/api/force', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionId }) });
    await refresh();
  } catch (err) {
    console.error('force action failed', err);
  }
});

async function fetchActions() {
  try {
    const r = await fetch('/api/actions');
    const j = await r.json();
    if (!j || !j.ok || !Array.isArray(j.actions)) return;
    const sel = document.getElementById('force-action-select');
    if (!sel) return;
    // clear existing except default
    const existingDefault = sel.querySelector('option[value=""]');
    sel.innerHTML = '';
    if (existingDefault) sel.appendChild(existingDefault);
    for (const a of j.actions) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.label || a.id;
      sel.appendChild(opt);
    }
  } catch (err) {
    console.error('fetchActions failed', err);
  }
}

const refreshBtn = document.getElementById('refresh');
if (refreshBtn) refreshBtn.addEventListener('click', async () => { await refresh(); await fetchAndRenderWeather(); });

document.getElementById('toggle-browser-view').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const cur = btn.dataset.visible === '1';
  const next = !cur;
  try {
    const r = await fetch('/api/browser-view', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ visible: next }) });
    const j = await r.json();
    if (j && j.ok) {
      btn.textContent = 'Browser view: ' + (j.visible ? 'on' : 'off');
      btn.dataset.visible = j.visible ? '1' : '0';
    }
  } catch (err) {
    console.error('toggle browser view', err);
  }
});

// 'Fetch Weather' button removed; use Refresh to update weather instead

const histEl = document.getElementById('history-select');
if (histEl) histEl.addEventListener('change', () => { fetchAndRenderWeather(); });

// Navigation
function showView(id) {
  ['view-status', 'view-logs', 'view-screenshots', 'view-config'].forEach(v => {
    const el = document.getElementById(v);
    if (el) el.style.display = (v === id) ? '' : 'none';
  });
}

document.getElementById('nav-status').addEventListener('click', () => showView('view-status'));
document.getElementById('nav-logs').addEventListener('click', async () => {
  showView('view-logs');
  await fetchAndShowLogs();
});
document.getElementById('nav-screenshots').addEventListener('click', async () => {
  showView('view-screenshots');
  await fetchAndShowScreenshots();
});

document.getElementById('nav-config').addEventListener('click', async () => {
  setActiveNav('nav-config');
  showView('view-config');
  await fetchAndShowConfig();
});

function setActiveNav(id) {
  ['nav-status','nav-logs','nav-screenshots'].forEach(btnId => {
    const b = document.getElementById(btnId);
    if (!b) return;
    if (btnId === id) b.classList.add('active'); else b.classList.remove('active');
  });
}

// enhance nav listeners to set active
document.getElementById('nav-status').addEventListener('click', () => { setActiveNav('nav-status'); showView('view-status'); });
document.getElementById('nav-logs').addEventListener('click', async () => { setActiveNav('nav-logs'); showView('view-logs'); await fetchAndShowLogs(); });
document.getElementById('nav-screenshots').addEventListener('click', async () => { setActiveNav('nav-screenshots'); showView('view-screenshots'); await fetchAndShowScreenshots(); });

async function fetchAndShowLogs() {
  try {
    const r = await api('/api/logs');
    if (r && r.ok) {
      const pre = document.getElementById('logs-pre');
      if (pre) pre.textContent = r.logs || '';
    }
  } catch (err) {
    console.error('fetch logs', err);
  }
}

document.getElementById('refresh-logs').addEventListener('click', fetchAndShowLogs);
document.getElementById('refresh-config').addEventListener('click', fetchAndShowConfig);

async function fetchAndShowScreenshots() {
  try {
    const r = await api('/api/screenshots');
    if (r && r.ok) {
      const list = document.getElementById('screenshots-list');
      if (!list) return;
      list.innerHTML = '';
      for (const f of r.files) {
        const a = document.createElement('a');
        a.href = '/screenshots/' + encodeURIComponent(f);
        a.target = '_blank';
        a.style.display = 'block';
        a.style.width = '160px';
        a.style.textAlign = 'center';
        const img = document.createElement('img');
        img.src = '/screenshots/' + encodeURIComponent(f);
        img.style.width = '160px';
        img.style.height = '90px';
        img.style.objectFit = 'cover';
        img.alt = f;
        const caption = document.createElement('div');
        caption.textContent = f;
        caption.style.fontSize = '12px';
        caption.style.overflow = 'hidden';
        caption.style.textOverflow = 'ellipsis';
        caption.style.whiteSpace = 'nowrap';
        a.appendChild(img);
        a.appendChild(caption);
        list.appendChild(a);
      }
    }
  } catch (err) {
    console.error('fetch screenshots', err);
  }
}

async function fetchAndShowConfig() {
  try {
    const [actionsRes, scenariosRes] = await Promise.all([api('/api/actions'), api('/api/scenarios')]);
    if (!actionsRes || !actionsRes.ok || !scenariosRes || !scenariosRes.ok) {
      const el = document.getElementById('config-actions');
      if (el) el.textContent = 'Failed to load config';
      return;
    }
    const actions = actionsRes.actions || [];
    const scenarios = scenariosRes.scenarios || [];
    const cont = document.getElementById('config-actions');
    if (!cont) return;

    let html = '<div style="margin-bottom:16px"><strong>Actions</strong></div>';
    if (!actions.length) {
      html += '<div>No actions configured.</div>';
    } else {
      html += '<table style="width:100%; border-collapse:collapse"><thead><tr><th style="border:1px solid #eee; padding:6px">id</th><th style="border:1px solid #eee; padding:6px">label</th><th style="border:1px solid #eee; padding:6px">description</th><th style="border:1px solid #eee; padding:6px">handler</th><th style="border:1px solid #eee; padding:6px">enabled</th></tr></thead><tbody>';
      for (const a of actions) {
        html += '<tr>' +
          `<td style="border:1px solid #eee; padding:6px">${(a.id||'')}</td>` +
          `<td style="border:1px solid #eee; padding:6px">${(a.label||'')}</td>` +
          `<td style="border:1px solid #eee; padding:6px">${(a.description||'')}</td>` +
          `<td style="border:1px solid #eee; padding:6px">${(a.handler||'')}</td>` +
          `<td style="border:1px solid #eee; padding:6px">${a.enabled ? 'yes' : 'no'}</td>` +
          '</tr>';
      }
      html += '</tbody></table>';
    }

    html += '<div style="margin:24px 0 16px"><strong>Scenarios</strong></div>';
    if (!scenarios.length) {
      html += '<div>No scenarios configured.</div>';
    } else {
      html += '<table style="width:100%; border-collapse:collapse"><thead><tr><th style="border:1px solid #eee; padding:6px">id</th><th style="border:1px solid #eee; padding:6px">label</th><th style="border:1px solid #eee; padding:6px">trigger</th><th style="border:1px solid #eee; padding:6px">actionId</th><th style="border:1px solid #eee; padding:6px">enabled</th></tr></thead><tbody>';
      for (const s of scenarios) {
        html += '<tr>' +
          `<td style="border:1px solid #eee; padding:6px">${(s.id||'')}</td>` +
          `<td style="border:1px solid #eee; padding:6px">${(s.label||'')}</td>` +
          `<td style="border:1px solid #eee; padding:6px; font-family:monospace">${(s.trigger||'')}</td>` +
          `<td style="border:1px solid #eee; padding:6px">${(s.actionId||'')}</td>` +
          `<td style="border:1px solid #eee; padding:6px">${s.enabled ? 'yes' : 'no'}</td>` +
          '</tr>';
      }
      html += '</tbody></table>';
    }

    cont.innerHTML = html;
  } catch (err) {
    console.error('fetchAndShowConfig failed', err);
    const el = document.getElementById('config-actions');
    if (el) el.textContent = 'Error loading config';
  }
}

document.getElementById('refresh-screenshots').addEventListener('click', fetchAndShowScreenshots);

// auto-refresh every 5s
refresh();
setInterval(refresh, 5000);
refreshBrowserViewToggle();
// fetch + render weather chart once on load
fetchAndRenderWeather();
// populate force action selector
fetchActions();
