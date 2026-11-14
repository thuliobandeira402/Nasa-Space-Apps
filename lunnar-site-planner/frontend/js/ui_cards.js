// frontend/js/ui_cards.js - cards de KPIs, texto do Modo Explorador e tabela do comparador
export const $ = (id) => document.getElementById(id);
export const pct = (x) => `${Math.round(x * 100)}%`;

export function fmtDuracao(min) {
  if (min == null) return null;
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = Math.round(min % 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}min`;
  return `${m}min`;
}

export function setStatus(msg, erro = false) {
  const el = $("status");
  el.textContent = msg;
  el.classList.toggle("error", erro);
}

function proximo(corpo, quandoNasce, quandoPoe) {
  const t = fmtDuracao(corpo.minutos_ate_mudanca);
  if (corpo.visivel_agora) return t ? `${quandoPoe} em ${t}` : "Visível durante todo o período";
  return t ? `${quandoNasce} em ${t}` : "Fora do horizonte durante todo o período";
}

const ROTULOS = {
  iluminacao_solar: "Iluminação solar",
  noite_maxima: "Noite máxima tolerável",
  comunicacao_direta: "Comunicação direta com a Terra",
  declividade: "Declividade do local",
};

export function renderCards(res) {
  const m = res.metricas_resumo, v = m.viabilidade;
  $("card-verdict").dataset.state = v.decisao;
  $("verdict-text").textContent = v.decisao;
  $("verdict-checks").innerHTML =
    Object.entries(v.checks).filter(([, ok]) => ok !== null)
      .map(([k, ok]) => `<li class="${ok ? "ok" : "bad"}">${ROTULOS[k] || k}</li>`).join("") +
    v.nao_avaliado.map((k) => `<li>⚠ Não avaliado: ${ROTULOS[k] || k}</li>`).join("");

  $("m-sun-frac").textContent = pct(m.sol.fracao_visivel);
  $("m-sun-next").textContent = proximo(m.sol, "Nascer do Sol", "Pôr do Sol");
  $("m-earth-frac").textContent = pct(m.terra.fracao_visivel);
  $("m-earth-next").textContent = proximo(m.terra, "Terra nasce", "Ocaso da Terra");
  $("m-dark").textContent = fmtDuracao(m.sol.maior_oculto_horas * 60) || "0min";

  $("explainer").innerHTML =
    `Em <strong>${res.local}</strong>, o Sol fica no céu <strong>${pct(m.sol.fracao_visivel)}</strong> do tempo ` +
    `e a Terra é visível <strong>${pct(m.terra.fracao_visivel)}</strong> do tempo. ` +
    (v.decisao === "GO"
      ? "Isso é bom para gerar energia e falar direto com a Terra. ✅"
      : "Esse combo de local e data é difícil: falta luz, comunicação ou o terreno é inclinado demais. ⚠️");

  $("assumptions").innerHTML = m.premissas.map((p) => `<li>${p}</li>`).join("");
}

export function renderComparacao(lista) {
  const tabela = $("comp-table"), grafico = $("chart-compare");
  const tem = lista.length > 0;
  tabela.hidden = !tem; grafico.hidden = !tem; $("comp-empty").hidden = tem;
  if (!tem) return;

  tabela.tBodies[0].innerHTML = lista.map((r, i) => {
    const m = r.metricas_resumo;
    return `<tr>
      <td>${r.local}<br><small class="hint">${r.periodo.inicio} · ${r.periodo.dias}d</small></td>
      <td><span class="tag ${m.viabilidade.decisao}">${m.viabilidade.decisao}</span></td>
      <td>${pct(m.sol.fracao_visivel)}</td>
      <td>${pct(m.terra.fracao_visivel)}</td>
      <td class="only-engineer">${fmtDuracao(m.sol.maior_oculto_horas * 60) || "0min"}</td>
      <td><button class="x" data-i="${i}" aria-label="Remover ${r.local}">✕</button></td>
    </tr>`;
  }).join("");
}