/**
 * Main Application Controller (NASA Lunar Site Planner)
 */

import { PRESET_SITES, getSites, getFases, getViagem, simularPouso } from "./api.js";
import { mountOrUpdate3DScene } from "./app.js";
import { renderElevationTimeline, renderSkyplotPolar, renderComparisonChart } from "./charts.js";
import {
  updateSimulationUI,
  syncStepMetrics,
  addScenarioToComparator,
  clearComparator,
  getComparedScenarios,
} from "./ui_cards.js";

const $ = (id) => document.getElementById(id);

const state = {
  sites: [...PRESET_SITES],
  lastSimData: null,
  lastViagemData: null,
  lastFasesData: null,
};

function setStatus(msg, isError = false) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("error", isError);
}

/* ---------- Engineer / Explorer Mode ---------- */
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

/* ---------- Site Catalog ---------- */
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
    `<option value="custom">Custom Coordinates (Lat/Lon)...</option>`;
}

function aplicarSite() {
  const select = $("site");
  if (!select) return;
  const s = state.sites.find((x) => x.id === select.value);
  if (s) {
    if ($("lat")) $("lat").value = s.lat;
    if ($("lon")) $("lon").value = s.lon;
    if ($("elev") && typeof s.elevation_m === "number") $("elev").value = s.elevation_m;
  }
}

/* ---------- Read Form Parameters ---------- */
function lerParametros() {
  const siteId = $("site")?.value || null;
  const site = state.sites.find((s) => s.id === siteId);
  const lat = parseFloat($("lat")?.value ?? -89.9);
  const lon = parseFloat($("lon")?.value ?? 0.0);
  const elevInput = $("elev") ? parseFloat($("elev").value) : NaN;
  const elevacao_m = !Number.isNaN(elevInput) ? elevInput : (site ? site.elevation_m : 0.0);
  const start_date = $("start")?.value || "2027-03-01";
  const days = parseInt($("days")?.value, 10) || 30;
  const step_min = parseInt($("step")?.value, 10) || 60;
  const usar_topografia = $("use-topo") ? Boolean($("use-topo").checked) : true;

  return {
    site_id: site ? site.id : "custom",
    site_name: site ? site.name : `Custom Point (${lat}°, ${lon}°)`,
    lat,
    lon,
    elevacao_m,
    start_date,
    days,
    step_min,
    usar_topografia,
  };
}

/* ---------- Run Main Simulation ---------- */
async function rodarSimulacao(ev) {
  if (ev) ev.preventDefault();
  const submitBtn = $("scenario-form")?.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  setStatus("Processing NASA SPICE ephemerides & LOLA terrain...");

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
        ? "Simulation complete (NASA/JPL SPICE + LRO/LOLA)."
        : "Simulation complete (offline contingency mode)."
    );
  } catch (err) {
    console.error(err);
    setStatus(`Simulation error: ${err.message}`, true);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

/* ---------- Scenario Comparator ---------- */
async function adicionarComparacao() {
  if (getComparedScenarios().length >= 6) {
    return setStatus("Maximum limit of 6 scenarios reached.", true);
  }
  setStatus("Adding scenario to comparator...");
  try {
    const params = lerParametros();
    const res = await simularPouso(params);
    const simData = res?.data ?? res;

    addScenarioToComparator(simData);
    renderComparisonChart(getComparedScenarios(), "chart-compare");
    setStatus("Scenario added to comparator.");
  } catch (err) {
    setStatus(`Comparison error: ${err.message}`, true);
  }
}

function limparComparacao() {
  clearComparator();
  renderComparisonChart([], "chart-compare");
  setStatus("Comparator cleared.");
}

/* ---------- Initialization ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  iniciarModo();
  await carregarSites();

  $("site")?.addEventListener("change", aplicarSite);
  ["lat", "lon", "elev"].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      if ($("site")) $("site").value = "custom";
    });
  });

  $("scenario-form")?.addEventListener("submit", rodarSimulacao);
  $("btn-add")?.addEventListener("click", adicionarComparacao);
  $("btn-clear")?.addEventListener("click", limparComparacao);

  rodarSimulacao();
});