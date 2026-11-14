// frontend/js/main.js - Orquestrador principal: conecta formulário, API, cards, gráficos e cena 3D
import { PRESET_SITES, getFases, getViagem, simularPouso } from "./api.js";
import { mountOrUpdate3DScene } from "./app.js";
import { renderElevationTimeline, renderSkyplotPolar, renderComparisonChart } from "./charts.js";
import {
  updateSimulationUI,
  syncStepMetrics,
  addScenarioToComparator,
  clearComparator,
} from "./ui_cards.js";

const $ = (id) => document.getElementById(id);

const state = {
  lastSimData: null,
  lastViagemData: null,
  lastFasesData: null,
  scenarios: [],
};

function setStatus(msg, isError = false) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("error", isError);
}

/* ---------- Modo Engenheiro / Explorador ---------- */
function definirModo(modo) {
  document.body.dataset.mode = modo;
  const radio = $(`mode-${modo}`);
  if (radio) radio.checked = true;
  try {
    localStorage.setItem("mode", modo);
  } catch (_) {}
  window.dispatchEvent(new Event("resize"));
}

function iniciarModo() {
  let salvo = "engineer";
  try {
    salvo = localStorage.getItem("mode") || salvo;
  } catch (_) {}
  if (salvo !== "engineer" && salvo !== "explorer") salvo = "engineer";
  definirModo(salvo);
  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.addEventListener("change", () => definirModo(r.value));
  });
}

/* ---------- Catálogo de Locais ---------- */
function popularSites() {
  const select = $("site");
  if (!select) return;
  select.innerHTML =
    PRESET_SITES.map((s) => `<option value="${s.id}">${s.name}</option>`).join("") +
    `<option value="custom">Coordenadas personalizadas...</option>`;
}

function aplicarSite() {
  const select = $("site");
  if (!select) return;
  const s = PRESET_SITES.find((x) => x.id === select.value);
  if (s) {
    $("lat").value = s.lat;
    $("lon").value = s.lon;
  }
}

/* ---------- Leitura do Formulário ---------- */
function lerParametros() {
  const siteId = $("site")?.value || null;
  const site = PRESET_SITES.find((s) => s.id === siteId);
  const lat = parseFloat($("lat").value);
  const lon = parseFloat($("lon").value);
  const start_date = $("start").value || "2027-03-01";
  const days = parseInt($("days").value, 10) || 30;
  const step_minutes = parseInt($("step").value, 10) || 60;

  return {
    site_id: site ? site.id : null,
    site_name: site ? site.name : `Ponto (${lat}°, ${lon}°)`,
    lat,
    lon,
    start_date,
    days,
    step_minutes,
  };
}

/* ---------- Execução da Simulação ---------- */
async function rodarSimulacao(ev) {
  if (ev) ev.preventDefault();
  const submitBtn = $("scenario-form")?.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  setStatus("Calculando efemérides e iluminação lunar...");

  try {
    const params = lerParametros();

    const [pousoRes, viagemRes, fasesRes] = await Promise.all([
      simularPouso(params),
      getViagem({ start_date: params.start_date, duration_days: 4 }),
      getFases({ start_date: params.start_date, days: params.days, lat: params.lat, lon: params.lon }),
    ]);

    const simData = pousoRes?.data ?? pousoRes;
    const source = pousoRes?.source ?? "online";
    const viagemData = viagemRes?.data ?? viagemRes;
    const fasesData = fasesRes?.data ?? fasesRes;

    state.lastSimData = simData;
    state.lastViagemData = viagemData;
    state.lastFasesData = fasesData;

    updateSimulationUI(simData, source);
    renderElevationTimeline(simData, "chart-elevation");
    renderSkyplotPolar(simData, "chart-sky");
    mountOrUpdate3DScene({
      simData,
      viagemData,
      fasesData,
      onStepChange: (idx) => syncStepMetrics(idx),
    });

    setStatus(
      source === "online"
        ? "Simulação concluída (NASA/JPL SPICE)."
        : "Simulação concluída (modo contingência offline)."
    );
  } catch (err) {
    console.error(err);
    setStatus(`Erro na simulação: ${err.message}`, true);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

/* ---------- Comparador de Cenários ---------- */
async function adicionarComparacao() {
  if (state.scenarios.length >= 6) {
    return setStatus("Máximo de 6 cenários atingido.", true);
  }
  setStatus("Adicionando cenário à comparação...");
  try {
    const params = lerParametros();
    const res = await simularPouso(params);
    const simData = res?.data ?? res;

    state.scenarios.push(simData);
    addScenarioToComparator(simData);
    renderComparisonChart(state.scenarios, "chart-compare");
    setStatus("Cenário adicionado ao comparador.");
  } catch (err) {
    setStatus(`Falha ao comparar: ${err.message}`, true);
  }
}

function limparComparacao() {
  state.scenarios = [];
  clearComparator();
  renderComparisonChart([], "chart-compare");
  setStatus("Comparador limpo.");
}

/* ---------- Inicialização ---------- */
document.addEventListener("DOMContentLoaded", () => {
  iniciarModo();
  popularSites();
  aplicarSite();

  $("site")?.addEventListener("change", aplicarSite);
  ["lat", "lon"].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      if ($("site")) $("site").value = "custom";
    });
  });

  $("scenario-form")?.addEventListener("submit", rodarSimulacao);
  $("btn-add")?.addEventListener("click", adicionarComparacao);
  $("btn-clear")?.addEventListener("click", limparComparacao);

  // Dispara a primeira simulação automaticamente para renderizar o 3D e os KPIs ao abrir
  rodarSimulacao();
});