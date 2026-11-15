/**
 * Camada Assíncrona de API para o Backend FastAPI (Skyfield SPICE + NumPy + NASA LOLA)
 */

const CONFIG = window.LUNAR_API_CONFIG || {
  BASE_URL: window.location.port && window.location.port !== '8000' ? 'http://127.0.0.1:8000' : '',
  ENDPOINTS: {
    SITES: '/api/sites',
    FASES: '/api/fases',
    VIAGEM: '/api/viagem',
    SIMULAR_POUSO: '/simular-pouso',
  },
};

export const PRESET_SITES = [
  {
    id: 'shackleton_rim',
    name: 'Shackleton Crater Rim (Peak of Eternal Light)',
    lat: -89.9,
    lon: 0.0,
    elevation_m: 1500,
    mission_context: 'Artemis III — Região Candidata de Pouso',
    scientific_highlight: 'Borda elevada com iluminação quase contínua adjacente a PSRs com gelo de água.',
  },
  {
    id: 'connecting_ridge',
    name: 'Connecting Ridge (Shackleton–de Gerlache)',
    lat: -89.45,
    lon: -137.5,
    elevation_m: 1850,
    mission_context: 'Artemis III — Zona Prioritária de Energia Solar',
    scientific_highlight: 'Crista topográfica entre Shackleton e de Gerlache; um dos pontos mais iluminados da Lua.',
  },
  {
    id: 'malapert_massif',
    name: 'Malapert Massif',
    lat: -86.04,
    lon: -2.7,
    elevation_m: 4700,
    mission_context: 'Artemis III / Estação de Retransmissão Lunar',
    scientific_highlight: 'Maciço de ~4,7 km de altitude ideal para torres de relé e painéis solares.',
  },
  {
    id: 'cabeus_crater',
    name: 'Cabeus Crater (Floor / PSR)',
    lat: -84.9,
    lon: -35.5,
    elevation_m: -2100,
    mission_context: 'NASA LCROSS Impact Site (2009)',
    scientific_highlight: 'Região Permanentemente Sombreada (PSR) com depósitos confirmados de gelo de água.',
  },
  {
    id: 'im1_nova_c',
    name: 'Malapert A (Pouso IM-1 Odysseus / Nova-C)',
    lat: -80.13,
    lon: 1.44,
    elevation_m: -650,
    mission_context: 'NASA CLPS / Intuitive Machines IM-1 (2024)',
    scientific_highlight: 'Primeiro pouso comercial próximo ao Polo Sul lunar na era Artemis.',
  },
  {
    id: 'nobile_rim',
    name: 'Nobile Crater Rim',
    lat: -85.2,
    lon: 53.5,
    elevation_m: 1200,
    mission_context: 'NASA VIPER / Artemis Candidate Region',
    scientific_highlight: 'Borda acessível para rovers explorarem áreas sombreadas vizinhas.',
  },
  {
    id: 'apollo_11',
    name: 'Mare Tranquillitatis (Tranquility Base)',
    lat: 0.6741,
    lon: 23.473,
    elevation_m: -1850,
    mission_context: 'NASA Apollo 11 (1969)',
    scientific_highlight: 'Referência equatorial: ciclo rígido de ~14 dias de luz e ~14 dias de noite lunar.',
  },
];

let forceOfflineMock = false;

export function setOfflineMock(enabled) {
  forceOfflineMock = Boolean(enabled);
  return forceOfflineMock;
}

export function isOfflineMock() {
  return forceOfflineMock;
}

async function requestApi(path, options = {}, mockResolver) {
  if (forceOfflineMock) {
    return { data: mockResolver(), source: 'mock-manual' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${CONFIG.BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const errBody = await response.json();
        if (errBody?.detail) detail = errBody.detail;
      } catch (_) {}
      throw new Error(detail);
    }

    const data = await response.json();
    return { data, source: 'online' };
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`[API Fallback] ${path} indisponível (${err.message}). Usando contingência offline.`);
    return { data: mockResolver(), source: 'mock-fallback' };
  }
}

