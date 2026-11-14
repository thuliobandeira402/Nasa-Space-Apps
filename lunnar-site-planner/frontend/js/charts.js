/**
 * Módulo de Visualização Científica — Plotly.js
 * Projeto: Lunar South Pole Lighting & Communication Tool
 *
 * Requer Plotly.js carregado globalmente via CDN ou bundler (window.Plotly)
 */

const THEME = {
  bg: 'rgba(11, 15, 25, 0)',
  paper: 'rgba(11, 15, 25, 0)',
  grid: 'rgba(148, 163, 184, 0.18)',
  text: '#e2e8f0',
  muted: '#94a3b8',
  sunLit: '#fbbf24',       // Sol acima do relevo (iluminado)
  sunShadow: '#64748b',    // Sol bloqueado pelo relevo (eclipse topográfico)
  earth: '#38bdf8',        // Linha de visada Terra (Comunicação)
  horizonFill: 'rgba(71, 85, 105, 0.55)',
  horizonLine: '#94a3b8',
  overlapWindow: 'rgba(16, 185, 129, 0.18)',
  scenarioPalette: ['#fbbf24', '#38bdf8', '#10b981', '#f472b6', '#a78bfa'],
};

function getPlotly() {
  if (!window.Plotly) {
    throw new Error('Plotly.js não encontrado. Adicione o script do Plotly antes de carregar charts.js.');
  }
  return window.Plotly;
}

// ============================================================================
// GERADORES AUXILIARES (FALLBACK DE GEOMETRIA LUNAR PARA TESTES OFFLINE)
// ============================================================================

/**
 * Gera perfil de elevação do horizonte (0° a 360°) baseado na região lunar
 * caso o backend ainda não retorne `horizon_profile`.
 */
function ensureHorizonProfile(siteId = 'shackleton_rim', existingProfile = null) {
  if (Array.isArray(existingProfile) && existingProfile.length > 0) {
    return existingProfile;
  }

  const profile = [];
  const seed = siteId.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

  for (let az = 0; az <= 360; az += 5) {
    const rad = (az * Math.PI) / 180;
    // Simula cristas e depressões de crateras ao redor do local de pouso
    const ridge1 = Math.max(0, 4.2 * Math.sin(rad * 2 + seed));
    const ridge2 = Math.max(0, 2.5 * Math.cos(rad * 3 - seed * 0.5));
    const horizonDeg = Number(Math.max(0.2, (ridge1 + ridge2) * 0.65).toFixed(2));
    profile.push({ azimuth_deg: az, elevation_deg: horizonDeg });
  }

  return profile;
}

/**
 * Garante azimutes solar e terrestre em cada ponto da série temporal.
 */
function enrichTimelineAzimuths(timeline = [], horizonProfile = []) {
  const getHorizonAt = (az) => {
    const normAz = ((az % 360) + 360) % 360;
    const closest = horizonProfile.reduce((prev, curr) =>
      Math.abs(curr.azimuth_deg - normAz) < Math.abs(prev.azimuth_deg - normAz) ? curr : prev
    );
    return closest ? closest.elevation_deg : 0;
  };

  return timeline.map((pt, idx) => {
    // Rotação aparente do Sol no Polo Sul (~360° a cada 708.7h)
    const sunAz =
      pt.sun_azimuth_deg !== undefined
        ? pt.sun_azimuth_deg
        : Number(((pt.elapsed_hours * (360 / 708.7)) % 360).toFixed(2));

    // Terra oscila em faixa estreita de azimute devido à libração lunar
    const earthAz =
      pt.earth_azimuth_deg !== undefined
        ? pt.earth_azimuth_deg
        : Number((180 + Math.sin(idx * 0.15) * 14).toFixed(2));

    const terrainMaskDeg = getHorizonAt(sunAz);
    const isAboveTerrain = pt.sun_elevation_deg > terrainMaskDeg;

    return {
      ...pt,
      sun_azimuth_deg: sunAz,
      earth_azimuth_deg: earthAz,
      terrain_mask_deg: terrainMaskDeg,
      is_above_terrain: isAboveTerrain,
    };
  });
}

