/**
 * Scientific Visualization Module — Plotly.js
 * HTML Containers:
 *  - #chart-elevation (Sun and Earth elevation over time)
 *  - #chart-sky       (360° polar skyplot with horizon terrain mask)
 *  - #chart-compare   (Scenario comparison)
 */

const THEME = {
  paper: 'rgba(0,0,0,0)',
  plot: 'rgba(15, 23, 42, 0.55)',
  grid: 'rgba(148, 163, 184, 0.18)',
  text: '#e2e8f0',
  muted: '#94a3b8',
  sunLit: '#fbbf24',
  sunShadow: '#64748b',
  earth: '#38bdf8',
  horizonFill: 'rgba(71, 85, 105, 0.55)',
  horizonLine: '#94a3b8',
  overlap: 'rgba(16, 185, 129, 0.16)',
};

function getPlotly() {
  if (!window.Plotly) {
    throw new Error('Plotly.js not loaded in HTML.');
  }
  return window.Plotly;
}

/**
 * 1. Dynamic Timeline (#chart-elevation)
 * Sun and Earth elevation + simultaneous operational window bands.
 */
export function renderElevationTimeline(simData, containerId = 'chart-elevation') {
  const Plotly = getPlotly();
  const container = document.getElementById(containerId);
  if (!container || !simData?.timeline) return;

  const timeline = simData.timeline;
  const xDates = timeline.map((p) => p.timestamp);
  const ySun = timeline.map((p) => p.sun_elevation_deg);
  const yEarth = timeline.map((p) => p.earth_elevation_deg);

  const shapes = [
    {
      type: 'line',
      xref: 'paper',
      yref: 'y',
      x0: 0,
      x1: 1,
      y0: 0,
      y1: 0,
      line: { color: '#ef4444', width: 1.2, dash: 'dot' },
    },
  ];

  // Highlights periods where Sun (above terrain) and Earth are visible simultaneously
  let winStart = null;
  timeline.forEach((pt, idx) => {
    if (pt.operational_window && !winStart) {
      winStart = pt.timestamp;
    } else if ((!pt.operational_window || idx === timeline.length - 1) && winStart) {
      shapes.push({
        type: 'rect',
        xref: 'x',
        yref: 'paper',
        x0: winStart,
        x1: pt.timestamp,
        y0: 0,
        y1: 1,
        fillcolor: THEME.overlap,
        line: { width: 0 },
        layer: 'below',
      });
      winStart = null;
    }
  });

  const traces = [
    {
      type: 'scatter',
      mode: 'lines',
      name: '☀️ Sun Elevation (°)',
      x: xDates,
      y: ySun,
      line: { color: THEME.sunLit, width: 2.3 },
      fill: 'tozeroy',
      fillcolor: 'rgba(251, 191, 36, 0.12)',
      hovertemplate: '%{x}<br>Sun: <b>%{y:.2f}°</b><extra></extra>',
    },
    {
      type: 'scatter',
      mode: 'lines',
      name: '🌍 Earth Elevation (°)',
      x: xDates,
      y: yEarth,
      line: { color: THEME.earth, width: 1.9, dash: 'dash' },
      hovertemplate: '%{x}<br>Earth: <b>%{y:.2f}°</b><extra></extra>',
    },
  ];

  const layout = {
    paper_bgcolor: THEME.paper,
    plot_bgcolor: THEME.plot,
    font: { color: THEME.text, family: 'system-ui, sans-serif', size: 12 },
    hovermode: 'x unified',
    shapes,
    legend: { orientation: 'h', y: 1.15, x: 0 },
    margin: { t: 45, b: 40, l: 48, r: 20 },
    xaxis: {
      type: 'date',
      gridcolor: THEME.grid,
      rangeslider: { visible: true, bgcolor: 'rgba(30, 41, 59, 0.6)' },
      rangeselector: {
        bgcolor: '#1e293b',
        activecolor: '#0284c7',
        font: { color: '#f8fafc', size: 11 },
        buttons: [
          { count: 3, label: '3d', step: 'day', stepmode: 'backward' },
          { count: 7, label: '7d', step: 'day', stepmode: 'backward' },
          { count: 15, label: '15d', step: 'day', stepmode: 'backward' },
          { step: 'all', label: 'All' },
        ],
      },
    },
    yaxis: {
      title: 'Elevation (°)',
      gridcolor: THEME.grid,
      zeroline: false,
    },
  };

  Plotly.react(container, traces, layout, { responsive: true, displaylogo: false });
}

/**
 * 2. 360° Polar Skyplot (#chart-sky)
 * Integrates horizon terrain mask, solar trajectory (visible vs. eclipsed), and Earth.
 */
