// frontend/js/api.js - comunicação com o backend FastAPI
const params = new URLSearchParams(location.search);
const BASE = params.get("api") || "";   // mesma origem por padrão
export const MOCK = params.has("mock"); // ?mock -> dados sintéticos (só para desenvolver o layout)

async function req(path, opts) {
  const r = await fetch(BASE + path, opts);
  if (!r.ok) {
    let detalhe = "";
    try { detalhe = (await r.json()).detail; } catch (_) { /* ignore */ }
    throw new Error(typeof detalhe === "string" && detalhe ? detalhe : `Erro ${r.status}`);
  }
  return r.json();
}

export async function listarSites() {
  if (MOCK) return MOCK_SITES;
  return (await req("/api/sites")).sites;
}

export async function simular(cenario) {
  if (MOCK) return mockSimular(cenario);
  return req("/api/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cenario),
  });
}

/* ---------- modo ?mock: dados FICTÍCIOS (não usar na apresentação) ---------- */
const MOCK_SITES = [
  { id: "shackleton_rim", nome: "Borda da Cratera Shackleton (Polo Sul)", lat: -89.9, lon: 0, elevacao_m: 2100 },
  { id: "malapert_massif", nome: "Maciço de Malapert", lat: -86, lon: 0, elevacao_m: 5000 },
  { id: "apollo_11", nome: "Mare Tranquillitatis (Apollo 11)", lat: 0.674, lon: 23.473, elevacao_m: -1800 },
];

function mockSimular(c) {
  const n = Math.floor((c.dias_simulacao * 1440) / c.passo_min) + 1;
  const t0 = Date.UTC(c.ano, c.mes - 1, c.dia);
  const s = { tempos: [], sol_elev: [], sol_az: [], terra_elev: [], terra_az: [], sol_visivel: [], terra_visivel: [] };
  for (let i = 0; i < n; i++) {
    const d = (i * c.passo_min) / 1440;
    s.tempos.push(new Date(t0 + i * c.passo_min * 60000).toISOString());
    s.sol_elev.push(1.5 * Math.sin((2 * Math.PI * d) / 29.5) + 0.8);
    s.sol_az.push(((d / 29.5) * 360) % 360);
    s.terra_elev.push(6 * Math.sin((2 * Math.PI * d) / 27.3) - 1);
    s.terra_az.push(((d / 27.3) * 360 + 90) % 360);
    s.sol_visivel.push(s.sol_elev[i] + 0.27 > 0);
    s.terra_visivel.push(s.terra_elev[i] + 0.95 > 0);
  }
  s.passo_min = c.passo_min;
  s.horizonte_perfil = { az: [0, 360], elev: [0.8, 0.8] };
  const corpo = (vis, el) => {
    const mud = vis.findIndex((v) => v !== vis[0]);
    let maior = 0, run = 0;
    vis.forEach((v) => { run = v ? 0 : run + 1; maior = Math.max(maior, run); });
    return {
      fracao_visivel: vis.filter(Boolean).length / n, elevacao_max_graus: Math.max(...el),
      visivel_agora: vis[0], minutos_ate_mudanca: mud < 0 ? null : mud * c.passo_min,
      maior_oculto_horas: (maior * c.passo_min) / 60, maior_visivel_horas: 0, janelas: [],
    };
  };
  const sol = corpo(s.sol_visivel, s.sol_elev), terra = corpo(s.terra_visivel, s.terra_elev);
  const checks = {
    iluminacao_solar: sol.fracao_visivel >= 0.5, noite_maxima: sol.maior_oculto_horas <= 120,
    comunicacao_direta: terra.fracao_visivel >= 0.4, declividade: null,
  };
  return {
    local: c.nome_local, site_id: c.site_id, coordenadas: { lat: c.lat, lon: c.lon, elevacao_m: c.elevacao_m },
    periodo: { inicio: `${c.ano}-${String(c.mes).padStart(2, "0")}-${String(c.dia).padStart(2, "0")}`, dias: c.dias_simulacao },
    metricas_resumo: {
      sol, terra, declividade_graus: null,
      viabilidade: {
        decisao: Object.values(checks).filter((v) => v !== null).every(Boolean) ? "GO" : "NO-GO",
        checks, nao_avaliado: ["declividade"],
      },
      premissas: ["DADOS SINTÉTICOS (modo ?mock) - não usar na apresentação"],
    },
    series_temporais: s,
  };
}