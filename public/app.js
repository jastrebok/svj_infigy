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
    // state dot colour
    const dotEl = document.getElementById('state-dot');
    if (dotEl) {
      const dotColors = { idle: '#22c55e', logged_in: '#22c55e', ready: '#22c55e', busy: '#f59e0b', error: '#ef4444' };
      dotEl.style.backgroundColor = dotColors[s.state] || '#9ca3af';
    }
    setTextIf('last', s.lastActionAt ? ts(s.lastActionAt) : 'never');
    if (s.currentScenario && typeof s.currentScenario === 'object') {
      setTextIf('last-scenario', `Scenario: ${s.currentScenario.label || s.currentScenario.id} → ${s.currentScenario.actionId}`);
      setTextIf('current-scenario', `${s.currentScenario.label || s.currentScenario.id}`);
    } else {
      setTextIf('last-scenario', '—');
      setTextIf('current-scenario', 'None');
    }
    setTextIf('interval', s.intervalMs != null ? `${s.intervalMs} ms (${Math.round(s.intervalMs/1000)} s)` : 'n/a');
    setTextIf('cooldown', s.actionCooldownMs != null ? `${s.actionCooldownMs} ms (${Math.round(s.actionCooldownMs/1000)} s)` : 'n/a');

    if (s.latestWeather) {
      setTextIf('weather-clouds', typeof s.latestWeather.clouds === 'number' ? s.latestWeather.clouds : 'n/a');
      setTextIf('weather-uvi', typeof s.latestWeather.uvi === 'number' ? s.latestWeather.uvi : 'n/a');
      setTextIf('weather-range', s.latestWeather.rangeStartIso && s.latestWeather.rangeEndIso ? (s.latestWeather.rangeStartIso + ' → ' + s.latestWeather.rangeEndIso) : 'n/a');
      setTextIf('weather-fetched', s.latestWeather.fetchedAt ? new Date(s.latestWeather.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'n/a');
      setTextIf('weather-forecast-uv-today', typeof s.latestWeather.forecast_uv_median_today === 'number' ? s.latestWeather.forecast_uv_median_today.toFixed(1) : 'n/a');
      setTextIf('weather-forecast-uv-tomorrow', typeof s.latestWeather.forecast_uv_median_tomorrow === 'number' ? s.latestWeather.forecast_uv_median_tomorrow.toFixed(1) : 'n/a');
      updateWeatherIcon(typeof s.latestWeather.clouds === 'number' ? s.latestWeather.clouds : null);
    } else {
      setTextIf('weather-clouds', 'n/a');
      setTextIf('weather-uvi', 'n/a');
      setTextIf('weather-range', 'n/a');
      setTextIf('weather-fetched', 'n/a');
      setTextIf('weather-forecast-uv-today', 'n/a');
      setTextIf('weather-forecast-uv-tomorrow', 'n/a');
      updateWeatherIcon(null);
    }

    if (s.latestPower) {
      setTextIf('power-house', s.latestPower['House'] ?? 'n/a');
      setTextIf('power-photovoltaics', s.latestPower['Photovoltaics'] ?? 'n/a');
      setTextIf('power-battery', s.latestPower['Battery'] ?? 'n/a');
      setTextIf('power-battery-cap', (s.latestWeather && typeof s.latestWeather.battery_cap === 'number') ? (s.latestWeather.battery_cap.toFixed(1) + '%') : 'n/a');
      setTextIf('power-grid', s.latestPower['Grid'] ?? 'n/a');
      // plug status provided separately as latestPlug (display uppercase)
      setTextIf('power-plug', (typeof s.latestPlug === 'string') ? s.latestPlug.toUpperCase() : 'n/a');
      const plugEl = document.getElementById('power-plug');
      if (plugEl) {
        const plugState = (typeof s.latestPlug === 'string') ? s.latestPlug.toLowerCase() : '';
        if (plugState === 'on') {
          plugEl.style.color = 'var(--success)';
        } else if (plugState === 'off') {
          plugEl.style.color = 'var(--muted)';
        } else {
          plugEl.style.color = '';
        }
      }
    } else {
      setTextIf('power-house', 'n/a');
      setTextIf('power-photovoltaics', 'n/a');
      setTextIf('power-battery', 'n/a');
      setTextIf('power-grid', 'n/a');
      setTextIf('power-plug', 'n/a');
    }

    // Fetcher next-run info (server provides nextFetchAt)
    if (s.nextFetchAt) {
      const nfd = new Date(s.nextFetchAt);
      setTextIf('next-refresh-time', nfd.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setTextIf('next-refresh-date', nfd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }));
      window.__nextFetchAt = s.nextFetchAt;
    } else {
      setTextIf('next-refresh-time', 'n/a');
      setTextIf('next-refresh-date', '—');
      window.__nextFetchAt = null;
      setTextIf('countdown', '—');
    }
    // Show matched scenarios
    if (s.matchedScenarios && Array.isArray(s.matchedScenarios)) {
      const matched = s.matchedScenarios.filter(x => x.matched).map(x => x.label || x.id);
      setTextIf('matched-scenarios', matched.length ? matched.join(', ') : 'None');
    } else {
      setTextIf('matched-scenarios', 'None');
    }
  } catch (err) {
    console.error(err);
  }
}