export function renderSkyplotPolar(simData, containerId = 'chart-sky') {
  const Plotly = getPlotly();
  const container = document.getElementById(containerId);
  if (!container || !simData?.timeline) return;

  const horizon = simData.horizon_profile || [];
  const timeline = simData.timeline;

  const azFwd = horizon.map((h) => h.azimuth_deg);
  const elFwd = horizon.map((h) => h.elevation_deg);
  const azRev = [...azFwd].reverse();

  const horizonMaskTrace = {
    type: 'scatterpolar',
    mode: 'lines',
    name: 'Horizon Terrain',
    theta: [...azFwd, ...azRev],
    r: [...elFwd, ...azRev.map(() => 0)],
    fill: 'toself',
    fillcolor: THEME.horizonFill,
    line: { color: THEME.horizonLine, width: 1.5 },
    hovertemplate: 'Azimuth: %{theta:.0f}°<br>Terrain: %{r:.2f}°<extra>Horizon</extra>',
  };

  const sunLit = timeline.filter((p) => p.sun_visible);
  const sunLitTrace = {
    type: 'scatterpolar',
    mode: 'lines+markers',
    name: '☀️ Sun (Above Terrain)',
    theta: sunLit.map((p) => p.sun_azimuth_deg),
    r: sunLit.map((p) => Math.max(0, p.sun_elevation_deg)),
    marker: { size: 5, color: THEME.sunLit },
    line: { color: THEME.sunLit, width: 2 },
    hovertemplate: 'Azimuth: %{theta:.1f}°<br>Sun Elevation: %{r:.2f}°<extra>Illuminated</extra>',
  };

  const sunBlocked = timeline.filter((p) => !p.sun_visible);
  const sunBlockedTrace = {
    type: 'scatterpolar',
    mode: 'markers',
    name: '🌑 Sun (Blocked/Shadow)',
    theta: sunBlocked.map((p) => p.sun_azimuth_deg),
    r: sunBlocked.map((p) => Math.max(0, p.sun_elevation_deg)),
    marker: { size: 4, symbol: 'x', color: THEME.sunShadow },
    hovertemplate: 'Azimuth: %{theta:.1f}°<br>Sun Elevation: %{r:.2f}°<extra>Shadow</extra>',
  };

  const earthVis = timeline.filter((p) => p.earth_visible);
  const earthTrace = {
    type: 'scatterpolar',
    mode: 'lines+markers',
    name: '🌍 Earth (DTE Signal)',
    theta: earthVis.map((p) => p.earth_azimuth_deg),
    r: earthVis.map((p) => p.earth_elevation_deg),
    marker: { size: 5, color: THEME.earth, symbol: 'diamond' },
    line: { color: THEME.earth, width: 1.8, dash: 'dot' },
    hovertemplate: 'Azimuth: %{theta:.1f}°<br>Earth Elevation: %{r:.2f}°<extra>Earth</extra>',
  };

  const layout = {
    paper_bgcolor: THEME.paper,
    font: { color: THEME.text, family: 'system-ui, sans-serif', size: 12 },
    showlegend: true,
    legend: { orientation: 'h', y: -0.15, x: 0.5, xanchor: 'center' },
    margin: { t: 30, b: 60, l: 35, r: 35 },
    polar: {
      bgcolor: THEME.plot,
      angularaxis: {
        direction: 'clockwise',
        rotation: 90,
        tickvals: [0, 45, 90, 135, 180, 225, 270, 315],
        ticktext: ['N 0°', '45°', 'E 90°', '135°', 'S 180°', '225°', 'W 270°', '315°'],
        gridcolor: THEME.grid,
        linecolor: THEME.grid,
      },
      radialaxis: {
        range: [18, 0], // Focus on the first 18° above the lunar horizon
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
    [horizonMaskTrace, sunBlockedTrace, sunLitTrace, earthTrace],
    layout,
    { responsive: true, displaylogo: false }
  );
}

/**
 * 3. Scenario Comparison Chart (#chart-compare)
 */
export function renderComparisonChart(scenarios = [], containerId = 'chart-compare') {
  const Plotly = getPlotly();
  const container = document.getElementById(containerId);
  if (!container) return;

  if (scenarios.length < 2) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  const labels = scenarios.map((s) => `${s.site_name} (${s.start_date})`);

  const traces = [
    {
      type: 'bar',
      name: '☀️ Solar Illumination (%)',
      x: labels,
      y: scenarios.map((s) => s.sun_fraction_pct),
      marker: { color: THEME.sunLit },
    },
    {
      type: 'bar',
      name: '🌍 Earth Visibility (%)',
      x: labels,
      y: scenarios.map((s) => s.earth_fraction_pct),
      marker: { color: THEME.earth },
    },
  ];

  const layout = {
    barmode: 'group',
    paper_bgcolor: THEME.paper,
    plot_bgcolor: THEME.plot,
    font: { color: THEME.text, family: 'system-ui, sans-serif', size: 12 },
    margin: { t: 25, b: 45, l: 45, r: 20 },
    legend: { orientation: 'h', y: 1.18, x: 0 },
    yaxis: { range: [0, 100], title: '% of Window', gridcolor: THEME.grid },
    xaxis: { gridcolor: THEME.grid },
  };

  Plotly.react(container, traces, layout, { responsive: true, displaylogo: false });
}