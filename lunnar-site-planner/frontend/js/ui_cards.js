/**
 * UI Cards, Live Countdowns, and Scenario Comparator Table
 * Aligned with NASA Artemis / CLPS Mission Feasibility Criteria
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
  if (Array.isArray(simData.assumptions) && simData.assumptions.length > 0) {
    return simData.assumptions;
  }

  const m = simData.metricas_resumo;
  const stepH = Math.round((simData.step_min || 60) / 60);
  const slopeTxt = typeof simData.slope_deg === 'number' ? `${simData.slope_deg}°` : 'N/A';
  const terrainMode = simData.modo_terreno || 'NASA LRO/LOLA Digital Elevation Model';

  const items = [
    `Lunar Ephemerides & Orientation: NASA/JPL SPICE (DE421, MOON_ME_DE421 frame), ${stepH}h integration step.`,
    `360° Horizon & 3D Terrain: ${terrainMode} (Touchdown slope: ${slopeTxt}).`,
    `Apparent Solar Disc: 0.265° semidiameter without atmospheric refraction.`,
    `NASA GO Criteria (Artemis/CLPS): Touchdown slope ≤ 15°, Direct-to-Earth (DTE) ≥ 50%, and Solar illumination ≥ 50% (or ≥ 156h continuous sunlit sortie window).`,
  ];

  if (m) {
    items.push(m.contexto_educacional);
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

  // Atualiza qualquer badge de modelo de terreno no HTML (remove "Modelo Sintético" fixo)
  const terrainBadgeIds = ['terrain-badge', 'model-badge', 'modo-terreno'];
  terrainBadgeIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = simData.modo_terreno || 'NASA LOLA LDEM (Real Data, 240 m/px)';
  });
  document.querySelectorAll('.badge, .chip, small, span').forEach((el) => {
    if (el.children.length === 0 && /Modelo Sint[eé]tico/i.test(el.textContent.trim())) {
      el.textContent = simData.modo_terreno || 'NASA LOLA LDEM (Real Data)';
    }
  });

  const maxSunH =
    simData.max_continuous_sun_hours ??
    simData.metricas_resumo?.maior_janela_continua_sol_horas ??
    0;

  const explainer = document.getElementById('explainer');
  if (explainer) {
    const slopeTxt = typeof simData.slope_deg === 'number' ? `${simData.slope_deg}°` : 'N/A';
    const verdictSub = simData.veredito_backend || simData.go_nogo;

    if (simData.go_nogo === 'GO') {
      explainer.innerHTML = `<strong>${simData.site_name}:</strong> Mission feasible (<strong>GO — ${verdictSub}</strong>)! Touchdown slope is <strong>${slopeTxt}</strong>, the site provides <strong>${simData.sun_fraction_pct}%</strong> solar illumination (up to <strong>${maxSunH}h</strong> continuous sunlight), and Earth DTE link is active for <strong>${simData.earth_fraction_pct}%</strong> of the window.`;
    } else if (simData.go_nogo === 'INCONCLUSIVE') {
      explainer.innerHTML = `<strong>${simData.site_name}:</strong> <strong>INCONCLUSIVE</strong> (Outside -80°S LOLA high-resolution DEM coverage; local touchdown slope unavailable). Solar illumination: <strong>${simData.sun_fraction_pct}%</strong>, Earth DTE: <strong>${simData.earth_fraction_pct}%</strong>.`;
    } else {
      explainer.innerHTML = `<strong>${simData.site_name}:</strong> Mission constraints not met (<strong>NO-GO — ${verdictSub}</strong>). Check touchdown slope (<strong>${slopeTxt}</strong>, max 15°), Earth DTE visibility (<strong>${simData.earth_fraction_pct}%</strong>, min 50%), or extended shadow periods (<strong>${simData.max_continuous_night_hours}h</strong> max continuous night).`;
    }
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
  const isWindowGo = simData.go_nogo === 'GO';
  const isInconclusive = simData.go_nogo === 'INCONCLUSIVE';

  // O Card de Veredito mostra o resultado oficial da janela da missão (GO / NO-GO / INCONCLUSIVE)
  const cardVerdict = document.getElementById('card-verdict');
  if (cardVerdict) {
    cardVerdict.dataset.state = isWindowGo ? 'go' : 'nogo';
    cardVerdict.style.borderColor = isWindowGo ? '#10b981' : isInconclusive ? '#f59e0b' : '#ef4444';
  }

  const verdictText = document.getElementById('verdict-text');
  if (verdictText) {
    verdictText.textContent = isWindowGo ? 'GO ✔' : isInconclusive ? 'INCONCLUSIVE ⚠' : 'NO-GO ✖';
    verdictText.style.color = isWindowGo ? '#34d399' : isInconclusive ? '#fbbf24' : '#f87171';
  }

  const verdictSub = document.getElementById('verdict-sub');
  if (verdictSub && simData.veredito_backend) {
    verdictSub.textContent = simData.veredito_backend;
  }

  const slopeKnown = typeof simData.slope_deg === 'number';
  const slopeOk = Boolean(simData.criterios?.seguranca_topografica ?? (slopeKnown && simData.slope_deg <= 15.0));
  const sunWindowOk = Boolean(simData.criterios?.iluminacao_solar ?? (simData.sun_fraction_pct >= 50.0));
  const commWindowOk = Boolean(simData.criterios?.comunicacao_direta ?? (simData.earth_fraction_pct >= 50.0));
  const maxSunH =
    simData.max_continuous_sun_hours ??
    simData.metricas_resumo?.maior_janela_continua_sol_horas ??
    0;

  const checksList = document.getElementById('verdict-checks');
  if (checksList) {
    checksList.innerHTML = `
      <li>${slopeKnown ? (slopeOk ? '✅' : '❌') : '⚠️'} Touchdown Slope: <strong>${slopeKnown ? simData.slope_deg + '°' : 'N/A'}</strong> (max 15°)</li>
      <li>${sunWindowOk ? '✅' : '❌'} Solar Window: <strong>${simData.sun_fraction_pct}%</strong> / <strong>${maxSunH}h</strong> max (${frame.sun_visible ? 'Now: Sun ✔' : 'Now: Shadow'})</li>
      <li>${commWindowOk ? '✅' : '❌'} Earth DTE: <strong>${simData.earth_fraction_pct}%</strong> (${frame.earth_visible ? 'Now: Active ✔' : 'Now: Occulted'})</li>
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
        <td><strong style="color:${item.go_nogo === 'GO' ? '#34d399' : item.go_nogo === 'INCONCLUSIVE' ? '#fbbf24' : '#f87171'}">${item.go_nogo}</strong></td>
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