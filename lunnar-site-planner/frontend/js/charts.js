/**
 * Scientific Visualization Module — Plotly.js
 */

const THEME = {
  paper: 'rgba(0,0,0,0)',
  plot: 'rgba(0,0,0,0)',
  grid: 'rgba(255, 255, 255, 0.10)',
  text: '#ffffff',
  muted: '#8d8d91',
  sunLit: '#ffd24a',
  sunShadow: '#666668',
  earth: '#7fb4ff',
  horizonFill: 'rgba(102, 102, 104, 0.45)',
  horizonLine: '#8d8d91',
  overlap: 'rgba(61, 220, 151, 0.14)',
};

function getPlotly() {
  if (!window.Plotly) {
    throw new Error('Plotly.js not loaded in HTML.');
  }
  return window.Plotly;
}

/**
 * 1. Dynamic Elevation Timeline (#chart-elevation)
 */
export function renderElevationTimeline(simData, containerId = 'chart-elevation') {
  const Plotly = getPlotly();
  const container = document.getElementById(containerId);
  if (!container || !simData?.timeline) return;

  const timeline = simData.timeline;
  const xDates = timeline.map((p) => p.timestamp);
  const ySun = timeline.map((p) => p.sun_elevation_deg);
  const yMask = timeline.map((p) => p.terrain_mask_deg ?? 0);
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
      line: { color: '#fc3d21', width: 1.1, dash: 'dot' },
    },
  ];

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
      name: '☀️ Solar Elevation (°)',
      x: xDates,
      y: ySun,
      line: { color: THEME.sunLit, width: 2.3 },
      fill: 'tozeroy',
      fillcolor: 'rgba(255, 210, 74, 0.12)',
      hovertemplate: '%{x}<br>Sun: <b>%{y:.2f}°</b><extra></extra>',
    },
    {
      type: 'scatter',
      mode: 'lines',
      name: '⛰️ Terrain Horizon Mask (°)',
      x: xDates,
      y: yMask,
      line: { color: THEME.horizonLine, width: 1.4, dash: 'dot' },
      hovertemplate: '%{x}<br>Horizon Mask: <b>%{y:.2f}°</b><extra></extra>',
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
    legend: { orientation: 'h', y: 1.16, x: 0 },
    margin: { t: 48, b: 40, l: 48, r: 20 },
    xaxis: {
      type: 'date',
      gridcolor: THEME.grid,
      rangeslider: { visible: true, bgcolor: 'rgba(255, 255, 255, 0.06)' },
      rangeselector: {
        bgcolor: '#0e0e0e',
        activecolor: '#666668',
        font: { color: '#ffffff', size: 11 },
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
 */
export function renderSkyplotPolar(simData, containerId = 'chart-sky') {
  const Plotly = getPlotly();
  const container = document.getElementById(containerId);
  if (!container || !simData?.timeline) return;

  const horizon = simData.horizon_profile || [];
  const timeline = simData.timeline;

  const azFwd = horizon.map((h) => h.azimuth_deg);
  const elFwd = horizon.map((h) => Math.max(0, h.elevation_deg));
  const azRev = [...azFwd].reverse();

  const horizonMaskTrace = {
    type: 'scatterpolar',
    mode: 'lines',
    name: 'LOLA Horizon Relief',
    theta: [...azFwd, ...azRev],
    r: [...elFwd, ...azRev.map(() => 0)],
    fill: 'toself',
    fillcolor: THEME.horizonFill,
    line: { color: THEME.horizonLine, width: 1.5 },
    hovertemplate: 'Azimuth: %{theta:.0f}°<br>Horizon: %{r:.2f}°<extra>Horizon</extra>',
  };

  const sunLit = timeline.filter((p) => p.sun_visible);
  const sunLitTrace = {
    type: 'scatterpolar',
    mode: 'lines+markers',
    name: '☀️ Sun (Visible)',
    theta: sunLit.map((p) => p.sun_azimuth_deg),
    r: sunLit.map((p) => Math.max(0, p.sun_elevation_deg)),
    marker: { size: 5, color: THEME.sunLit },
    line: { color: THEME.sunLit, width: 2 },
    hovertemplate: 'Azimuth: %{theta:.1f}°<br>Sun Elev: %{r:.2f}°<extra>Sunlit</extra>',
  };

  const sunBlocked = timeline.filter((p) => !p.sun_visible);
  const sunBlockedTrace = {
    type: 'scatterpolar',
    mode: 'markers',
    name: '🌑 Sun (Blocked/Shadow)',
    theta: sunBlocked.map((p) => p.sun_azimuth_deg),
    r: sunBlocked.map((p) => Math.max(0, p.sun_elevation_deg)),
    marker: { size: 4, symbol: 'x', color: THEME.sunShadow },
    hovertemplate: 'Azimuth: %{theta:.1f}°<br>Sun Elev: %{r:.2f}°<extra>Shadow</extra>',
  };

  const earthVis = timeline.filter((p) => p.earth_visible);
  const earthTrace = {
    type: 'scatterpolar',
    mode: 'lines+markers',
    name: '🌍 Earth (DTE Link)',
    theta: earthVis.map((p) => p.earth_azimuth_deg),
    r: earthVis.map((p) => Math.max(0, p.earth_elevation_deg)),
    marker: { size: 5, color: THEME.earth, symbol: 'diamond' },
    line: { color: THEME.earth, width: 1.8, dash: 'dot' },
    hovertemplate: 'Azimuth: %{theta:.1f}°<br>Earth Elev: %{r:.2f}°<extra>Earth DTE</extra>',
  };

  const maxBodyEl = Math.max(
    18,
    ...sunLit.map((p) => p.sun_elevation_deg || 0),
    ...earthVis.map((p) => p.earth_elevation_deg || 0)
  );
  const radialMax = Math.min(90, Math.ceil(maxBodyEl / 5) * 5);

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
        range: [radialMax, 0],
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
 * 3. Multi-Scenario Comparison Chart (#chart-compare)
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
      name: '🌍 Earth DTE Visibility (%)',
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