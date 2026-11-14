/**
 * Módulo de Cards de KPI e Alertas em Tempo Real
 * Projeto: Lunar South Pole Lighting & Communication Tool
 * Stack: Vanilla JS (ES6+), DOM API, Tailwind CSS
 */

// ============================================================================
// 1. BARRAMENTO DE EVENTOS DE ESTADO (STATE EVENT BUS)
// ============================================================================

const stateBus = new EventTarget();

const kpiStore = {
  simulationData: null,
  meta: { source: 'online', siteName: '' },
  anchorSimMs: null,     // Timestamp base da simulação
  anchorWallMs: null,    // Timestamp local no momento em que o cenário carregou
  customCursorMs: null,  // Usado se o usuário clicar em um ponto específico da timeline
  timerId: null,
};

/**
 * Publica uma nova atualização de estado da simulação para todos os cards inscritos.
 */
export function publishSimulationState(simulationData, meta = {}) {
  const timeline = simulationData?.timeline || [];
  const firstPointMs = timeline.length > 0 ? new Date(timeline[0].timestamp).getTime() : Date.now();
  const lastPointMs =
    timeline.length > 0 ? new Date(timeline[timeline.length - 1].timestamp).getTime() : firstPointMs;

  const now = Date.now();
  // Se o relógio real estiver dentro do intervalo simulado, usa tempo real;
  // caso contrário (ex.: simulação de data futura), ancora no início da missão e avança 1s/s.
  const isNowInsideWindow = now >= firstPointMs && now <= lastPointMs;

  kpiStore.simulationData = simulationData;
  kpiStore.meta = { ...kpiStore.meta, ...meta };
  kpiStore.anchorSimMs = isNowInsideWindow ? now : firstPointMs;
  kpiStore.anchorWallMs = now;
  kpiStore.customCursorMs = meta.cursorTimestamp ? new Date(meta.cursorTimestamp).getTime() : null;

  stateBus.dispatchEvent(
    new CustomEvent('lunar:state-updated', {
      detail: { simulationData, meta: kpiStore.meta },
    })
  );
}

/**
 * Permite sincronizar os cards com um ponto específico clicado no gráfico Plotly.
 */
export function setTimelineCursor(timestampIso) {
  if (!kpiStore.simulationData) return;
  kpiStore.customCursorMs = timestampIso ? new Date(timestampIso).getTime() : null;
  kpiStore.anchorWallMs = Date.now();
  if (kpiStore.customCursorMs) {
    kpiStore.anchorSimMs = kpiStore.customCursorMs;
  }
  refreshRealtimeMetrics();
}

/**
 * Inscreve listeners externos em mudanças de estado dos KPIs.
 */
export function onKpiStateUpdated(handler) {
  stateBus.addEventListener('lunar:state-updated', handler);
  return () => stateBus.removeEventListener('lunar:state-updated', handler);
}

// ============================================================================
// 2. CÁLCULOS ASTRONÔMICOS E INTERPOLAÇÃO DE TRANSIÇÕES (SUNSET / EARTHSET)
// ============================================================================

function getCurrentSimTimestampMs() {
  if (!kpiStore.anchorSimMs) return Date.now();
  const elapsedWallMs = Date.now() - kpiStore.anchorWallMs;
  return kpiStore.anchorSimMs + elapsedWallMs;
}

/**
 * Encontra o estado interpolado no instante `targetMs` e localiza a próxima
 * transição de horizonte (Sunset/Sunrise e Earthset/Earthrise).
 */