// countdown updater (1s) reading nextFetchAt set by refresh()
function updateCountdown() {
  const next = window.__nextFetchAt || null;
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

function parseNumericValue(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).replace(/\s+/g, '');
  const match = str.match(/[-+]?\d+[,.]?\d*/);
  if (!match) return null;
  const num = Number(match[0].replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

function buildPowerSeries(rows, key) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(row => row && typeof row.ts === 'number')
    .map(row => ({ x: row.ts, y: parseNumericValue(row.power?.[key]) }))
    .filter(point => point.y !== null)
    .sort((a, b) => a.x - b.x);
}

function buildPlugRanges(rows) {
  if (!Array.isArray(rows)) return [];
  const sorted = rows
    .filter(row => row && typeof row.ts === 'number')
    .sort((a, b) => a.ts - b.ts);
  const ranges = [];
  let currentState = null;
  let startMs = null;
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const state = typeof row.plug === 'string' ? row.plug.toLowerCase() : 'off';
    const next = sorted[i + 1];
    const nextState = next && typeof next.plug === 'string' ? next.plug.toLowerCase() : 'off';
    if (currentState === null) {
      currentState = state;
      startMs = row.ts;
    }
    if (state !== currentState) {
      currentState = state;
      startMs = row.ts;
    }
    if (nextState !== state) {
      const endMs = next ? next.ts : row.ts + 60 * 1000;
      if (startMs !== null) {
        ranges.push({ startMs, endMs, state });
      }
      startMs = next ? next.ts : null;
      currentState = nextState;
    }
  }
  return ranges;
}

// Chart handling
let weatherChart = null;
let powerChart = null;
let weatherTimeRange = null;
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

  const entries = hourly.map(h => ({
    ts: h.dt * 1000,
    clouds: typeof h.clouds === 'number' ? h.clouds : null,
    uvi: typeof h.uvi === 'number' ? h.uvi : null,
    isDay: !!h.isDay,
  }));

  const clouds = entries.map(e => ({ x: e.ts, y: e.clouds }));
  const uvis = entries.map(e => ({ x: e.ts, y: e.uvi }));

  const ctx = document.getElementById('weatherChart').getContext('2d');
  console.log('updateChartFromHourly', { hourlyLength: hourly.length });

  weatherTimeRange = {
    startMs: entries[0].ts,
    endMs: entries[entries.length - 1].ts,
  };

  if (!ctx) {
    showChartError('Canvas context not available');
    return;
  }
  if (window.Chart === undefined) {
    showChartError('Chart.js not loaded');
    return;
  }

  const nightRanges = [];
  let rangeStart = null;
  for (let i = 0; i < entries.length; i++) {
    if (!entries[i].isDay) {
      if (rangeStart === null) rangeStart = entries[i].ts;
    } else if (rangeStart !== null) {
      nightRanges.push({ startMs: rangeStart, endMs: entries[i].ts });
      rangeStart = null;
    }
  }
  if (rangeStart !== null) {
    nightRanges.push({ startMs: rangeStart, endMs: entries[entries.length - 1].ts });
  }

  const pluginNight = {
    id: 'nightShade',
    beforeDraw(chart) {
      const { ctx, chartArea: ca, scales } = chart;
      const xScale = scales.x;
      ctx.save();
      for (const r of nightRanges) {
        const left = xScale.getPixelForValue(r.startMs);
        const right = xScale.getPixelForValue(r.endMs);
        if (isNaN(left) || isNaN(right)) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(left, ca.top, right - left, ca.bottom - ca.top);
      }
      ctx.restore();
    }
  };

  const pluginCurrentLine = {
    id: 'currentLine',
    afterDraw(chart) {
      const { ctx, chartArea: ca, scales } = chart;
      const xScale = scales.x;
      const x = xScale.getPixelForValue(Date.now());
      if (x === null || x === undefined || isNaN(x)) return;
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, ca.top);
      ctx.lineTo(x, ca.bottom);
      ctx.stroke();
      ctx.restore();
    }
  };

  if (weatherChart) {
    weatherChart.data.datasets[0].data = clouds;
    weatherChart.data.datasets[1].data = uvis;
    weatherChart.update('none');
    return;
  }

  try {
    weatherChart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Clouds (%)',
            data: clouds,
            borderColor: 'rgba(54,162,235,1)',
            backgroundColor: 'rgba(54,162,235,0.2)',
            yAxisID: 'y',
            tension: 0.2,
            parsing: false,
          },
          {
            label: 'UV Index',
            data: uvis,
            borderColor: 'rgba(255,99,132,1)',
            backgroundColor: 'rgba(255,99,132,0.2)',
            yAxisID: 'y1',
            tension: 0.2,
            parsing: false,
          },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            min: weatherTimeRange.startMs,
            max: weatherTimeRange.endMs,
            title: { display: true, text: 'Time' },
            ticks: {
              callback(value) {
                const d = new Date(value);
                return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
              }
            }
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
          legend: { position: 'top' },
          zoom: {
            pan: { enabled: true, mode: 'x', threshold: 5 },
            zoom: { wheel: { enabled: true, speed: 0.1 }, pinch: { enabled: true }, mode: 'x' },
          }
        }
      },
      plugins: [pluginNight, pluginCurrentLine]
    });
  } catch (err) {
    showChartError('Failed to create Chart: ' + String(err));
    console.error(err);
  }
}

