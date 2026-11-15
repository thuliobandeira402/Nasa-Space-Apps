/**
 * Async API Layer for FastAPI Backend (NASA/JPL SPICE + NASA LRO/LOLA)
 * Zero mock data: every simulation comes directly from the scientific backend.
 */

const CONFIG = window.LUNAR_API_CONFIG || {
  BASE_URL: window.location.port && window.location.port !== '8000' ? 'http://127.0.0.1:8000' : '',
  ENDPOINTS: {
    SITES: '/api/sites',
    FASES: '/api/fases',
    VIAGEM: '/api/viagem',
    SIMULAR_POUSO: '/simular-pouso',
    LOLA_POLAR_MAP: '/api/lola-polar-map',
  },
};

export const PRESET_SITES = [
  { id: 'shackleton_rim', name: 'Shackleton Crater Rim (Peak of Eternal Light)', lat: -89.9, lon: 0.0, elevation_m: 1500 },
  { id: 'connecting_ridge', name: 'Connecting Ridge (Shackleton–de Gerlache)', lat: -89.45, lon: -137.5, elevation_m: 1850 },
  { id: 'malapert_massif', name: 'Malapert Massif', lat: -86.04, lon: -2.7, elevation_m: 4700 },
  { id: 'cabeus_crater', name: 'Cabeus Crater (Floor / PSR)', lat: -84.9, lon: -35.5, elevation_m: -2100 },
  { id: 'im1_nova_c', name: 'Malapert A (IM-1 Odysseus / Nova-C)', lat: -80.13, lon: 1.44, elevation_m: -650 },
  { id: 'nobile_rim', name: 'Nobile Crater Rim', lat: -85.2, lon: 53.5, elevation_m: 1200 },
  { id: 'apollo_11', name: 'Mare Tranquillitatis (Tranquility Base)', lat: 0.6741, lon: 23.473, elevation_m: -1850 },
];

export function getLolaPolarMapUrl() {
  return `${CONFIG.BASE_URL}${CONFIG.ENDPOINTS.LOLA_POLAR_MAP || '/api/lola-polar-map'}`;
}

async function requestApi(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${CONFIG.BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody.detail || `Backend HTTP ${response.status}`);
    }

    const data = await response.json();
    return { data, source: 'online' };
  } catch (err) {
    throw new Error(`FastAPI Backend unreachable (${err.message}). Ensure uvicorn is running on port 8000.`);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getSites() {
  return requestApi(CONFIG.ENDPOINTS.SITES, { method: 'GET' });
}

export async function getFases({ start_date, days = 30, lat = -89.9, lon = 0.0 }) {
  const params = new URLSearchParams({
    start_date,
    days: String(days),
    lat: String(lat),
    lon: String(lon),
  });
  return requestApi(`${CONFIG.ENDPOINTS.FASES}?${params.toString()}`, { method: 'GET' });
}

export async function getViagem({ start_date, duration_days = 4 }) {
  const params = new URLSearchParams({
    start_date,
    duration_days: String(duration_days),
  });
  return requestApi(`${CONFIG.ENDPOINTS.VIAGEM}?${params.toString()}`, { method: 'GET' });
}

export async function simularPouso({
  site_id = 'shackleton_rim',
  site_name = 'Shackleton Crater Rim',
  lat = -89.9,
  lon = 0.0,
  elevacao_m = null,
  start_date = '2027-03-01',
  days = 30,
  step_min = 60,
  usar_topografia = true,
}) {
  return requestApi(CONFIG.ENDPOINTS.SIMULAR_POUSO, {
    method: 'POST',
    body: JSON.stringify({
      site_id,
      site_name,
      lat,
      lon,
      elevacao_m,
      start_date,
      days,
      step_min,
      usar_topografia,
    }),
  });
}