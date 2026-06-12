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
    } else {
      setTextIf('power-dum', 'n/a');
      setTextIf('power-fve', 'n/a');
      setTextIf('power-baterie', 'n/a');
      setTextIf('power-sit', 'n/a');
    }
  } catch (err) {
    console.error(err);
  }
}

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

  if (weatherChart) {
    weatherChart.data.labels = labels;
    weatherChart.data.datasets[0].data = clouds;
    weatherChart.data.datasets[1].data = uvis;
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
      plugins: [pluginNight]
    });
  } catch (err) {
    showChartError('Failed to create Chart: ' + String(err));
    console.error(err);
  }
}

async function fetchAndRenderWeather() {
  try {
    const r = await api('/api/weather');
    if (r && r.ok && r.weather) {
      const payload = r.weather;
      const summary = payload.summary || payload;
      const hourly = payload.hourly || [];
      updateWeatherUIFromSummary(summary);
      updateChartFromHourly(hourly);
    }
  } catch (err) {
    console.error('fetchAndRenderWeather error', err);
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
  await api('/api/force', 'POST');
  await refresh();
});

document.getElementById('refresh').addEventListener('click', refresh);

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

document.getElementById('fetch-weather').addEventListener('click', async () => {
  await fetchAndRenderWeather();
});

// Navigation
function showView(id) {
  ['view-status', 'view-logs', 'view-screenshots'].forEach(v => {
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

document.getElementById('refresh-screenshots').addEventListener('click', fetchAndShowScreenshots);

// auto-refresh every 5s
refresh();
setInterval(refresh, 5000);
refreshBrowserViewToggle();
// fetch + render weather chart once on load
fetchAndRenderWeather();