// ============================================================================
// 1. SKYPLOT POLAR 360° (MÁSCARA DE RELEVO + ÓRBITA SOLAR + TERRA)
// ============================================================================

/**
 * Renderiza o Skyplot Polar 360° com:
 * - Zênite (90°) no centro e Horizonte (0°) na borda externa
 * - Máscara topográfica de relevo preenchida
 * - Trajetória solar diferenciando iluminação direta vs. sombra de relevo
 * - Posição/arco de comunicação com a Terra
 */
export function renderPolarSkyplot(containerId, simulationData, options = {}) {
  const Plotly = getPlotly();
  const container = document.getElementById(containerId);
  if (!container) return;

  const horizon = ensureHorizonProfile(simulationData.site_id, simulationData.horizon_profile);
  const series = enrichTimelineAzimuths(simulationData.timeline || [], horizon);

  // 1) Polígono fechado da máscara de relevo (entre r = 0° e r = elevação do relevo)
  const azForward = horizon.map((h) => h.azimuth_deg);
  const elForward = horizon.map((h) => h.elevation_deg);
  const azReverse = [...azForward].reverse();
  const baseZero = azReverse.map(() => 0);

  const terrainMaskTrace = {
    type: 'scatterpolar',
    mode: 'lines',
    name: 'Máscara de Relevo (Horizonte)',
    theta: [...azForward, ...azReverse],
    r: [...elForward, ...baseZero],
    fill: 'toself',
    fillcolor: THEME.horizonFill,
    line: { color: THEME.horizonLine, width: 1.5 },
    hovertemplate: 'Azimute: %{theta:.1f}°<br>Obstrução Relevo: %{r:.2f}°<extra>Horizonte</extra>',
  };

  // 2) Órbita Solar — pontos iluminados (acima da máscara topográfica)
  const sunLitPoints = series.filter((p) => p.is_above_terrain);
  const sunLitTrace = {
    type: 'scatterpolar',
    mode: 'lines+markers',
    name: 'Sol (Visível / Energia)',
    theta: sunLitPoints.map((p) => p.sun_azimuth_deg),
    r: sunLitPoints.map((p) => Math.max(0, p.sun_elevation_deg)),
    marker: {
      size: 6,
      color: THEME.sunLit,
      line: { color: '#fef08a', width: 1 },
    },
    line: { color: THEME.sunLit, width: 2 },
    customdata: sunLitPoints.map((p) => [p.timestamp, p.terrain_mask_deg]),
    hovertemplate:
      '<b>Sol Iluminado</b><br>' +
      'Data: %{customdata[0]}<br>' +
      'Azimute: %{theta:.1f}°<br>' +
      'Elevação Solar: %{r:.2f}°<br>' +
      'Relevo Local: %{customdata[1]:.2f}°<extra></extra>',
  };

  // 3) Órbita Solar — pontos eclipsados pelo relevo ou abaixo de 0°
  const sunShadowPoints = series.filter((p) => !p.is_above_terrain);
  const sunShadowTrace = {
    type: 'scatterpolar',
    mode: 'markers',
    name: 'Sol (Eclipsado pelo Relevo)',
    theta: sunShadowPoints.map((p) => p.sun_azimuth_deg),
    r: sunShadowPoints.map((p) => Math.max(0, p.sun_elevation_deg)),
    marker: {
      size: 5,
      symbol: 'x',
      color: THEME.sunShadow,
    },
    customdata: sunShadowPoints.map((p) => [p.timestamp, p.sun_elevation_deg]),
    hovertemplate:
      '<b>Sol Bloqueado</b><br>' +
      'Data: %{customdata[0]}<br>' +
      'Azimute: %{theta:.1f}°<br>' +
      'Elevação Real: %{customdata[1]:.2f}°<extra></extra>',
  };

  // 4) Linha de visada da Terra (Comunicação Direta - DTE)
  const earthVisible = series.filter((p) => p.earth_elevation_deg > 0);
  const earthTrace = {
    type: 'scatterpolar',
    mode: 'lines+markers',
    name: 'Terra (Comunicação DTE)',
    theta: earthVisible.map((p) => p.earth_azimuth_deg),
    r: earthVisible.map((p) => p.earth_elevation_deg),
    marker: { size: 6, color: THEME.earth, symbol: 'diamond' },
    line: { color: THEME.earth, width: 2, dash: 'dot' },
    hovertemplate:
      '<b>Visada Terra</b><br>' +
      'Azimute: %{theta:.1f}°<br>' +
      'Elevação: %{r:.2f}°<extra></extra>',
  };

  // Limite máximo do eixo radial (ex.: 25° ou 90° dependendo do zoom desejado)
  const maxElev = options.zoomHorizon ? 20 : 90;

  const layout = {
    title: {
      text: `Skyplot Polar 360° — ${simulationData.site_name || simulationData.site_id}`,
      font: { color: THEME.text, size: 15 },
    },
    paper_bgcolor: THEME.paper,
    plot_bgcolor: THEME.bg,
    font: { color: THEME.text, family: 'Inter, system-ui, sans-serif' },
    showlegend: true,
    legend: { orientation: 'h', y: -0.15, x: 0.5, xanchor: 'center' },
    margin: { t: 55, b: 65, l: 40, r: 40 },
    polar: {
      bgcolor: 'rgba(15, 23, 42, 0.65)',
      angularaxis: {
        direction: 'clockwise',
        rotation: 90, // 0° (Norte) no topo
        tickmode: 'array',
        tickvals: [0, 45, 90, 135, 180, 225, 270, 315],
        ticktext: ['0° N', '45° NE', '90° E', '135° SE', '180° S', '225° SW', '270° W', '315° NW'],
        gridcolor: THEME.grid,
        linecolor: THEME.grid,
      },
      radialaxis: {
        // Invertido: Zênite no centro, Horizonte (0°) na borda externa
        range: [maxElev, 0],
        ticksuffix: '°',
        angle: 45,
        gridcolor: THEME.grid,
        linecolor: THEME.grid,
        tickfont: { size: 10, color: THEME.muted },
      },
    },
  };

  Plotly.react(
    container,
    [terrainMaskTrace, sunShadowTrace, sunLitTrace, earthTrace],
    layout,
    { responsive: true, displaylogo: false }
  );
}

