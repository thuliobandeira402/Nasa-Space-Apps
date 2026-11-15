/**
 * UI Cards, Live Countdowns, and Scenario Comparator Table
 */

import { renderComparisonChart } from './charts.js';

const uiState = {
  simData: null,
  currentStepIdx: 0,
  anchorWallMs: Date.now(),
  comparedList: [],
  timerId: null,
};

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function formatCountdown(ms) {
  if (ms === null || ms === undefined || ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return days > 0 ? `${days}d ${pad(hours)}h ${pad(mins)}m` : `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

function findNextTransitionMs(timeline, fromIdx, selector) {
  if (!timeline || timeline.length < 2) return null;
  const currentState = Boolean(selector(timeline[fromIdx]));

  for (let i = fromIdx + 1; i < timeline.length; i++) {
    const state = Boolean(selector(timeline[i]));
    if (state !== currentState) {
      return {
        targetMs: new Date(timeline[i].timestamp).getTime(),
        willBeVisible: state,
      };
    }
  }
  return null;
}

function buildEnglishAssumptions(simData) {
  const m = simData.metricas_resumo;
  const stepH = Math.round((simData.step_min || 60) / 60);
  const slopeTxt = typeof simData.slope_deg === 'number' ? `${simData.slope_deg}°` : 'N/A';

  const items = [
    `Lunar Ephemerides & Orientation: NASA/JPL SPICE (DE421, MOON_ME_DE421 frame), ${stepH}h integration step.`,
    `360° Horizon & 3D Terrain: NASA LRO/LOLA Digital Elevation Model (Local slope: ${slopeTxt}).`,
    `Apparent Solar Disc: 0.265° semidiameter without atmospheric refraction.`,
    `GO Criteria: Solar illumination ≥ 50%, Direct-to-Earth (DTE) visibility ≥ 50%, and terrain slope ≤ 15°.`,
  ];

  if (m) {
    items.push(
      `Engineering Summary: Accounting for local terrain, the Sun illuminates the site for ${m.iluminacao_solar_pct}% of the window (topographic shadow loss: ${m.perda_sombra_topografica_pct}%). Max solar elevation is ${m.elevacao_max_sol_graus}°, yielding ${m.potencia_media_painel_vertical_pct}% average efficiency on vertical solar arrays vs. ${m.potencia_media_painel_horizontal_pct}% on horizontal panels. Round-trip Earth signal latency: ${m.latencia_ida_volta_seg}s.`
    );
  }
  return items;
}

export function updateSimulationUI(simData, source = 'online') {
  uiState.simData = simData;
  uiState.currentStepIdx = 0;
  uiState.anchorWallMs = Date.now();

  if (!simData) return;

  setText('m-sun-frac', `${simData.sun_fraction_pct}%`);
  setText('m-earth-frac', `${simData.earth_fraction_pct}%`);
  setText('m-dark', `${simData.max_continuous_night_hours} h`);

  const explainer = document.getElementById('explainer');
  if (explainer) {
    const slopeTxt = typeof simData.slope_deg === 'number' ? `${simData.slope_deg}°` : 'N/A';
    explainer.innerHTML =
      simData.go_nogo === 'GO'
        ? `<strong>${simData.site_name}:</strong> Favorable landing site (<strong>GO</strong>)! The Sun illuminates the surface for <strong>${simData.sun_fraction_pct}%</strong> of the mission window and Earth remains visible for <strong>${simData.earth_fraction_pct}%</strong>.`
        : `<strong>${simData.site_name}:</strong> Mission constraints not met (<strong>NO-GO</strong>). Check terrain slope (${slopeTxt}) or extended shadow periods (${simData.max_continuous_night_hours}h max continuous night).`;
  }

  const assumptionsList = document.getElementById('assumptions');
  if (assumptionsList) {
    const list = buildEnglishAssumptions(simData);
    assumptionsList.innerHTML = list.map((item) => `<li>${item}</li>`).join('');
  }

  syncStepMetrics(0);
  startLiveCountdownTimer();
}

export function syncStepMetrics(stepIndex = 0) {
  const simData = uiState.simData;
  if (!simData || !Array.isArray(simData.timeline) || simData.timeline.length === 0) return;

  const safeIdx = Math.min(Math.max(0, stepIndex), simData.timeline.length - 1);
  uiState.currentStepIdx = safeIdx;
  uiState.anchorWallMs = Date.now();

  const frame = simData.timeline[safeIdx];
  const slopeKnown = typeof simData.slope_deg === 'number';
  const slopeOk = !slopeKnown || simData.slope_deg <= 15.0;
  const sunOk = frame.sun_visible;
  const commOk = frame.earth_visible;
  const instantGo = slopeOk && sunOk && commOk;

  const cardVerdict = document.getElementById('card-verdict');
  if (cardVerdict) {
    cardVerdict.dataset.state = instantGo ? 'go' : 'nogo';
    cardVerdict.style.borderColor = instantGo ? '#10b981' : '#ef4444';
  }

  const verdictText = document.getElementById('verdict-text');
  if (verdictText) {
    verdictText.textContent = instantGo ? 'GO ✔' : 'NO-GO ✖';
    verdictText.style.color = instantGo ? '#34d399' : '#f87171';
  }

  const checksList = document.getElementById('verdict-checks');
  if (checksList) {
    checksList.innerHTML = `
      <li>${slopeKnown ? (slopeOk ? '✅' : '❌') : '➖'} Terrain Slope: <strong>${slopeKnown ? simData.slope_deg + '°' : 'N/A'}</strong> (max 15°)</li>
      <li>${sunOk ? '✅' : '❌'} Sun Elevation Now: <strong>${frame.sun_elevation_deg}°</strong></li>
      <li>${commOk ? '✅' : '❌'} Earth Signal (DTE): <strong>${frame.earth_elevation_deg}°</strong></li>
    `;
  }

  refreshCountdownsOnly();
}

function refreshCountdownsOnly() {
  const simData = uiState.simData;
  if (!simData?.timeline) return;

  const idx = uiState.currentStepIdx;
  const timeline = simData.timeline;
  const baseSimMs = new Date(timeline[idx].timestamp).getTime();
  const elapsedRealMs = Date.now() - uiState.anchorWallMs;
  const currentSimMs = baseSimMs + elapsedRealMs;

  const nextSun = findNextTransitionMs(timeline, idx, (pt) => pt.sun_visible);
  if (nextSun) {
    const remaining = nextSun.targetMs - currentSimMs;
    const label = nextSun.willBeVisible ? 'Sunrise in' : 'Sunset in';
    setText('m-sun-next', `${label}: ${formatCountdown(remaining)}`);
  } else {
    setText('m-sun-next', timeline[idx].sun_visible ? 'Continuous sunlight in window' : 'Continuous shadow in window');
  }

  const nextEarth = findNextTransitionMs(timeline, idx, (pt) => pt.earth_visible);
  if (nextEarth) {
    const remaining = nextEarth.targetMs - currentSimMs;
    const label = nextEarth.willBeVisible ? 'Earthrise in' : 'Earthset in';
    setText('m-earth-next', `${label}: ${formatCountdown(remaining)}`);
  } else {
    setText('m-earth-next', timeline[idx].earth_visible ? 'Continuous Earth DTE link' : 'No direct Earth link in window');
  }
}

function startLiveCountdownTimer() {
  if (uiState.timerId) clearInterval(uiState.timerId);
  uiState.timerId = window.setInterval(refreshCountdownsOnly, 1000);
}

export function getComparedScenarios() {
  return uiState.comparedList;
}

export function addScenarioToComparator(simData) {
  if (!simData) return;
  uiState.comparedList.push(simData);
  renderComparatorTable();
}

export function clearComparator() {
  uiState.comparedList = [];
  renderComparatorTable();
}

function renderComparatorTable() {
  const emptyMsg = document.getElementById('comp-empty');
  const table = document.getElementById('comp-table');
  const tbody = table?.querySelector('tbody');
  if (!table || !tbody || !emptyMsg) return;

  if (uiState.comparedList.length === 0) {
    emptyMsg.hidden = false;
    table.hidden = true;
    renderComparisonChart([]);
    return;
  }

  emptyMsg.hidden = true;
  table.hidden = false;

  tbody.innerHTML = uiState.comparedList
    .map(
      (item, index) => `
      <tr>
        <td><strong>${item.site_name}</strong><br><small>${item.start_date} (${item.days}d)</small></td>
        <td><strong style="color:${item.go_nogo === 'GO' ? '#34d399' : '#f87171'}">${item.go_nogo}</strong></td>
        <td>${item.sun_fraction_pct}%</td>
        <td>${item.earth_fraction_pct}%</td>
        <td class="only-engineer">${item.max_continuous_night_hours} h</td>
        <td><button type="button" class="btn small" data-remove-idx="${index}" aria-label="Remove scenario">✕</button></td>
      </tr>
    `
    )
    .join('');

  tbody.querySelectorAll('[data-remove-idx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.removeIdx);
      uiState.comparedList.splice(idx, 1);
      renderComparatorTable();
    });
  });

  renderComparisonChart(uiState.comparedList);
}