// Render chart from precomputed series arrays
function updateChartFromSeries(entries, nowMs, medianInfo) {
  if (!entries || !entries.length) return;
  const ctx = document.getElementById('weatherChart').getContext('2d');
  if (!ctx) { showChartError('Canvas context not available'); return; }
  if (window.Chart === undefined) { showChartError('Chart.js not loaded'); return; }

  const sorted = entries.slice().sort((a, b) => a.ts - b.ts);
  const clouds = sorted.map(e => ({ x: e.ts, y: e.clouds }));
  const uvis = sorted.map(e => ({ x: e.ts, y: e.uvi }));
  const dayRanges = [];
  let rangeStart = null;
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const isDay = typeof entry.isDay === 'boolean' ? entry.isDay : (new Date(entry.ts).getHours() >= 6 && new Date(entry.ts).getHours() < 18);
    if (!isDay) {
      if (rangeStart === null) rangeStart = entry.ts;
    } else if (rangeStart !== null) {
      dayRanges.push({ startMs: rangeStart, endMs: entry.ts });
      rangeStart = null;
    }
  }
  if (rangeStart !== null) {
    dayRanges.push({ startMs: rangeStart, endMs: sorted[sorted.length - 1].ts });
  }

  const pluginNight = {
    id: 'nightShade',
    beforeDraw(chart, args, options) {
      const { ctx, chartArea: ca, scales } = chart;
      const xScale = scales.x;
      ctx.save();
      for (const r of dayRanges) {
        const left = xScale.getPixelForValue(r.startMs);
        const right = xScale.getPixelForValue(r.endMs);
        if (isNaN(left) || isNaN(right)) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(left, ca.top, right - left, ca.bottom - ca.top);
      }
      ctx.restore();
    }
  };

  const pluginCurrentLine = {
    id: 'currentLine',
    afterDraw(chart, args, options) {
      const { ctx, chartArea: ca, scales } = chart;
      const xScale = scales.x;
      const x = xScale.getPixelForValue(nowMs);
      if (x === null || x === undefined || isNaN(x)) return;
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

  // Draws a dashed horizontal reference line (on the UV axis) spanning a single day,
  // representing that day's whole-day UV forecast median (see stateController.fetchLatestWeather).
  const pluginMedianLines = {
    id: 'uvMedianLines',
    afterDraw(chart) {
      const info = chart.__medianInfo;
      if (!info) return;
      const { ctx, chartArea: ca, scales } = chart;
      const xScale = scales.x;
      const yScale = scales.y1;
      if (!xScale || !yScale) return;
      const segments = [
        { value: info.todayMedian, startMs: info.todayStartMs, endMs: info.tomorrowStartMs, label: 'Today median UV', color: 'rgba(230,126,0,0.9)' },
        { value: info.tomorrowMedian, startMs: info.tomorrowStartMs, endMs: info.dayAfterTomorrowStartMs, label: 'Tomorrow median UV', color: 'rgba(148,0,211,0.8)' },
      ];
      ctx.save();
      for (const seg of segments) {
        if (typeof seg.value !== 'number') continue;
        const y = yScale.getPixelForValue(seg.value);
        if (isNaN(y)) continue;
        let left = xScale.getPixelForValue(seg.startMs);
        let right = xScale.getPixelForValue(seg.endMs);
        if (isNaN(left) && isNaN(right)) continue;
        left = Math.max(ca.left, isNaN(left) ? ca.left : left);
        right = Math.min(ca.right, isNaN(right) ? ca.right : right);
        if (right <= left) continue;
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = seg.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = seg.color;
        ctx.font = '11px Arial, sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${seg.label}: ${seg.value.toFixed(1)}`, left + 4, y - 2);
      }
      ctx.restore();
    }
  };

  const chartData = {
    datasets: [
      {
        label: 'Clouds (%)',
        data: clouds,
        borderColor: 'rgba(54,162,235,1)',
        backgroundColor: 'rgba(54,162,235,0.2)',
        yAxisID: 'y',
        tension: 0.2,
        parsing: false,
      },
      {
        label: 'UV Index',
        data: uvis,
        borderColor: 'rgba(255,99,132,1)',
        backgroundColor: 'rgba(255,99,132,0.2)',
        yAxisID: 'y1',
        tension: 0.2,
        parsing: false,
      },
    ],
  };

  const xScale = {
    type: 'linear',
    title: { display: true, text: 'Time' },
    ticks: {
      callback(value) {
        const d = new Date(value);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
      }
    }
  };
  // Determine a sensible x-axis time range so chart renders even with no datasets.
  if (weatherTimeRange && typeof weatherTimeRange.startMs === 'number' && typeof weatherTimeRange.endMs === 'number') {
    xScale.min = weatherTimeRange.startMs;
    xScale.max = weatherTimeRange.endMs;
  } else {
    // fallback to the rows' timestamp range or a 1-hour window around now
    const sortedRows = (rows && rows.length) ? rows.slice().sort((a, b) => a.ts - b.ts) : [];
    const minTs = sortedRows.length ? sortedRows[0].ts : (nowMs - (60 * 60 * 1000));
    const maxTs = sortedRows.length ? sortedRows[sortedRows.length - 1].ts : (nowMs + (60 * 60 * 1000));
    xScale.min = minTs;
    xScale.max = maxTs;
  }

  const config = {
    type: 'line',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: xScale,
        y: { type: 'linear', position: 'left', suggestedMin: 0, suggestedMax: 100, title: { display: true, text: 'Clouds (%)' } },
        y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, suggestedMin: 0, suggestedMax: 11, title: { display: true, text: 'UV Index' } }
      },
      plugins: { legend: { position: 'top' } }
    },
    plugins: [pluginNight, pluginCurrentLine, pluginMedianLines]
  };

  if (weatherChart) {
    weatherChart.data.datasets = chartData.datasets;
    weatherChart.__medianInfo = medianInfo || null;
    weatherChart.update('none');
    return;
  }

  const zoomOpts = {
    pan: { enabled: true, mode: 'x', threshold: 5 },
    zoom: { wheel: { enabled: true, speed: 0.1 }, pinch: { enabled: true }, mode: 'x' },
    limits: {
      x: {
        min: (weatherTimeRange && weatherTimeRange.fullStartMs) || undefined,
        max: (weatherTimeRange && weatherTimeRange.fullEndMs) || undefined,
      }
    }
  };

  try {
    weatherChart = new Chart(ctx, {
      ...config,
      options: { ...config.options, plugins: { ...config.options.plugins, zoom: zoomOpts } }
    });
    weatherChart.__medianInfo = medianInfo || null;
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
        const since = Date.now() - (7 * 24 * 60 * 60 * 1000); // always load 7 days; user zooms to desired range
        const m = await api('/api/metrics?since=' + since);
        const rows = (m && m.ok && m.rows) ? m.rows : [];

        // Build past N hourly timestamps aligned to hour
        const chartEntries = rows
          .filter(row => row && typeof row.ts === 'number')
          .map(row => ({
            ts: row.ts,
            clouds: row.weather && typeof row.weather.clouds === 'number' ? row.weather.clouds : null,
            uvi: row.weather && typeof row.weather.uvi === 'number' ? row.weather.uvi : null,
            isDay: typeof row.weather?.isDay === 'boolean' ? row.weather.isDay : undefined,
          }))
          .filter(entry => entry.clouds !== null || entry.uvi !== null)
          .sort((a, b) => a.ts - b.ts);

        const futureEntries = hourly.map(h => ({
          ts: h.dt * 1000,
          clouds: typeof h.clouds === 'number' ? h.clouds : null,
          uvi: typeof h.uvi === 'number' ? h.uvi : null,
          isDay: !!h.isDay,
        })).filter(entry => entry.clouds !== null || entry.uvi !== null);

        const allEntries = chartEntries.concat(futureEntries).sort((a, b) => a.ts - b.ts);
        const nowMs = Date.now();
        const fullEndMs = allEntries.length ? allEntries[allEntries.length - 1].ts : nowMs + 72 * 60 * 60 * 1000;
        const fullStartMs = nowMs - (7 * 24 * 60 * 60 * 1000);
        weatherTimeRange = {
          startMs: nowMs - (12 * 60 * 60 * 1000), // initial chart view: last 12 h
          endMs: fullEndMs,
          fullStartMs,
          fullEndMs,
        };
        const todayStartMs = new Date(new Date(nowMs).getFullYear(), new Date(nowMs).getMonth(), new Date(nowMs).getDate()).getTime();
        const tomorrowStartMs = todayStartMs + 24 * 60 * 60 * 1000;
        const dayAfterTomorrowStartMs = tomorrowStartMs + 24 * 60 * 60 * 1000;
        const medianInfo = {
          todayMedian: typeof summary.forecast_uv_median_today === 'number' ? summary.forecast_uv_median_today : null,
          tomorrowMedian: typeof summary.forecast_uv_median_tomorrow === 'number' ? summary.forecast_uv_median_tomorrow : null,
          todayStartMs,
          tomorrowStartMs,
          dayAfterTomorrowStartMs,
        };
        updateChartFromSeries(allEntries, nowMs, medianInfo);
        // Draw sparklines for power values and render the larger power chart
        try {
          const keys = { house: 'House', photovoltaics: 'Photovoltaics', battery: 'Battery' };
          for (const [cid, key] of Object.entries(keys)) {
            const series = rows
              .filter(row => row && row.power)
              .map(row => parseNumericValue(row.power[key]));
            drawSparkline('spark-' + cid, series);
            const cnt = series.filter(x => x !== null && typeof x === 'number').length;
            const el = document.getElementById('sparkcount-' + cid);
            if (el) el.textContent = `samples: ${cnt}`;
          }
          // battery capacity sparkline (from weather.battery_cap)
          const capSeries = rows
            .filter(row => row && row.weather)
            .map(row => (typeof row.weather.battery_cap === 'number' ? Number(row.weather.battery_cap) : null));
          drawSparkline('spark-battery-cap', capSeries);
          const capCnt = capSeries.filter(x => x !== null).length;
          const capEl = document.getElementById('sparkcount-battery-cap');
          if (capEl) capEl.textContent = `samples: ${capCnt}`;
          // Draw plug status sparkline (0=off, 1=on)
          const plugSeries = rows
            .filter(row => row && row.plug)
            .map(row => row.plug === 'on' ? 1 : (row.plug === 'off' ? 0 : null));
          drawSparkline('spark-plug', plugSeries);
          const plugCnt = plugSeries.filter(x => x !== null).length;
          const plugEl = document.getElementById('sparkcount-plug');
          if (plugEl) plugEl.textContent = `samples: ${plugCnt}`;
        } catch (e) {
          console.error('sparkline draw failed', e);
        }
        updatePowerChart(rows, Date.now());
      } catch (err) {
        console.error('fetch metrics failed', err);
        updateChartFromHourly(hourly);
        // render empty sparklines as placeholder
        drawSparkline('spark-house', []);
        drawSparkline('spark-photovoltaics', []);
        drawSparkline('spark-battery', []);
        drawSparkline('spark-plug', []);
        try {
          const els = ['house','photovoltaics','battery','plug'];
          for (const id of els) {
            const el = document.getElementById('sparkcount-' + id);
            if (el) el.textContent = 'samples: 0';
          }
        } catch (e) {}
        updatePowerChart([], Date.now());
      }
    }
  } catch (err) {
    console.error('fetchAndRenderWeather error', err);
  }
}