function computeInstantMetrics(timeline, targetMs) {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return null;
  }

  // Localiza o índice atual na série temporal
  let currentIdx = 0;
  for (let i = 0; i < timeline.length - 1; i++) {
    const t0 = new Date(timeline[i].timestamp).getTime();
    const t1 = new Date(timeline[i + 1].timestamp).getTime();
    if (targetMs >= t0 && targetMs <= t1) {
      currentIdx = i;
      break;
    }
    if (targetMs > t1) currentIdx = i + 1;
  }

  const p0 = timeline[currentIdx];
  const p1 = timeline[Math.min(currentIdx + 1, timeline.length - 1)];
  const t0 = new Date(p0.timestamp).getTime();
  const t1 = new Date(p1.timestamp).getTime();
  const ratio = t1 > t0 ? Math.min(1, Math.max(0, (targetMs - t0) / (t1 - t0))) : 0;

  // Interpolação linear suave entre os dois passos da API
  const sunElev = p0.sun_elevation_deg + (p1.sun_elevation_deg - p0.sun_elevation_deg) * ratio;
  const earthElev = p0.earth_elevation_deg + (p1.earth_elevation_deg - p0.earth_elevation_deg) * ratio;
  const terrainMask = p0.terrain_mask_deg ?? 0;

  const isSunLit = sunElev > terrainMask;
  const isEarthVisible = earthElev > 0;
  const sunTrend = p1.sun_elevation_deg >= p0.sun_elevation_deg ? 'rising' : 'setting';
  const earthTrend = p1.earth_elevation_deg >= p0.earth_elevation_deg ? 'rising' : 'setting';

  // Busca próxima transição solar (Sunset se iluminado; Sunrise se na sombra)
  const nextSolarEvent = findNextCrossing(
    timeline,
    currentIdx,
    targetMs,
    (pt) => pt.sun_elevation_deg - (pt.terrain_mask_deg ?? 0),
    isSunLit
  );

  // Busca próxima transição de comunicação Terra (Earthset se visível; Earthrise se oculta)
  const nextEarthEvent = findNextCrossing(
    timeline,
    currentIdx,
    targetMs,
    (pt) => pt.earth_elevation_deg,
    isEarthVisible
  );

  return {
    targetMs,
    sunElev: Number(sunElev.toFixed(2)),
    earthElev: Number(earthElev.toFixed(2)),
    terrainMask: Number(terrainMask.toFixed(2)),
    isSunLit,
    isEarthVisible,
    isOperationalOverlap: isSunLit && isEarthVisible,
    sunTrend,
    earthTrend,
    nextSolarEvent, // { type: 'Sunset' | 'Sunrise', msRemaining, eventTimestamp }
    nextEarthEvent, // { type: 'Earthset' | 'Earthrise', msRemaining, eventTimestamp }
  };
}

/**
 * Interpola o exato milissegundo em que uma curva cruza o limiar 0 (horizonte/relevo).
 */
function findNextCrossing(timeline, startIdx, nowMs, valueSelector, currentlyAbove) {
  for (let i = startIdx; i < timeline.length - 1; i++) {
    const a = timeline[i];
    const b = timeline[i + 1];
    const va = valueSelector(a);
    const vb = valueSelector(b);

    const crossesDown = currentlyAbove && va > 0 && vb <= 0;
    const crossesUp = !currentlyAbove && va <= 0 && vb > 0;

    if (crossesDown || crossesUp) {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      const fraction = Math.abs(va - vb) > 1e-6 ? Math.abs(va) / Math.abs(va - vb) : 0;
      const crossingMs = ta + fraction * (tb - ta);

      if (crossingMs >= nowMs) {
        return {
          crossingMs,
          msRemaining: crossingMs - nowMs,
          isSetting: crossesDown,
        };
      }
    }
  }
  return null;
}