// ============================================================================
// 2. TIMELINE DINÂMICA DE 30 DIAS (ILUMINAÇÃO, COMUNICAÇÃO & COMPARAÇÃO)
// ============================================================================

/**
 * Renderiza a timeline dinâmica de 30 dias (720h).
 * Aceita tanto o objeto de `simulateScenario()` quanto o de `compareScenarios()`.
 */
export function renderTimeline30Days(containerId, dataPayload) {
  const Plotly = getPlotly();
  const container = document.getElementById(containerId);
  if (!container) return;

  const isComparison = Array.isArray(dataPayload.results);
  const scenarios = isComparison ? dataPayload.results : [dataPayload];
  const traces = [];
  const shapes = [];

  scenarios.forEach((scenario, idx) => {
    const color = THEME.scenarioPalette[idx % THEME.scenarioPalette.length];
    const label = scenario.site_name || scenario.site_id;
    const timeline = scenario.timeline || [];

    const xDates = timeline.map((p) => p.timestamp);
    const ySun = timeline.map((p) => p.sun_elevation_deg);
    const yEarth = timeline.map((p) => p.earth_elevation_deg);

    // Curva de Elevação Solar
    traces.push({
      type: 'scatter',
      mode: 'lines',
      name: isComparison ? `${label} (Sol)` : 'Elevação Solar (°)',
      x: xDates,
      y: ySun,
      line: { color, width: 2.3 },
      fill: isComparison ? 'none' : 'tozeroy',
      fillcolor: 'rgba(251, 191, 36, 0.12)',
      hovertemplate: `<b>${label}</b><br>%{x}<br>Sol: %{y:.2f}°<extra></extra>`,
    });

    // Curva de Elevação da Terra (exibida no modo single ou tracejada na comparação)
    traces.push({
      type: 'scatter',
      mode: 'lines',
      name: isComparison ? `${label} (Terra)` : 'Elevação da Terra (°)',
      x: xDates,
      y: yEarth,
      line: {
        color: isComparison ? color : THEME.earth,
        width: 1.8,
        dash: 'dash',
      },
      hovertemplate: `<b>${label}</b><br>%{x}<br>Terra: %{y:.2f}°<extra></extra>`,
    });

    // Destaca faixas verdes onde há Sol E Comunicação simultâneos (apenas no modo 1 cenário)
    if (!isComparison) {
      let windowStart = null;
      timeline.forEach((pt, i) => {
        if (pt.operational_window && !windowStart) {
          windowStart = pt.timestamp;
        } else if ((!pt.operational_window || i === timeline.length - 1) && windowStart) {
          shapes.push({
            type: 'rect',
            xref: 'x',
            yref: 'paper',
            x0: windowStart,
            x1: pt.timestamp,
            y0: 0,
            y1: 1,
            fillcolor: THEME.overlapWindow,
            line: { width: 0 },
            layer: 'below',
          });
          windowStart = null;
        }
      });
    }
  });

  // Linha de referência do Horizonte Matemático (0°)
  shapes.push({
    type: 'line',
    xref: 'paper',
    yref: 'y',
    x0: 0,
    x1: 1,
    y0: 0,
    y1: 0,
    line: { color: '#ef4444', width: 1.2, dash: 'dot' },
  });

  const layout = {
    title: {
      text: isComparison
        ? `Comparação Temporal (30 Dias) — ${scenarios.length} Cenários`
        : `Timeline Dinâmica de 30 Dias — Iluminação & Comunicação`,
      font: { color: THEME.text, size: 15 },
    },
    paper_bgcolor: THEME.paper,
    plot_bgcolor: 'rgba(15, 23, 42, 0.55)',
    font: { color: THEME.text, family: 'Inter, system-ui, sans-serif' },
    hovermode: 'x unified',
    shapes,
    legend: { orientation: 'h', y: 1.14, x: 0 },
    margin: { t: 70, b: 50, l: 55, r: 25 },
    xaxis: {
      type: 'date',
      gridcolor: THEME.grid,
      rangeslider: {
        visible: true,
        bgcolor: 'rgba(30, 41, 59, 0.7)',
        bordercolor: THEME.grid,
      },
      rangeselector: {
        bgcolor: '#1e293b',
        activecolor: '#3b82f6',
        font: { color: '#f8fafc', size: 11 },
        buttons: [
          { count: 3, label: '3d', step: 'day', stepmode: 'backward' },
          { count: 7, label: '7d', step: 'day', stepmode: 'backward' },
          { count: 15, label: '15d', step: 'day', stepmode: 'backward' },
          { step: 'all', label: '30d (Ciclo Lunar)' },
        ],
      },
    },
    yaxis: {
      title: 'Elevação Angular (°)',
      gridcolor: THEME.grid,
      zeroline: false,
    },
  };

  Plotly.react(container, traces, layout, { responsive: true, displaylogo: false });
}