export async function getSites() {
  return requestApi(
    CONFIG.ENDPOINTS.SITES || '/api/sites',
    { method: 'GET' },
    () => ({ sites: PRESET_SITES })
  );
}

export async function getFases({ start_date, days = 30, lat = -89.9, lon = 0.0 }) {
  const params = new URLSearchParams({
    start_date,
    days: String(days),
    lat: String(lat),
    lon: String(lon),
  });

  return requestApi(
    `${CONFIG.ENDPOINTS.FASES}?${params.toString()}`,
    { method: 'GET' },
    () => ({
      ciclo_sinodico_dias: 29.53,
      fase_nome: 'Quarto Crescente (50.0% iluminada)',
      iluminacao_pct: 50.0,
    })
  );
}

export async function getViagem({ start_date, duration_days = 4 }) {
  const params = new URLSearchParams({
    start_date,
    duration_days: String(duration_days),
  });

  return requestApi(
    `${CONFIG.ENDPOINTS.VIAGEM}?${params.toString()}`,
    { method: 'GET' },
    () => {
      const trajectory = [];
      for (let i = 0; i <= 48; i++) {
        const t = i / 48;
        const angle = t * Math.PI * 0.88;
        trajectory.push({
          step: i,
          x: Number((Math.cos(angle) * 6.2 - 3.1).toFixed(3)),
          y: Number((Math.sin(angle * 2) * 0.9).toFixed(3)),
          z: Number((Math.sin(angle) * 5.8).toFixed(3)),
        });
      }

      return {
        distancia_terra_lua_km: 384400.0,
        earth_pos: { x: -3.2, y: 0, z: 0 },
        moon_pos: { x: 2.6, y: 0, z: 2.3 },
        tli_trajectory: trajectory,
      };
    }
  );
}

export async function simularPouso({
  site_id = 'shackleton_rim',
  site_name = 'Shackleton Crater Rim',
  lat = -89.9,
  lon = 0.0,
  elevacao_m = null,
  start_date = '2026-12-20',
  days = 30,
  step_min = 60,
  usar_topografia = true,
}) {
  const payload = {
    site_id: site_id === 'custom' ? null : site_id,
    site_name,
    lat,
    lon,
    elevacao_m,
    start_date,
    days,
    step_min,
    usar_topografia,
  };

  return requestApi(
    CONFIG.ENDPOINTS.SIMULAR_POUSO,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    () => {
      const baseMs = new Date(`${start_date}T00:00:00Z`).getTime();
      const timeline = Array.from({ length: 25 }, (_, i) => ({
        step: i,
        timestamp: new Date(baseMs + i * 3600000).toISOString(),
        elapsed_hours: i,
        sun_elevation_deg: 1.2,
        sun_azimuth_deg: (i * 15) % 360,
        terrain_mask_deg: 0.4,
        sun_visible: true,
        earth_elevation_deg: 4.5,
        earth_azimuth_deg: 10,
        earth_visible: true,
        operational_window: true,
      }));
      const horizon_profile = Array.from({ length: 73 }, (_, i) => ({
        azimuth_deg: i * 5,
        elevation_deg: 0.4,
      }));

      return {
        site_id: payload.site_id,
        site_name,
        lat,
        lon,
        start_date,
        days,
        step_min: 60,
        slope_deg: 5.0,
        sun_fraction_pct: 85.0,
        earth_fraction_pct: 90.0,
        max_continuous_night_hours: 24,
        go_nogo: 'GO',
        veredito_backend: 'VIÁVEL (MODO OFFLINE)',
        criterios: {
          seguranca_topografica: true,
          iluminacao_solar: true,
          comunicacao_direta: true,
        },
        horizon_profile,
        terrain_grid: null,
        timeline,
        assumptions: ['Modo de contingência offline ativo (servidor FastAPI indisponível).'],
      };
    }
  );
}