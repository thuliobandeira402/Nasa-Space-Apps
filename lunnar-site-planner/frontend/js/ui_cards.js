/**
 * Cards de KPI, Contagens Regressivas e Tabela Comparadora de Cenários
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

export function updateSimulationUI(simData, source = 'online') {
  uiState.simData = simData;
  uiState.currentStepIdx = 0;
  uiState.anchorWallMs = Date.now();

  if (!simData) return;

  const isGo = simData.go_nogo === 'GO';
  const m = simData.metricas_resumo;

  // 1. Card Principal: Decisão Global da Missão (GO / NO-GO)
  const cardVerdict = document.getElementById('card-verdict');
  if (cardVerdict) {
    cardVerdict.dataset.state = isGo ? 'GO' : 'NO-GO';
  }
  setText('verdict-text', isGo ? 'GO ✔' : 'NO-GO ✖');
  setText('verdict-sub', simData.veredito_backend || (isGo ? 'Critérios atendidos' : 'Restrições críticas'));

  // 2. Card Luz Solar + Eficiência de Painéis
  setText('m-sun-frac', `${simData.sun_fraction_pct}%`);
  if (m) {
    setText(
      'm-sun-power',
      `Painel vert.: ${m.potencia_media_painel_vertical_pct}% · horiz.: ${m.potencia_media_painel_horizontal_pct}%`
    );
  } else {
    setText('m-sun-power', '');
  }

  // 3. Card Terra Visível + Latência
  setText('m-earth-frac', `${simData.earth_fraction_pct}%`);
  if (m && typeof m.latencia_ida_volta_seg === 'number') {
    setText('m-earth-lat', `Latência ida/volta: ${m.latencia_ida_volta_seg}s (DTE)`);
  } else {
    setText('m-earth-lat', '');
  }

  // 4. Card Noite Contínua + Perda Topográfica
  setText('m-dark', `${simData.max_continuous_night_hours} h`);
  if (m && typeof m.perda_sombra_topografica_pct === 'number') {
    setText('m-dark-sub', `Perda por relevo: -${m.perda_sombra_topografica_pct}% da luz teórica`);
  }

  // 5. Resumo no Modo Explorador
  const explainer = document.getElementById('explainer');
  if (explainer) {
    const slopeTxt = typeof simData.slope_deg === 'number' ? `${simData.slope_deg}°` : 'N/D';
    explainer.innerHTML = isGo
      ? `<strong>${simData.site_name}:</strong> Local favorável para pouso (<strong>GO</strong>)! O Sol ilumina a superfície durante <strong>${simData.sun_fraction_pct}%</strong> da missão e a Terra fica visível em <strong>${simData.earth_fraction_pct}%</strong> do período.`
      : `<strong>${simData.site_name}:</strong> Restrições de missão não atendidas (<strong>NO-GO</strong> — ${simData.veredito_backend || 'atenção'}). Verifique a declividade (${slopeTxt}) ou períodos longos de sombra (${simData.max_continuous_night_hours}h seguidas sem Sol).`;
  }

  // 6. Premissas do Backend
  const assumptionsList = document.getElementById('assumptions');
  if (assumptionsList) {
    const list = Array.isArray(simData.assumptions) && simData.assumptions.length > 0
      ? simData.assumptions
      : ['Cálculo via NASA/JPL SPICE DE421 e topografia LOLA.'];
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
  const crit = simData.criterios || {};
  const slopeKnown = typeof simData.slope_deg === 'number';
  const slopeOk = crit.seguranca_topografica !== false;
  const sunMissionOk = crit.iluminacao_solar ?? simData.sun_fraction_pct >= 50;
  const commMissionOk = crit.comunicacao_direta ?? simData.earth_fraction_pct >= 50;

  const checksList = document.getElementById('verdict-checks');
  if (checksList) {
    checksList.innerHTML = `
      <li class="${slopeOk ? 'ok' : 'bad'}">Declividade: <strong>${slopeKnown ? simData.slope_deg + '°' : 'N/D'}</strong> (máx. 15°)</li>
      <li class="${sunMissionOk ? 'ok' : 'bad'}">Luz na janela: <strong>${simData.sun_fraction_pct}%</strong> (agora: ${frame.sun_visible ? 'Sol ✔' : 'Sombra ✖'})</li>
      <li class="${commMissionOk ? 'ok' : 'bad'}">Sinal Terra: <strong>${simData.earth_fraction_pct}%</strong> (agora: ${frame.earth_visible ? 'Ativo ✔' : 'Oculto ✖'})</li>
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
    const label = nextSun.willBeVisible ? 'Nascer do Sol em' : 'Pôr do Sol em';
    setText('m-sun-next', `${label}: ${formatCountdown(remaining)}`);
  } else {
    setText(
      'm-sun-next',
      timeline[idx].sun_visible ? 'Iluminação contínua na janela' : 'Sombra contínua na janela'
    );
  }

  const nextEarth = findNextTransitionMs(timeline, idx, (pt) => pt.earth_visible);
  if (nextEarth) {
    const remaining = nextEarth.targetMs - currentSimMs;
    const label = nextEarth.willBeVisible ? 'Retorno da Terra em' : 'Ocultamento da Terra em';
    setText('m-earth-next', `${label}: ${formatCountdown(remaining)}`);
  } else {
    setText(
      'm-earth-next',
      timeline[idx].earth_visible ? 'Visada direta contínua com a Terra' : 'Sem visada direta na janela'
    );
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
    renderComparisonChart([], 'chart-compare');
    return;
  }

  emptyMsg.hidden = true;
  table.hidden = false;

  tbody.innerHTML = uiState.comparedList
    .map(
      (item, index) => `
      <tr>
        <td><strong>${item.site_name}</strong><br><small>${item.start_date} (${item.days}d)</small></td>
        <td><span class="tag ${item.go_nogo}">${item.go_nogo}</span></td>
        <td>${item.sun_fraction_pct}%</td>
        <td>${item.earth_fraction_pct}%</td>
        <td class="only-engineer">${item.max_continuous_night_hours} h</td>
        <td><button type="button" class="x" data-remove-idx="${index}" aria-label="Remover cenário">✕</button></td>
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

  renderComparisonChart(uiState.comparedList, 'chart-compare');
}