function formatCountdown(ms) {
  if (ms === null || ms === undefined || ms < 0) return '--:--:--';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const pad = (n) => String(n).padStart(2, '0');
  return days > 0
    ? `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`
    : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// ============================================================================
// 3. ATUALIZAÇÃO DO DOM (TAILWIND CSS + DOM API)
// ============================================================================

function setText(id, value) {
  const el = document.getElementById(id);
  if (el && el.textContent !== String(value)) {
    el.textContent = String(value);
  }
}

function renderAlertsBanner(metrics, meta) {
  const container = document.getElementById('kpi-alerts-container');
  const titleEl = document.getElementById('kpi-alert-title');
  const descEl = document.getElementById('kpi-alert-desc');
  const badgeEl = document.getElementById('kpi-alert-badge');
  if (!container || !titleEl || !descEl || !badgeEl) return;

  const sixHoursMs = 6 * 3600 * 1000;
  const sunsetImminent =
    metrics.isSunLit &&
    metrics.nextSolarEvent &&
    metrics.nextSolarEvent.msRemaining <= sixHoursMs;

  const earthsetImminent =
    metrics.isEarthVisible &&
    metrics.nextEarthEvent &&
    metrics.nextEarthEvent.msRemaining <= sixHoursMs;

  // Reseta classes de estado do card de alerta
  container.className =
    'rounded-xl border p-4 transition-all duration-300 flex flex-col justify-between';

  if (!metrics.isSunLit && !metrics.isEarthVisible) {
    container.classList.add('border-red-500/70', 'bg-red-950/40', 'text-red-100');
    badgeEl.className =
      'px-2 py-0.5 text-xs font-semibold rounded-full bg-red-500/20 text-red-300 border border-red-500/40 animate-pulse';
    badgeEl.textContent = 'CRÍTICO • BLACKOUT';
    titleEl.textContent = 'Noite Lunar & Sem Link DTE';
    descEl.textContent =
      'Operação em modo de sobrevivência por baterias. Sem visada direta com a Terra.';
  } else if (sunsetImminent || earthsetImminent) {
    container.classList.add('border-amber-500/70', 'bg-amber-950/35', 'text-amber-100');
    badgeEl.className =
      'px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse';
    badgeEl.textContent = 'ATENÇÃO • TRANSIÇÃO < 6H';
    titleEl.textContent = sunsetImminent
      ? 'Sunset / Ocultação por Relevo Iminente'
      : 'Perda de Visada Terra (Earthset) Iminente';
    descEl.textContent = sunsetImminent
      ? 'Preparar sistemas térmicos e comutar carga para banco de baterias.'
      : 'Concluir telemetria crítica antes do bloqueio da linha de visada DTE.';
  } else if (metrics.isOperationalOverlap) {
    container.classList.add('border-emerald-500/60', 'bg-emerald-950/30', 'text-emerald-100');
    badgeEl.className =
      'px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
    badgeEl.textContent = 'NOMINAL • JANELA ÓTIMA';
    titleEl.textContent = 'Energia Solar & Comunicação Ativas';
    descEl.textContent =
      meta.source && meta.source !== 'online'
        ? 'Condições nominais (Simulação rodando em modo Offline Mock).'
        : 'Geração fotovoltaica plena e enlace direto Terra-Lua estável.';
  } else {
    container.classList.add('border-sky-500/50', 'bg-slate-900/80', 'text-slate-100');
    badgeEl.className =
      'px-2 py-0.5 text-xs font-semibold rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/40';
    badgeEl.textContent = 'OPERAÇÃO PARCIAL';
    titleEl.textContent = metrics.isSunLit
      ? 'Iluminado (Aguardando Earthrise)'
      : 'Link DTE Ativo (Operação em Bateria)';
    descEl.textContent = metrics.isSunLit
      ? 'Geração solar ativa, mas sem linha de visada direta com a Terra.'
      : 'Comunicação disponível; monitorar estado de carga térmica e elétrica.';
  }
}

function refreshRealtimeMetrics() {
  const data = kpiStore.simulationData;
  if (!data || !data.timeline) return;

  const nowSimMs = getCurrentSimTimestampMs();
  const metrics = computeInstantMetrics(data.timeline, nowSimMs);
  if (!metrics) return;

  const summary = data.summary || {};

  // --- CARD 1: Elevação Solar & Iluminação ---
  setText('kpi-sun-elevation', `${metrics.sunElev >= 0 ? '+' : ''}${metrics.sunElev.toFixed(2)}°`);
  setText(
    'kpi-sun-trend',
    `${metrics.sunTrend === 'rising' ? '↑ Ascendente' : '↓ Descendente'} • Relevo: ${metrics.terrainMask.toFixed(1)}°`
  );
  setText('kpi-sun-pct', `${summary.illumination_pct ?? 0}% do período`);

  const sunBar = document.getElementById('kpi-sun-progress');
  if (sunBar) {
    sunBar.style.width = `${Math.min(100, Math.max(0, summary.illumination_pct ?? 0))}%`;
  }

  const sunBadge = document.getElementById('kpi-sun-status');
  if (sunBadge) {
    sunBadge.textContent = metrics.isSunLit ? 'ILUMINADO' : 'SOMBRA / ECLIPSE';
    sunBadge.className = metrics.isSunLit
      ? 'px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40'
      : 'px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-700/70 text-slate-300 border border-slate-600';
  }

  // --- CARD 2: Countdown Sunset / Sunrise ---
  if (metrics.nextSolarEvent) {
    const label = metrics.nextSolarEvent.isSetting ? 'Próximo Sunset (Relevo)' : 'Próximo Sunrise';
    setText('kpi-sunset-label', label);
    setText('kpi-sunset-countdown', formatCountdown(metrics.nextSolarEvent.msRemaining));
    setText(
      'kpi-sunset-utc',
      `UTC: ${new Date(metrics.nextSolarEvent.crossingMs).toISOString().replace('T', ' ').slice(0, 16)}Z`
    );
  } else {
    setText('kpi-sunset-label', metrics.isSunLit ? 'Iluminação Contínua' : 'Sombra Contínua');
    setText('kpi-sunset-countdown', metrics.isSunLit ? '30d+ Luz' : '30d+ Sombra');
    setText('kpi-sunset-utc', 'Sem cruzamento de horizonte na janela');
  }

  // --- CARD 3: Janelas de Comunicação DTE & Earthset ---
  setText('kpi-earth-elevation', `${metrics.earthElev >= 0 ? '+' : ''}${metrics.earthElev.toFixed(2)}°`);
  setText('kpi-comm-pct', `${summary.comm_availability_pct ?? 0}% visada`);
  setText('kpi-overlap-hours', `${summary.simultaneous_window_hours ?? 0}h simultâneas (Sol + Terra)`);

  const earthBadge = document.getElementById('kpi-earth-status');
  if (earthBadge) {
    earthBadge.textContent = metrics.isEarthVisible ? 'DTE ONLINE' : 'SEM VISADA';
    earthBadge.className = metrics.isEarthVisible
      ? 'px-2 py-0.5 text-xs font-semibold rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/40'
      : 'px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-700/70 text-slate-300 border border-slate-600';
  }

  if (metrics.nextEarthEvent) {
    const earthEvLabel = metrics.nextEarthEvent.isSetting ? 'Earthset em:' : 'Earthrise em:';
    setText('kpi-earthset-label', earthEvLabel);
    setText('kpi-earthset-countdown', formatCountdown(metrics.nextEarthEvent.msRemaining));
  } else {
    setText('kpi-earthset-label', 'Link Terra:');
    setText('kpi-earthset-countdown', metrics.isEarthVisible ? 'Visada Contínua' : 'Oculta');
  }

  // --- CARD 4: Alertas Visuais ---
  renderAlertsBanner(metrics, kpiStore.meta);

  // Atualiza relógio de telemetria
  setText(
    'kpi-sim-clock',
    `T+ ${new Date(nowSimMs).toISOString().replace('T', ' ').slice(0, 19)} UTC`
  );
}

// ============================================================================
// 4. INICIALIZAÇÃO E CICLO DE VIDA DOS TIMERS
// ============================================================================

/**
 * Inicializa os listeners dos cards de KPI e inicia o loop de atualização de 1s.
 */
export function initKpiCards() {
  // Evita duplicar listeners ou intervalos
  destroyKpiTimers();

  stateBus.addEventListener('lunar:state-updated', () => {
    refreshRealtimeMetrics();
  });

  kpiStore.timerId = window.setInterval(() => {
    if (kpiStore.simulationData) {
      refreshRealtimeMetrics();
    }
  }, 1000);
}

export function destroyKpiTimers() {
  if (kpiStore.timerId !== null) {
    clearInterval(kpiStore.timerId);
    kpiStore.timerId = null;
  }
}