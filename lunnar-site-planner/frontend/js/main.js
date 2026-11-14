// frontend/js/main.js - ponto de entrada: liga formulário, API, cards e gráficos
import { listarSites, simular } from "./api.js";
import { $, setStatus, renderCards, renderComparacao } from "./ui_cards.js";
import { graficoElevacao, graficoCeu, graficoComparacao, redimensionar } from "./charts.js";

const MAX_COMPARACAO = 6;
const estado = { sites: [], comparacao: [] };

/* ---------- modo Engenheiro / Explorador ---------- */
function definirModo(modo) {
  document.body.dataset.mode = modo;               // o CSS esconde/mostra .only-engineer e .only-explorer
  const radio = $(`mode-${modo}`);
  if (radio) radio.checked = true;
  try { localStorage.setItem("mode", modo); } catch (_) { /* ignore */ }
  redimensionar();                                 // gráficos recalculam o tamanho
}

function iniciarModo() {
  let salvo = "engineer";
  try { salvo = localStorage.getItem("mode") || salvo; } catch (_) { /* ignore */ }
  if (salvo !== "engineer" && salvo !== "explorer") salvo = "engineer";
  definirModo(salvo);
  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener("change", () => definirModo(r.value)));
}

/* ---------- cenário ---------- */
function lerCenario() {
  const lat = parseFloat($("lat").value), lon = parseFloat($("lon").value);
  const site = estado.sites.find((s) => s.id === $("site").value);
  const [ano, mes, dia] = ($("start").value || "2027-03-01").split("T")[0].split("-").map(Number);
  return {
    site_id: site ? site.id : null,                 // só usa horizonte/declividade se for um local do catálogo
    nome_local: site ? site.nome : `Ponto (${lat}°, ${lon}°)`,
    lat, lon,
    elevacao_m: site ? site.elevacao_m : 0,
    ano, mes, dia,
    dias_simulacao: parseInt($("days").value, 10),
    passo_min: parseFloat($("step").value),
  };
}

function aplicarSite() {
  const s = estado.sites.find((x) => x.id === $("site").value);
  if (s) { $("lat").value = s.lat; $("lon").value = s.lon; }
}

async function aoSimular(ev) {
  ev.preventDefault();
  const botao = ev.submitter;
  if (botao) botao.disabled = true;
  setStatus("Calculando...");
  try {
    const res = await simular(lerCenario());
    renderCards(res);
    graficoElevacao(res);
    graficoCeu(res);
    setStatus("Pronto.");
  } catch (e) {
    setStatus(`Falha: ${e.message}`, true);
  } finally {
    if (botao) botao.disabled = false;
  }
}

async function aoAdicionar() {
  if (estado.comparacao.length >= MAX_COMPARACAO) return setStatus(`Máximo de ${MAX_COMPARACAO} cenários.`, true);
  setStatus("Adicionando...");
  try {
    const res = await simular(lerCenario());
    delete res.series_temporais;                    // comparador só precisa do resumo
    estado.comparacao.push(res);
    atualizarComparacao();
    setStatus("Cenário adicionado à comparação.");
  } catch (e) {
    setStatus(`Falha: ${e.message}`, true);
  }
}

function atualizarComparacao() {
  renderComparacao(estado.comparacao);
  if (estado.comparacao.length) graficoComparacao(estado.comparacao);
}

/* ---------- inicialização ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  iniciarModo();

  $("site").addEventListener("change", aplicarSite);
  // editar coordenadas manualmente = ponto personalizado (não aplica horizonte/declividade de outro local)
  ["lat", "lon"].forEach((id) => $(id).addEventListener("input", () => { $("site").value = "custom"; }));
  $("scenario-form").addEventListener("submit", aoSimular);
  $("btn-add").addEventListener("click", aoAdicionar);
  $("btn-clear").addEventListener("click", () => { estado.comparacao = []; atualizarComparacao(); });
  $("comp-table").addEventListener("click", (e) => {
    const b = e.target.closest(".x");
    if (b) { estado.comparacao.splice(Number(b.dataset.i), 1); atualizarComparacao(); }
  });
  renderComparacao([]);

  try {
    estado.sites = await listarSites();
  } catch (e) {
    setStatus(`Backend indisponível: ${e.message}`, true);
  }
  $("site").innerHTML = estado.sites.map((s) => `<option value="${s.id}">${s.nome}</option>`).join("") +
    `<option value="custom">Coordenadas personalizadas...</option>`;
  aplicarSite();
});