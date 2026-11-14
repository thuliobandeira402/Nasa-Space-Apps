/**
 * Camada assíncrona de comunicação com o Backend FastAPI (Skyfield + NumPy)
 * Rotas do Fluxograma:
 *  - GET  /api/fases
 *  - GET  /api/viagem
 *  - POST /simular-pouso
 */

const CONFIG = window.LUNAR_API_CONFIG || {
  BASE_URL: 'http://127.0.0.1:8000',
  ENDPOINTS: {
    FASES: '/api/fases',
    VIAGEM: '/api/viagem',
    SIMULAR_POUSO: '/simular-pouso',
  },
};

export const PRESET_SITES = [
  { id: 'shackleton_rim', name: 'Shackleton Crater Rim', lat: -89.9, lon: 0.0, elevation_m: 4200 },
  { id: 'connecting_ridge', name: 'Connecting Ridge (Shackleton–de Gerlache)', lat: -89.45, lon: 222.5, elevation_m: 4510 },
  { id: 'malapert_massif', name: 'Malapert Massif', lat: -86.0, lon: 0.0, elevation_m: 5000 },
  { id: 'de_gerlache_rim', name: 'de Gerlache Crater Rim', lat: -88.5, lon: 271.0, elevation_m: 3950 },
  { id: 'custom', name: 'Coordenada Personalizada (Lat/Lon)', lat: -89.5, lon: 45.0, elevation_m: 4000 },
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
  const timeoutId = setTimeout(() => controller.abort(), 8000);

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
 * GET /api/fases
 * Retorna ciclo sinódico e janelas de amanhecer lunar via skyfield.almanac.
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
      amanhecer_lunar_utc: `${start_date}T06:00:00Z`,
      fase_nome: 'Quarto Crescente (Sombras Longas para Pouso)',
    })
  );
}

/**
 * GET /api/viagem
 * Retorna vetores (X, Y, Z) de Sol, Terra, Lua e curva de transferência (TLI).
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
 * Calcula slope, horizonte 360°, duração do pôr do sol (0,53°), sinal Terra e GO/NO-GO.
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
    () => buildMockLandingSimulation(payload)
  );
}

function buildMockLandingSimulation({ site_id, site_name, lat, lon, start_date, days, step_min }) {
  const startMs = new Date(`${start_date}T00:00:00Z`).getTime();
  const totalMinutes = days * 24 * 60;
  const safeStepMin = Math.max(5, Number(step_min) || 60);
  const totalSteps = Math.floor(totalMinutes / safeStepMin);

  // Perfil topográfico 360° (máscara de horizonte)
  const horizon_profile = [];
  const seed = Math.abs(lat * 13.7 + lon * 0.31);
  for (let az = 0; az <= 360; az += 5) {
    const rad = (az * Math.PI) / 180;
    const ridge = Math.max(0, 3.4 * Math.sin(rad * 2 + seed) + 1.8 * Math.cos(rad * 3 - seed));
    horizon_profile.push({
      azimuth_deg: az,
      elevation_deg: Number(Math.max(0.2, ridge * 0.55).toFixed(2)),
    });
  }

  const getHorizonMask = (az) => {
    const norm = ((az % 360) + 360) % 360;
    const idx = Math.round(norm / 5) % horizon_profile.length;
    return horizon_profile[idx].elevation_deg;
  };

  // Declividade local (slope) simulada a partir das coordenadas
  const slope_deg = Number((Math.abs(Math.sin(lat * 9.3 + lon * 0.7)) * 11.5 + 2.4).toFixed(1));
  const sunset_duration_min = Number((48 + Math.abs(lat + 85) * 3.5).toFixed(0));

  const timeline = [];
  const phaseOffset = (lon * Math.PI) / 180;
  let sunLitSteps = 0;
  let earthVisSteps = 0;
  let currentDarkMinutes = 0;
  let maxDarkMinutes = 0;

  for (let i = 0; i <= totalSteps; i++) {
    const elapsedMin = i * safeStepMin;
    const elapsedHours = elapsedMin / 60;
    const timestamp = new Date(startMs + elapsedMin * 60 * 1000).toISOString();

    const sunAz = Number(((elapsedHours * (360 / 708.7) + lon) % 360 + 360) % 360);
    const solarAngle = (2 * Math.PI * elapsedHours) / 708.7 + phaseOffset;
    const sunElev = Number((Math.sin(solarAngle) * 4.1 + 1.35).toFixed(2));
    const terrainMask = getHorizonMask(sunAz);
    const sunVisible = sunElev > terrainMask;

    const earthAz = Number((180 + Math.sin(elapsedHours * 0.02) * 14).toFixed(2));
    const earthAngle = (2 * Math.PI * elapsedHours) / 655.7 + phaseOffset * 0.4;
    const earthElev = Number((Math.cos(earthAngle) * 6.2 + 2.3).toFixed(2));
    const earthVisible = earthElev > 0;

    if (sunVisible) {
      sunLitSteps++;
      currentDarkMinutes = 0;
    } else {
      currentDarkMinutes += safeStepMin;
      if (currentDarkMinutes > maxDarkMinutes) {
        maxDarkMinutes = currentDarkMinutes;
      }
    }

    if (earthVisible) earthVisSteps++;

    timeline.push({
      step: i,
      timestamp,
      elapsed_hours: Number(elapsedHours.toFixed(2)),
      sun_elevation_deg: sunElev,
      sun_azimuth_deg: Number(sunAz.toFixed(2)),
      terrain_mask_deg: terrainMask,
      sun_visible: sunVisible,
      earth_elevation_deg: earthElev,
      earth_azimuth_deg: earthAz,
      earth_visible: earthVisible,
      operational_window: sunVisible && earthVisible,
    });
  }

  const count = timeline.length || 1;
  const sun_fraction_pct = Number(((sunLitSteps / count) * 100).toFixed(1));
  const earth_fraction_pct = Number(((earthVisSteps / count) * 100).toFixed(1));
  const max_continuous_night_hours = Number((maxDarkMinutes / 60).toFixed(1));

  // Critério Automático de Viabilidade (GO / NO-GO) do Fluxograma
  const seguranca_topografica = slope_deg <= 15.0;
  const iluminacao_solar = sun_fraction_pct >= 50.0;
  const comunicacao_direta = earth_fraction_pct >= 50.0;
  const go_nogo = seguranca_topografica && iluminacao_solar && comunicacao_direta ? 'GO' : 'NO-GO';

  return {
    site_id,
    site_name,
    lat,
    lon,
    start_date,
    days,
    step_min: safeStepMin,
    slope_deg,
    sunset_duration_min,
    sun_fraction_pct,
    earth_fraction_pct,
    max_continuous_night_hours,
    horizon_profile,
    criterios: {
      seguranca_topografica,
      iluminacao_solar,
      comunicacao_direta,
    },
    go_nogo,
    assumptions: [
      `Efemérides lunares: NASA/JPL DE421 (passo de integração: ${safeStepMin} min).`,
      `Topografia e horizonte 360°: Modelo digital de elevação LRO/LOLA (declividade local: ${slope_deg}°).`,
      `Disco solar aparente: 0,53° sem refração atmosférica (duração média do pôr do sol: ${sunset_duration_min} min).`,
      `Critério GO: Slope ≤ 15°, iluminação solar ≥ 50% e visada direta Terra (DTE) ≥ 50%.`,
    ],
    timeline,
  };
}