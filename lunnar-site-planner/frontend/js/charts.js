// frontend/js/charts.js - gráficos Plotly (Plotly vem do <script> do index.html)
const LAYOUT = {
  paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
  font: { color: "#e8edff", size: 12 },
  margin: { l: 48, r: 16, t: 10, b: 44 },
  legend: { orientation: "h", y: 1.12 },
  xaxis: { gridcolor: "rgba(140,170,255,.12)", zerolinecolor: "rgba(140,170,255,.3)" },
  yaxis: { gridcolor: "rgba(140,170,255,.12)", zerolinecolor: "rgba(255,255,255,.5)" },
};
const CFG = { displaylogo: false, responsive: true };

export function graficoElevacao(res) {
  const s = res.series_temporais;
  const linhaHorizonte = { type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: "#fff", width: 1, dash: "dot" } };
  Plotly.react("chart-elevation", [
    { x: s.tempos, y: s.sol_elev, name: "Sol", mode: "lines", line: { color: "#ffb547", width: 2 } },
    { x: s.tempos, y: s.terra_elev, name: "Terra", mode: "lines", line: { color: "#4da3ff", width: 2 } },
  ], { ...LAYOUT, shapes: [linhaHorizonte], yaxis: { ...LAYOUT.yaxis, title: "Elevação (°)" } }, CFG);
}

export function graficoCeu(res) {
  const s = res.series_temporais;
  const acima = (az, el) => ({ az: az.filter((_, i) => el[i] > 0), el: el.filter((e) => e > 0) });
  const sol = acima(s.sol_az, s.sol_elev), terra = acima(s.terra_az, s.terra_elev);
  Plotly.react("chart-sky", [
    { x: s.horizonte_perfil.az, y: s.horizonte_perfil.elev, mode: "lines", name: "Horizonte local",
      line: { color: "#8892b8", shape: "spline" }, fill: "tozeroy", fillcolor: "rgba(120,130,170,.22)" },
    { x: sol.az, y: sol.el, name: "Sol", mode: "markers", marker: { color: "#ffb547", size: 5 } },
    { x: terra.az, y: terra.el, name: "Terra", mode: "markers", marker: { color: "#4da3ff", size: 5 } },
  ], {
    ...LAYOUT,
    xaxis: { ...LAYOUT.xaxis, title: "Azimute (° a partir do Norte)", range: [0, 360], dtick: 45 },
    yaxis: { ...LAYOUT.yaxis, title: "Elevação (°)" },
  }, CFG);
}

export function graficoComparacao(lista) {
  const nomes = lista.map((r) => `${r.local} (${r.periodo.inicio.slice(5)})`);
  Plotly.react("chart-compare", [
    { x: nomes, y: lista.map((r) => r.metricas_resumo.sol.fracao_visivel * 100), name: "Sol (%)", type: "bar", marker: { color: "#ffb547" } },
    { x: nomes, y: lista.map((r) => r.metricas_resumo.terra.fracao_visivel * 100), name: "Terra (%)", type: "bar", marker: { color: "#4da3ff" } },
  ], { ...LAYOUT, barmode: "group", yaxis: { ...LAYOUT.yaxis, title: "% do período", range: [0, 100] } }, CFG);
}

export function redimensionar() {
  ["chart-elevation", "chart-sky", "chart-compare"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.data && window.Plotly) Plotly.Plots.resize(el);
  });
}