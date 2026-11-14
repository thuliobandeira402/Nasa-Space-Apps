/**
 * Controlador principal da Aplicação Frontend (NASA Lunar Site Planner)
 */

import { PRESET_SITES, getSites, getFases, getViagem, simularPouso } from "./api.js";
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
  sites: [...PRESET_SITES],
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

/* ---------- Gestão de Modos (Engenheiro / Explorador) ---------- */
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

/* ---------- Catálogo de Locais (Via Backend /api/sites) ---------- */
async function carregarSites() {
  const res = await getSites();
  const lista = res?.data?.sites;
  if (Array.isArray(lista) && lista.length > 0) {
    state.sites = lista;
  }
  popularSites();
  aplicarSite();
}

function popularSites() {
  const select = $("site");
  if (!select) return;
  select.innerHTML =
    state.sites.map((s) => `<option value="${s.id}">${s.name}</option>`).join("") +
    `<option value="custom">Coordenadas personalizadas (Lat/Lon)...</option>`;
}

function aplicarSite() {
  const select = $("site");
  if (!select) return;
  const s = state.sites.find((x) => x.id === select.value);
  if (s) {
    $("lat").value = s.lat;
    $("lon").value = s.lon;
  }
}

/* ---------- Leitura do Formulário ---------- */
function lerParametros() {
  const siteId = $("site")?.value || null;
  const site = state.sites.find((s) => s.id === siteId);
  const lat = parseFloat($("lat").value);
  const lon = parseFloat($("lon").value);
  const start_date = $("start").value || "2027-03-01";
  const days = parseInt($("days").value, 10) || 30;
  const step_min = parseInt($("step").value, 10) || 60;

  return {
    site_id: site ? site.id : "custom",
    site_name: site ? site.name : `Ponto (${lat}°, ${lon}°)`,
    lat,
    lon,
    start_date,
    days,
    step_min,
  };
}

/* ---------- Execução da Simulação Principal ---------- */
async function rodarSimulacao(ev) {
  if (ev) ev.preventDefault();
  const submitBtn = $("scenario-form")?.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  setStatus("Processando efemérides NASA SPICE e malha LOLA...");

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
        ? "Simulação concluída com dados reais (NASA/JPL SPICE + LRO/LOLA)."
        : "Simulação concluída (modo contingência offline ativo)."
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
    return setStatus("Limite máximo de 6 cenários atingido.", true);
  }
  setStatus("Adicionando cenário ao comparador...");
  try {
    const params = lerParametros();
    const res = await simularPouso(params);
    const simData = res?.data ?? res;

    state.scenarios.push(simData);
    addScenarioToComparator(simData);
    renderComparisonChart(state.scenarios, "chart-compare");
    setStatus("Cenário adicionado com sucesso.");
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
document.addEventListener("DOMContentLoaded", async () => {
  iniciarModo();
  await carregarSites();

  $("site")?.addEventListener("change", aplicarSite);
  ["lat", "lon"].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      if ($("site")) $("site").value = "custom";
    });
  });

  $("scenario-form")?.addEventListener("submit", rodarSimulacao);
  $("btn-add")?.addEventListener("click", adicionarComparacao);
  $("btn-clear")?.addEventListener("click", limparComparacao);

  rodarSimulacao();
});