function updatePowerChart(rows, nowMs) {
  const ctx = document.getElementById('powerChart').getContext('2d');
  if (!ctx) return;
  if (window.Chart === undefined) return;

  const powerKeys = [
    { label: 'House', field: 'House', borderColor: 'rgba(54,162,235,1)' },
    { label: 'Photovoltaics', field: 'Photovoltaics', borderColor: 'rgba(255,159,64,1)' },
    { label: 'Battery', field: 'Battery', borderColor: 'rgba(153,102,255,1)' },
    { label: 'Grid', field: 'Grid', borderColor: 'rgba(75,192,192,1)' },
    // Battery capacity from weather.battery_cap (percentage)
    { label: 'Battery Capacity', field: 'battery_cap', borderColor: 'rgba(255,205,86,1)', isWeather: true },
  ];

  const datasets = powerKeys.map(({ label, field, borderColor }) => ({
    label,
    data: (field === 'battery_cap') ? rows
      .filter(row => row && typeof row.ts === 'number')
      .map(row => ({ x: row.ts, y: parseNumericValue(row.weather?.battery_cap) }))
      .filter(point => point.y !== null)
      .sort((a, b) => a.x - b.x)
    : buildPowerSeries(rows, field),
    borderColor,
    backgroundColor: borderColor.replace(/rgba\((\d+),(\d+),(\d+),.*\)/, 'rgba($1,$2,$3,0.15)'),
    tension: 0.2,
    fill: false,
    parsing: false,
    spanGaps: true,
    pointRadius: 2,
    yAxisID: (field === 'battery_cap') ? 'y2' : 'y',
  })).filter(ds => ds.data && ds.data.length);

  const plugRanges = buildPlugRanges(rows);

  const pluginPlugState = {
    id: 'plugStateShade',
    beforeDraw(chart) {
      const { ctx, chartArea: ca, scales } = chart;
      const xScale = scales.x;
      ctx.save();
      for (const range of plugRanges) {
        const left = xScale.getPixelForValue(range.startMs);
        const right = xScale.getPixelForValue(range.endMs);
        if (isNaN(left) || isNaN(right)) continue;
        ctx.fillStyle = range.state === 'on' ? 'rgba(40,167,69,0.15)' : 'rgba(117,117,117,0.08)';
        ctx.fillRect(left, ca.top, right - left, ca.bottom - ca.top);
      }
      ctx.restore();
    }
  };

  const pluginCurrentLine = {
    id: 'currentLine',
    afterDraw(chart) {
      const { ctx, chartArea: ca, scales } = chart;
      const xScale = scales.x;
      const x = xScale.getPixelForValue(nowMs);
      if (x === null || x === undefined || isNaN(x)) return;
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, ca.top);
      ctx.lineTo(x, ca.bottom);
      ctx.stroke();
      ctx.restore();
    }
  };

  const chartData = {
    datasets,
  };

  const xScale = {
    type: 'linear',
    min: nowMs - (12 * 60 * 60 * 1000), // initial view: last 12 h
    max: nowMs,
    title: { display: true, text: 'Time' },
    ticks: {
      callback(value) {
        const d = new Date(value);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
      }
    }
  };

  const config = {
    type: 'line',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: xScale,
        y: {
          type: 'linear',
          title: { display: true, text: 'Power' },
          beginAtZero: true,
        }
        ,
        y2: {
          type: 'linear',
          position: 'right',
          grid: { drawOnChartArea: false },
          suggestedMin: 0,
          suggestedMax: 100,
          title: { display: true, text: 'Battery Capacity (%)' }
        }
      },
      plugins: {
        legend: { position: 'top' },
        zoom: {
          pan: { enabled: true, mode: 'x', threshold: 5 },
          zoom: { wheel: { enabled: true, speed: 0.1 }, pinch: { enabled: true }, mode: 'x' },
          limits: {
            x: {
              min: (weatherTimeRange && weatherTimeRange.fullStartMs) || (nowMs - 7 * 24 * 60 * 60 * 1000),
              max: nowMs,
            }
          }
        }
      }
    },
    plugins: [pluginPlugState, pluginCurrentLine]
  };

  if (powerChart) {
    powerChart.destroy();
    powerChart = null;
  }

  try {
    powerChart = new Chart(ctx, config);
  } catch (err) {
    console.error('Failed to create power Chart:', err);
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
    const min = Math.min(...valid); 
    const max = Math.max(...valid);
    // For binary data (0/1), use fixed spacing to avoid edge clipping
    const range = (max - min) || 1;
    const isBinary = (max === 1 && min === 0 && new Set(valid).size === 2);
    const padding = isBinary ? 4 : 2; // more padding for binary to keep line away from edges
    const step = w / Math.max(1, nums.length - 1);
    ctx.beginPath();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = isBinary ? 2.5 : 1.5; // thicker for binary
    let first = true;
    for (let i = 0; i < nums.length; i++) {
      const v = nums[i];
      const x = Math.round(i * step);
      if (v === null) { first = true; continue; }
      const y = h - padding - Math.round(((v - min) / range) * (h - 2 * padding));
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
    const btn = document.getElementById('force');
    const sel = document.getElementById('force-action-select');
    const actionId = sel && sel.value ? sel.value : null;
    if (btn) {
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = 'Working…';
      try {
        await fetch('/api/force', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionId }) });
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    } else {
      await fetch('/api/force', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionId }) });
    }
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

