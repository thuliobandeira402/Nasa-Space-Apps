/**
 * Camada de comunicação REST com o Backend FastAPI (Skyfield + NumPy)
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

let forceOfflineMock = false;

export function setOfflineMock(enabled) {
  forceOfflineMock = Boolean(enabled);
}

export function isOfflineMock() {
  return forceOfflineMock;
}

async function requestApi(path, options = {}, mockFn) {
  if (forceOfflineMock) {
    return { data: mockFn(), source: 'mock' };
  }

  try {
    const response = await fetch(`${CONFIG.BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return { data, source: 'online' };
  } catch (err) {
    console.warn(`[Fallback Mock] Rota ${path} indisponível (${err.message}).`);
    return { data: mockFn(), source: 'mock-fallback' };
  }
}

/**
 * GET /api/fases
 * Retorna ciclo sinódico e janelas de amanhecer lunar (sombras longas para pouso).
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
      iluminacao_atual_pct: 68.4,
      fase_nome: 'Quarto Crescente (Sombras Longas Ideais)',
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
      // Gera 40 pontos de trajetória Terra -> Lua (TLI)
      const trajectory = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const angle = t * Math.PI * 0.85;
        trajectory.push({
          step: i,
          x: Number((Math.cos(angle) * 6 - 3).toFixed(3)),
          y: Number((Math.sin(angle * 2) * 1.1).toFixed(3)),
          z: Number((Math.sin(angle) * 6).toFixed(3)),
        });
      }
      return {
        earth_pos: { x: -3, y: 0, z: 0 },
        moon_pos: { x: 2.3, y: 0, z: 2.8 },
        tli_trajectory: trajectory,
      };
    }
  );
}

/**
 * POST /simular-pouso
 * Calcula slope, horizonte 360°, duração do pôr do sol (0,53°) e sinal Terra + GO/NO-GO.
 */
export async function simularPouso({ site_name, lat, lon, start_date, days = 30 }) {
  const payload = { site_name, lat, lon, start_date, days };

  return requestApi(
    CONFIG.ENDPOINTS.SIMULAR_POUSO,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    () => {
      const slopeDeg = Number((Math.abs(Math.sin(lat * 10 + lon)) * 12 + 2.1).toFixed(1));
      const timeline = [];
      const totalSteps = days * 4; // passo de 6h

      for (let i = 0; i <= totalSteps; i++) {
        const hours = i * 6;
        const sunElev = Number((Math.sin((2 * Math.PI * hours) / 708.7 + lon) * 3.8 + 1.2).toFixed(2));
        const earthElev = Number((Math.cos((2 * Math.PI * hours) / 655.7) * 5.5 + 2.4).toFixed(2));
        timeline.push({
          step: i,
          hours,
          sun_elevation_deg: sunElev,
          earth_elevation_deg: earthElev,
          sunset_duration_min: 52,
          dte_signal_ok: earthElev > 0,
        });
      }

      const topografiaOk = slopeDeg <= 15.0;
      const iluminacaoOk = timeline[0].sun_elevation_deg > 0;
      const comunicacaoOk = timeline[0].dte_signal_ok;

      return {
        site_name: site_name || `Lat ${lat}°, Lon ${lon}°`,
        lat,
        lon,
        slope_deg: slopeDeg,
        sunset_duration_min: 52,
        criterios: {
          seguranca_topografica: topografiaOk,
          iluminacao_solar: iluminacaoOk,
          comunicacao_direta: comunicacaoOk,
        },
        go_nogo: topografiaOk && iluminacaoOk && comunicacaoOk ? 'GO' : 'NO-GO',
        timeline,
      };
    }
  );
}