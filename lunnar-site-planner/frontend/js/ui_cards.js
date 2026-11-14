/**
 * Módulo de UI Cards, Countdowns em Tempo Real e Tabela Comparadora
 * Alinhado aos IDs originais do index.html
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

/**
 * Encontra o timestamp da próxima transição (Sunset/Sunrise ou Earthset/Earthrise)
 * a partir do passo atual.
 */
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

/**
 * Atualiza todos os cards de KPI, critérios GO/NO-GO e premissas do HTML.
 */
export function updateSimulationUI(simData, source = 'online') {
  uiState.simData = simData;
  uiState.currentStepIdx = 0;
  uiState.anchorWallMs = Date.now();

  if (!simData) return;

  // 1. Frações globais e maior noite contínua
  setText('m-sun-frac', `${simData.sun_fraction_pct}%`);
  setText('m-earth-frac', `${simData.earth_fraction_pct}%`);
  setText('m-dark', `${simData.max_continuous_night_hours} h`);

  // 2. Explicação amigável para o Modo Explorador (#explainer)
  const explainer = document.getElementById('explainer');
  if (explainer) {
    explainer.innerHTML =
      simData.go_nogo === 'GO'
        ? `<strong>${simData.site_name}:</strong> Local favorável (<strong>GO</strong>)! O Sol ilumina o terreno por <strong>${simData.sun_fraction_pct}%</strong> do período e a Terra fica visível por <strong>${simData.earth_fraction_pct}%</strong>.`
        : `<strong>${simData.site_name}:</strong> Atenção (<strong>NO-GO</strong>). Verifique a declividade (${simData.slope_deg}°) ou períodos longos de sombra (${simData.max_continuous_night_hours}h).`;
  }

  // 3. Lista de premissas técnicas (#assumptions)
  const assumptionsList = document.getElementById('assumptions');
  if (assumptionsList && Array.isArray(simData.assumptions)) {
    assumptionsList.innerHTML = simData.assumptions.map((item) => `<li>${item}</li>`).join('');
  }

  // 4. Status na barra lateral (#status)
  setText(
    'status',
    source === 'online'
      ? `Simulação concluída via FastAPI (${simData.site_name}).`
      : `Simulação concluída em modo offline (${simData.site_name}).`
  );

  // 5. Atualiza estado instantâneo (GO/NO-GO + Countdowns)
  syncStepMetrics(0);
  startLiveCountdownTimer();
}

/**
 * Atualiza o card de veredito GO/NO-GO e os textos de próximo Sunset/Earthset
 * conforme o índice selecionado no Slider de Tempo ou clique no gráfico.
 */
export function syncStepMetrics(stepIndex = 0) {
  const simData = uiState.simData;
  if (!simData || !Array.isArray(simData.timeline) || simData.timeline.length === 0) return;

  const safeIdx = Math.min(Math.max(0, stepIndex), simData.timeline.length - 1);
  uiState.currentStepIdx = safeIdx;
  uiState.anchorWallMs = Date.now();

  const frame = simData.timeline[safeIdx];
  const slopeOk = simData.slope_deg <= 15.0;
  const sunOk = frame.sun_visible;
  const commOk = frame.earth_visible;
  const instantGo = slopeOk && sunOk && commOk;

  // Card de Veredito (#card-verdict, #verdict-text, #verdict-checks)
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
      <li>${slopeOk ? '✅' : '❌'} Topografia (Slope): <strong>${simData.slope_deg}°</strong> (máx. 15°)</li>
      <li>${sunOk ? '✅' : '❌'} Sol agora: <strong>${frame.sun_elevation_deg}°</strong> (Pôr do sol: ${simData.sunset_duration_min} min)</li>
      <li>${commOk ? '✅' : '❌'} Sinal Terra (DTE): <strong>${frame.earth_elevation_deg}°</strong></li>
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

  // Countdown Sunset / Sunrise (#m-sun-next)
  const nextSun = findNextTransitionMs(timeline, idx, (pt) => pt.sun_visible);
  if (nextSun) {
    const remaining = nextSun.targetMs - currentSimMs;
    const label = nextSun.willBeVisible ? 'Sunrise em' : 'Sunset em';
    setText('m-sun-next', `${label}: ${formatCountdown(remaining)}`);
  } else {
    setText('m-sun-next', timeline[idx].sun_visible ? 'Iluminação contínua na janela' : 'Sombra contínua na janela');
  }

  // Countdown Earthset / Earthrise (#m-earth-next)
  const nextEarth = findNextTransitionMs(timeline, idx, (pt) => pt.earth_visible);
  if (nextEarth) {
    const remaining = nextEarth.targetMs - currentSimMs;
    const label = nextEarth.willBeVisible ? 'Earthrise em' : 'Earthset em';
    setText('m-earth-next', `${label}: ${formatCountdown(remaining)}`);
  } else {
    setText('m-earth-next', timeline[idx].earth_visible ? 'Visada Terra contínua' : 'Sem visada Terra na janela');
  }
}

function startLiveCountdownTimer() {
  if (uiState.timerId) clearInterval(uiState.timerId);
  uiState.timerId = window.setInterval(refreshCountdownsOnly, 1000);
}

// ============================================================================
// GERENCIAMENTO DA TABELA COMPARADORA (#comp-table)
// ============================================================================

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
        <td><button type="button" class="btn small" data-remove-idx="${index}" aria-label="Remover cenário">✕</button></td>
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