// Reset zoom buttons
document.getElementById('reset-zoom-weather')?.addEventListener('click', () => { if (weatherChart) weatherChart.resetZoom(); });
document.getElementById('reset-zoom-power')?.addEventListener('click', () => { if (powerChart) powerChart.resetZoom(); });

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
  ['nav-status','nav-logs','nav-screenshots','nav-config'].forEach(btnId => {
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
      if (pre) {
        const lines = (r.logs || '').split('\n').filter(l => l.trim());
        // Parse JSON entries to find activity worth summarizing (actions, config edits, screenshot cleanup)
        const activityLogs = [];
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj && (obj.kind === 'action' || obj.kind === 'config' || obj.kind === 'screenshots_cleared')) {
              activityLogs.push(obj);
            }
          } catch (e) {
            // skip non-JSON lines
          }
        }

        // Show recent activity first (newest to oldest)
        if (activityLogs.length > 0) {
          const recentActivity = activityLogs.slice(-20).reverse();
          let html = '<div style="margin-bottom: 12px;"><strong>Recent Activity (latest first):</strong></div>';
          html += '<table style="width:100%; border-collapse:collapse; margin-bottom: 12px;">';
          html += '<tr style="background:#f0f0f0;"><th style="border:1px solid #ccc; padding:6px; text-align:left;">Time</th><th style="border:1px solid #ccc; padding:6px; text-align:left;">Type</th><th style="border:1px solid #ccc; padding:6px; text-align:left;">Details</th></tr>';
          for (const a of recentActivity) {
            const time = a.timeStr || (a.ts ? new Date(a.ts).toLocaleString('en-GB', { timeZone: 'Europe/Prague' }) : 'n/a');
            let type = 'Action';
            let details = '';
            if (a.kind === 'config') {
              type = 'Config';
              details = `Saved ${a.count ?? 0} ${escapeHtml(a.target || 'item(s)')}` + (Array.isArray(a.ids) && a.ids.length ? `: ${escapeHtml(a.ids.join(', '))}` : '');
            } else if (a.kind === 'screenshots_cleared') {
              type = 'Screenshots';
              const cutoff = a.beforeMs ? new Date(a.beforeMs).toLocaleDateString('en-GB') : 'n/a';
              details = `Cleared ${a.count ?? 0} screenshot(s) older than ${cutoff}`;
            } else {
              const scenario = a.scenarioLabel ? escapeHtml(a.scenarioLabel) + ' &rarr; ' : '';
              const action = escapeHtml(a.actionLabel || a.actionId || 'n/a');
              details = `${scenario}<strong>${action}</strong>` + (a.status && a.status !== 'executed' ? ` (${escapeHtml(a.status)})` : '');
            }
            html += `<tr><td style="border:1px solid #ccc; padding:6px;">${time}</td><td style="border:1px solid #ccc; padding:6px;">${type}</td><td style="border:1px solid #ccc; padding:6px;">${details}</td></tr>`;
          }
          html += '</table>';
          html += '<div style="margin-bottom: 12px;"><strong>Full Log:</strong></div>';
          html += '<pre style="height:300px; overflow:auto; background:#111; color:#eee; padding:12px; border-radius:6px; border:1px solid #ccc;">' + (r.logs || '') + '</pre>';
          pre.innerHTML = html;
        } else {
          pre.textContent = r.logs || 'No logs yet';
        }
      }
    }
  } catch (err) {
    console.error('fetch logs', err);
  }
}

