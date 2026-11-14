/**
 * Camada assíncrona de comunicação com o Backend FastAPI (Skyfield + NumPy + NASA LOLA)
 */

const CONFIG = window.LUNAR_API_CONFIG || {
  BASE_URL: 'http://127.0.0.1:8000',
  ENDPOINTS: {
    SITES: '/api/sites',
    FASES: '/api/fases',
    VIAGEM: '/api/viagem',
    SIMULAR_POUSO: '/simular-pouso',
  },
};

export const PRESET_SITES = [
  { id: 'shackleton_rim', name: 'Shackleton Crater Rim (Peak of Eternal Light)', lat: -89.9, lon: 0.0, elevation_m: 1500 },
  { id: 'connecting_ridge', name: 'Connecting Ridge (Shackleton–de Gerlache)', lat: -89.45, lon: -137.5, elevation_m: 1850 },
  { id: 'malapert_massif', name: 'Malapert Massif', lat: -86.04, lon: -2.7, elevation_m: 4700 },
  { id: 'cabeus_crater', name: 'Cabeus Crater (Floor / PSR)', lat: -84.9, lon: -35.5, elevation_m: -2100 },
  { id: 'im1_nova_c', name: 'Malapert A (Pouso IM-1 Odysseus / Nova-C)', lat: -80.13, lon: 1.44, elevation_m: -650 },
  { id: 'nobile_rim', name: 'Nobile Crater Rim', lat: -85.2, lon: 53.5, elevation_m: 1200 },
  { id: 'apollo_11', name: 'Mare Tranquillitatis (Tranquility Base)', lat: 0.6741, lon: 23.473, elevation_m: -1850 },
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
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(`${CONFIG.BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return { data, source: 'online' };
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`[API Fallback] ${path} indisponível (${err.message}). Usando simulação offline.`);
    return { data: mockResolver(), source: 'mock-fallback' };
  }
}

/**
 * GET /api/sites
 * Retorna o catálogo oficial de locais mapeados no backend.
 */
export async function getSites() {
  return requestApi(
    CONFIG.ENDPOINTS.SITES,
    { method: 'GET' },
    () => ({ sites: PRESET_SITES })
  );
}

/**
 * GET /api/fases
 * Retorna ciclo sinódico e efemérides de fases lunares reais via skyfield.almanac.
 */
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
      fase_nome: 'Quarto Crescente (Sombras Longas para Pouso)',
      iluminacao_pct: 50.0,
    })
  );
}

/**
 * GET /api/viagem
 * Retorna vetores (X, Y, Z) reais de Sol, Terra, Lua e curva de transferência TLI (DE421).
 */
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
        earth_pos: { x: -3.1, y: 0, z: 0 },
        moon_pos: { x: 2.5, y: 0, z: 2.3 },
        tli_trajectory: trajectory,
      };
    }
  );
}

/**
 * POST /simular-pouso
 * Calcula declividade real (LOLA DEM), horizonte 360°, visibilidade Terra e GO/NO-GO.
 */
export async function simularPouso({
  site_id = 'shackleton_rim',
  site_name = 'Shackleton Crater Rim',
  lat = -89.9,
  lon = 0.0,
  start_date = '2027-03-01',
  days = 30,
  step_min = 60,
}) {
  const payload = { site_id, site_name, lat, lon, start_date, days, step_min };

  return requestApi(
    CONFIG.ENDPOINTS.SIMULAR_POUSO,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    () => ({
      site_id,
      site_name,
      lat,
      lon,
      start_date,
      days,
      step_min,
      slope_deg: 5.0,
      sun_fraction_pct: 85.0,
      earth_fraction_pct: 90.0,
      max_continuous_night_hours: 24.0,
      go_nogo: 'GO',
      horizon_profile: [],
      terrain_grid: null,
      timeline: [],
    })
  );
}