// ============================================================================
// 3. GRÁFICO 3D DA TOPOGRAFIA LUNAR (LOLA DEM + PONTO DE POUSO)
// ============================================================================

/**
 * Renderiza o relevo 3D ao redor do local de pouso selecionado.
 * Se `demData` não vier da API, sintetiza uma cratera/crista realista em torno da elevação base.
 */
export function renderTopography3D(containerId, siteInfo = {}, demData = null) {
  const Plotly = getPlotly();
  const container = document.getElementById(containerId);
  if (!container) return;

  const baseElev = siteInfo.elevation_m ?? 4200;
  const siteName = siteInfo.name || siteInfo.site_name || 'Local de Pouso';

  let xCoords;
  let yCoords;
  let zMatrix;

  if (demData && Array.isArray(demData.z)) {
    xCoords = demData.x;
    yCoords = demData.y;
    zMatrix = demData.z;
  } else {
    // Malha 35x35 cobrindo 10 km x 10 km (-5 km a +5 km do lander)
    const size = 35;
    const extentKm = 5;
    xCoords = [];
    yCoords = [];
    zMatrix = [];

    for (let i = 0; i < size; i++) {
      const val = -extentKm + (2 * extentKm * i) / (size - 1);
      xCoords.push(Number(val.toFixed(2)));
      yCoords.push(Number(val.toFixed(2)));
    }

    const isCraterRim = (siteInfo.id || '').includes('rim');

    for (let yi = 0; yi < size; yi++) {
      const row = [];
      for (let xi = 0; xi < size; xi++) {
        const x = xCoords[xi];
        const y = yCoords[yi];
        const dist = Math.sqrt(x * x + y * y);

        // Modela uma cratera profunda adjacente à crista elevada
        const craterDrop = isCraterRim
          ? -950 * Math.exp(-Math.pow((x - 2.2) / 2.4, 2) - Math.pow((y + 1.5) / 2.4, 2))
          : -650 * Math.exp(-Math.pow(dist / 3.2, 2));

        const ridgePeak = 280 * Math.exp(-Math.pow(dist / 1.8, 2));
        const microRelief = 35 * Math.sin(x * 1.8) * Math.cos(y * 1.8);

        row.push(Math.round(baseElev + ridgePeak + craterDrop + microRelief));
      }
      zMatrix.push(row);
    }
  }

  const centerIdx = Math.floor(zMatrix.length / 2);
  const landerZ = zMatrix[centerIdx][centerIdx] + 25;

  const surfaceTrace = {
    type: 'surface',
    name: 'Elevação LOLA DEM',
    x: xCoords,
    y: yCoords,
    z: zMatrix,
    colorscale: [
      [0.0, '#0f172a'],  // Fundo de cratera (PSR / sombra permanente)
      [0.35, '#334155'],
      [0.65, '#64748b'],
      [0.85, '#cbd5e1'],
      [1.0, '#f8fafc'],   // Picos de luz eterna
    ],
    colorbar: {
      title: { text: 'Elevação (m)', font: { color: THEME.text, size: 11 } },
      tickfont: { color: THEME.muted, size: 10 },
      len: 0.75,
    },
    contours: {
      z: {
        show: true,
        usecolormap: true,
        highlightcolor: '#38bdf8',
        project: { z: false },
      },
    },
    hovertemplate: 'X: %{x} km<br>Y: %{y} km<br>Altitude: %{z} m<extra>Topografia</extra>',
  };

  // Marcador 3D do Local de Pouso (Lander)
  const landerTrace = {
    type: 'scatter3d',
    mode: 'markers+text',
    name: 'Ponto de Pouso',
    x: [0],
    y: [0],
    z: [landerZ],
    text: [siteName],
    textposition: 'top center',
    textfont: { color: '#fbbf24', size: 11 },
    marker: {
      size: 6,
      color: '#fbbf24',
      symbol: 'diamond',
      line: { color: '#0f172a', width: 2 },
    },
    hovertemplate: `<b>${siteName}</b><br>Altitude: ${landerZ - 25} m<extra>Lander</extra>`,
  };

  const layout = {
    title: {
      text: `Topografia 3D (LOLA DEM) — ${siteName}`,
      font: { color: THEME.text, size: 15 },
    },
    paper_bgcolor: THEME.paper,
    font: { color: THEME.text, family: 'Inter, system-ui, sans-serif' },
    margin: { t: 50, b: 15, l: 10, r: 10 },
    scene: {
      bgcolor: 'rgba(11, 15, 25, 0.85)',
      xaxis: { title: 'Leste–Oeste (km)', gridcolor: THEME.grid, color: THEME.muted },
      yaxis: { title: 'Norte–Sul (km)', gridcolor: THEME.grid, color: THEME.muted },
      zaxis: { title: 'Elevação (m)', gridcolor: THEME.grid, color: THEME.muted },
      camera: {
        eye: { x: 1.55, y: 1.55, z: 0.95 },
      },
    },
  };

  Plotly.react(container, [surfaceTrace, landerTrace], layout, {
    responsive: true,
    displaylogo: false,
  });
}