document.getElementById('refresh-logs').addEventListener('click', fetchAndShowLogs);
document.getElementById('refresh-config').addEventListener('click', fetchAndShowConfig);

// ---- Editable Config (Actions / Scenarios) ----

let configActions = [];
let configScenarios = [];
let lastFocusedTrigger = null;

const TRIGGER_VARIABLES = [
  { name: 'uvi', desc: 'Current UV index' },
  { name: 'clouds', desc: 'Current cloud cover (%)' },
  { name: 'forecast_uv_median_today', desc: 'Median UV forecast for today' },
  { name: 'forecast_uv_median_tomorrow', desc: 'Median UV forecast for tomorrow' },
  { name: 'battery_cap', desc: 'Battery capacity (%)' },
  { name: 'isDay', desc: 'true while it is daytime' },
  { name: 'isNight', desc: 'true while it is nighttime' },
  { name: 'power_total', desc: 'Sum of all numeric power readings' },
  { name: "power['House']", desc: 'House power reading' },
  { name: "power['Photovoltaics']", desc: 'Photovoltaics power reading' },
  { name: "power['Battery']", desc: 'Battery power reading' },
  { name: "power['Grid']", desc: 'Grid power reading' },
];

function escapeAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtml(value) {
  return escapeAttr(value).replace(/'/g, '&#39;');
}

function renderTriggerVariables() {
  const cont = document.getElementById('trigger-variables');
  if (!cont) return;
  cont.innerHTML = TRIGGER_VARIABLES.map(v =>
    `<span class="cfg-var-chip" draggable="true" data-var="${escapeAttr(v.name)}" title="${escapeAttr(v.desc)}">${escapeHtml(v.name)}</span>`
  ).join('');
  cont.querySelectorAll('.cfg-var-chip').forEach(chip => {
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', chip.dataset.var);
      e.dataTransfer.effectAllowed = 'copy';
    });
    chip.addEventListener('click', () => {
      insertIntoTrigger(chip.dataset.var);
    });
  });
}

function insertIntoTrigger(text) {
  const el = lastFocusedTrigger;
  if (!el || !document.body.contains(el)) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  const pos = start + text.length;
  el.focus();
  el.setSelectionRange(pos, pos);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function renderActionsTable() {
  const cont = document.getElementById('config-actions');
  if (!cont) return;
  if (!configActions.length) {
    cont.innerHTML = '<div>No actions configured. Click "+ Add action" to create one.</div>';
    return;
  }
  let html = '<table class="cfg-table"><thead><tr>' +
    '<th style="width:14%">id</th><th style="width:14%">label</th><th style="width:26%">description</th>' +
    '<th style="width:14%">handler</th><th style="width:20%">playwright steps (one per line)</th>' +
    '<th style="width:6%">enabled</th><th style="width:6%"></th>' +
    '</tr></thead><tbody>';
  configActions.forEach((a, i) => {
    const steps = Array.isArray(a.playwright_steps) ? a.playwright_steps.join('\n') : (a.playwright_steps || '');
    html += `<tr data-index="${i}">` +
      `<td><input type="text" class="cfg-field" data-field="id" value="${escapeAttr(a.id)}"></td>` +
      `<td><input type="text" class="cfg-field" data-field="label" value="${escapeAttr(a.label)}"></td>` +
      `<td><textarea class="cfg-field" data-field="description" rows="2">${escapeHtml(a.description || '')}</textarea></td>` +
      `<td><input type="text" class="cfg-field" data-field="handler" value="${escapeAttr(a.handler)}"></td>` +
      `<td><textarea class="cfg-field" data-field="playwright_steps" rows="2">${escapeHtml(steps)}</textarea></td>` +
      `<td class="cfg-col-enabled"><input type="checkbox" class="cfg-field" data-field="enabled" ${a.enabled ? 'checked' : ''}></td>` +
      `<td class="cfg-col-actions"><button type="button" class="cfg-remove-row" data-remove-action="${i}">✕</button></td>` +
      '</tr>';
  });
  html += '</tbody></table>';
  cont.innerHTML = html;
}

function renderScenariosTable() {
  const cont = document.getElementById('config-scenarios');
  if (!cont) return;
  if (!configScenarios.length) {
    cont.innerHTML = '<div>No scenarios configured. Click "+ Add scenario" to create one.</div>';
    return;
  }
  const actionOptions = configActions.map(a => `<option value="${escapeAttr(a.id)}">${escapeHtml(a.label || a.id)}</option>`).join('');
  let html = '<table class="cfg-table"><thead><tr>' +
    '<th style="width:12%">id</th><th style="width:14%">label</th><th style="width:20%">description</th>' +
    '<th style="width:26%">trigger</th><th style="width:16%">actionId</th><th style="width:6%">enabled</th><th style="width:6%"></th>' +
    '</tr></thead><tbody>';
  configScenarios.forEach((s, i) => {
    html += `<tr data-index="${i}">` +
      `<td><input type="text" class="cfg-field" data-field="id" value="${escapeAttr(s.id)}"></td>` +
      `<td><input type="text" class="cfg-field" data-field="label" value="${escapeAttr(s.label)}"></td>` +
      `<td><textarea class="cfg-field" data-field="description" rows="2">${escapeHtml(s.description || '')}</textarea></td>` +
      `<td><textarea class="cfg-field cfg-trigger" data-field="trigger" rows="2">${escapeHtml(s.trigger || '')}</textarea></td>` +
      `<td><select class="cfg-field" data-field="actionId"><option value="">— choose action —</option>${actionOptions}</select></td>` +
      `<td class="cfg-col-enabled"><input type="checkbox" class="cfg-field" data-field="enabled" ${s.enabled ? 'checked' : ''}></td>` +
      `<td class="cfg-col-actions"><button type="button" class="cfg-remove-row" data-remove-scenario="${i}">✕</button></td>` +
      '</tr>';
  });
  html += '</tbody></table>';
  cont.innerHTML = html;
  // set select values after inserting (option value with special chars is safer this way too)
  configScenarios.forEach((s, i) => {
    const row = cont.querySelector(`tr[data-index="${i}"]`);
    const sel = row && row.querySelector('select[data-field="actionId"]');
    if (sel) sel.value = s.actionId || '';
  });
}

function showConfigSaveMessage(containerEl, ok, text) {
  if (!containerEl) return;
  let msg = containerEl.querySelector('.cfg-save-msg');
  if (!msg) {
    msg = document.createElement('span');
    msg.className = 'cfg-save-msg';
    containerEl.appendChild(msg);
  }
  msg.className = 'cfg-save-msg ' + (ok ? 'ok' : 'err');
  msg.textContent = text;
  setTimeout(() => { if (msg && msg.parentNode) msg.remove(); }, 4000);
}

// Actions table: field edits, add/remove rows
document.getElementById('config-actions').addEventListener('input', (e) => {
  const row = e.target.closest('tr[data-index]');
  if (!row || !e.target.classList.contains('cfg-field')) return;
  const idx = Number(row.dataset.index);
  const field = e.target.dataset.field;
  const action = configActions[idx];
  if (!action) return;
  if (field === 'enabled') {
    action.enabled = e.target.checked;
  } else if (field === 'playwright_steps') {
    action.playwright_steps = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
  } else {
    action[field] = e.target.value;
  }
});
document.getElementById('config-actions').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove-action]');
  if (!btn) return;
  const idx = Number(btn.dataset.removeAction);
  configActions.splice(idx, 1);
  renderActionsTable();
  renderScenariosTable();
});
document.getElementById('add-action-row').addEventListener('click', () => {
  configActions.push({ id: '', label: '', description: '', handler: '', playwright_steps: [], enabled: true });
  renderActionsTable();
  renderScenariosTable();
});
document.getElementById('save-actions').addEventListener('click', async () => {
  const cont = document.getElementById('config-actions').parentElement;
  try {
    const r = await fetch('/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actions: configActions }) });
    const j = await r.json();
    if (j && j.ok) {
      showConfigSaveMessage(cont, true, 'Saved.');
      await fetchActions();
      renderScenariosTable();
    } else {
      showConfigSaveMessage(cont, false, 'Save failed: ' + (j && j.error ? j.error : 'unknown error'));
    }
  } catch (err) {
    showConfigSaveMessage(cont, false, 'Save failed: ' + String(err));
  }
});

// Scenarios table: field edits, add/remove rows, trigger drag & drop, focus tracking
document.getElementById('config-scenarios').addEventListener('input', (e) => {
  const row = e.target.closest('tr[data-index]');
  if (!row || !e.target.classList.contains('cfg-field')) return;
  const idx = Number(row.dataset.index);
  const field = e.target.dataset.field;
  const scenario = configScenarios[idx];
  if (!scenario) return;
  scenario[field] = field === 'enabled' ? e.target.checked : e.target.value;
});
document.getElementById('config-scenarios').addEventListener('change', (e) => {
  if (e.target.dataset.field === 'actionId') {
    const row = e.target.closest('tr[data-index]');
    const idx = row && Number(row.dataset.index);
    if (configScenarios[idx]) configScenarios[idx].actionId = e.target.value;
  }
});
document.getElementById('config-scenarios').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove-scenario]');
  if (!btn) return;
  const idx = Number(btn.dataset.removeScenario);
  configScenarios.splice(idx, 1);
  renderScenariosTable();
});
document.getElementById('config-scenarios').addEventListener('focusin', (e) => {
  if (e.target.classList && e.target.classList.contains('cfg-trigger')) {
    lastFocusedTrigger = e.target;
  }
});
document.getElementById('config-scenarios').addEventListener('dragover', (e) => {
  if (!e.target.classList || !e.target.classList.contains('cfg-trigger')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  e.target.classList.add('drag-over');
});
document.getElementById('config-scenarios').addEventListener('dragleave', (e) => {
  if (e.target.classList && e.target.classList.contains('cfg-trigger')) {
    e.target.classList.remove('drag-over');
  }
});
document.getElementById('config-scenarios').addEventListener('drop', (e) => {
  if (!e.target.classList || !e.target.classList.contains('cfg-trigger')) return;
  e.preventDefault();
  e.target.classList.remove('drag-over');
  const text = e.dataTransfer.getData('text/plain');
  if (!text) return;
  const el = e.target;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  const pos = start + text.length;
  lastFocusedTrigger = el;
  el.focus();
  el.setSelectionRange(pos, pos);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
document.getElementById('add-scenario-row').addEventListener('click', () => {
  configScenarios.push({ id: '', label: '', description: '', trigger: '', actionId: '', enabled: true });
  renderScenariosTable();
});
document.getElementById('save-scenarios').addEventListener('click', async () => {
  const cont = document.getElementById('config-scenarios').parentElement;
  try {
    const r = await fetch('/api/scenarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenarios: configScenarios }) });
    const j = await r.json();
    if (j && j.ok) {
      showConfigSaveMessage(cont, true, 'Saved.');
    } else {
      showConfigSaveMessage(cont, false, 'Save failed: ' + (j && j.error ? j.error : 'unknown error'));
    }
  } catch (err) {
    showConfigSaveMessage(cont, false, 'Save failed: ' + String(err));
  }
});

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
    configActions = (actionsRes.actions || []).map(a => Object.assign({}, a));
    configScenarios = (scenariosRes.scenarios || []).map(s => Object.assign({}, s));
    renderActionsTable();
    renderScenariosTable();
    renderTriggerVariables();
  } catch (err) {
    console.error('fetchAndShowConfig failed', err);
    const el = document.getElementById('config-actions');
    if (el) el.textContent = 'Error loading config';
  }
}

document.getElementById('refresh-screenshots').addEventListener('click', fetchAndShowScreenshots);

document.getElementById('clear-screenshots').addEventListener('click', async () => {
  const msgEl = document.getElementById('clear-screenshots-msg');
  const dateInput = document.getElementById('clear-screenshots-date');
  const setMsg = (ok, text) => {
    if (!msgEl) return;
    msgEl.style.color = ok ? 'var(--green, #2f8f3a)' : '#b91c1c';
    msgEl.textContent = text;
  };
  if (!dateInput || !dateInput.value) {
    setMsg(false, 'Pick a date first.');
    return;
  }
  const beforeMs = new Date(dateInput.value + 'T00:00:00').getTime();
  if (!Number.isFinite(beforeMs)) {
    setMsg(false, 'Invalid date.');
    return;
  }
  if (!window.confirm(`Delete all screenshots older than ${dateInput.value}? This cannot be undone.`)) {
    return;
  }
  try {
    const r = await fetch('/api/screenshots/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beforeMs })
    });
    const j = await r.json();
    if (j && j.ok) {
      setMsg(true, `Deleted ${j.count} screenshot(s).`);
      await fetchAndShowScreenshots();
    } else {
      setMsg(false, 'Failed: ' + (j && j.error ? j.error : 'unknown error'));
    }
  } catch (err) {
    setMsg(false, 'Failed: ' + String(err));
  }
});

// auto-refresh every 5s
refresh();
setInterval(refresh, 5000);
refreshBrowserViewToggle();
// fetch + render weather chart once on load
fetchAndRenderWeather();
// populate force action selector
fetchActions();
