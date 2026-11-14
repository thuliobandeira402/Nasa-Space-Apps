/**
 * Camada de comunicação assíncrona com o backend FastAPI
 * Projeto: Lunar South Pole Lighting & Communication Tool
 */

const STORAGE_MOCK_KEY = 'lunar_tool_offline_mock';
const DEFAULT_TIMEOUT_MS = 8000;

// Detecta se o frontend está rodando separado do FastAPI (ex: Live Server) ou servido pelo próprio backend
const DEFAULT_BASE_URL =
  window.location.port && window.location.port !== '8000'
    ? 'http://127.0.0.1:8000/api'
    : '/api';

const apiState = {
  baseUrl: DEFAULT_BASE_URL,
  forceMock: localStorage.getItem(STORAGE_MOCK_KEY) === 'true',
  lastSource: 'online', // 'online' | 'mock-manual' | 'mock-fallback'
  statusListeners: new Set(),
};

// ============================================================================
// 1. CONTROLE DE AMBIENTE (TOGGLE OFFLINE MOCK & STATUS)
// ============================================================================

export function setApiBaseUrl(url) {
  apiState.baseUrl = url.replace(/\/+$/, '');
}

export function isMockMode() {
  return apiState.forceMock;
}

export function setMockMode(enabled) {
  apiState.forceMock = Boolean(enabled);
  localStorage.setItem(STORAGE_MOCK_KEY, String(apiState.forceMock));
  notifyStatus(apiState.forceMock ? 'mock-manual' : 'online');
  return apiState.forceMock;
}

export function toggleMockMode() {
  return setMockMode(!apiState.forceMock);
}

export function getLastDataSource() {
  return apiState.lastSource;
}

export function onApiStatusChange(callback) {
  apiState.statusListeners.add(callback);
  return () => apiState.statusListeners.delete(callback);
}

function notifyStatus(source, error = null) {
  apiState.lastSource = source;
  apiState.statusListeners.forEach((listener) => {
    try {
      listener({ source, forceMock: apiState.forceMock, error });
    } catch (err) {
      console.error('[API Status Listener Error]:', err);
    }
  });
}

// ============================================================================
// 2. DADOS MOCK JSON (FALLBACK OFFLINE — POLO SUL LUNAR)
// ============================================================================

const MOCK_SITES = [
  {
    id: 'shackleton_rim',
    name: 'Shackleton Crater Rim',
    lat: -89.9,
    lon: 0.0,
    elevation_m: 4200,
    region: 'Shackleton',
    description: 'Borda elevada com alta incidência solar anual e linha de visada favorável para a Terra.',
  },
  {
    id: 'connecting_ridge',
    name: 'Connecting Ridge (Shackleton–de Gerlache)',
    lat: -89.45,
    lon: 222.5,
    elevation_m: 4510,
    region: 'Connecting Ridge',
    description: 'Crista de ligação entre Shackleton e de Gerlache, candidata prioritária Artemis.',
  },
  {
    id: 'malapert_massif',
    name: 'Malapert Massif',
    lat: -86.0,
    lon: 0.0,
    elevation_m: 5000,
    region: 'Malapert',
    description: 'Maciço elevado ideal para retransmissão contínua de comunicações Terra-Lua.',
  },
  {
    id: 'de_gerlache_rim',
    name: 'de Gerlache Crater Rim',
    lat: -88.5,
    lon: 271.0,
    elevation_m: 3950,
    region: 'de Gerlache',
    description: 'Borda adjacente a regiões permanentemente sombreadas (PSRs) com potencial de gelo de água.',
  },
];

function generateMockTimeline(siteId, startDateIso, durationHours = 168, passoHoras = 6) {
  const site = MOCK_SITES.find((s) => s.id === siteId) || MOCK_SITES[0];
  const startMs = startDateIso ? new Date(startDateIso).getTime() : Date.now();
  const steps = Math.max(1, Math.floor(durationHours / passoHoras));
  const series = [];

  // Fase baseada na longitude do local para diferenciar os cenários
  const phaseOffset = (site.lon * Math.PI) / 180;

  for (let i = 0; i <= steps; i++) {
    const elapsedHours = i * passoHoras;
    const timestamp = new Date(startMs + elapsedHours * 3600 * 1000).toISOString();

    // Ciclo sinódico lunar (~708.7h) simulado para elevação solar e visibilidade da Terra
    const solarAngle = (2 * Math.PI * elapsedHours) / 708.7 + phaseOffset;
    const sunElevationDeg = Number((Math.sin(solarAngle) * 4.2 + 1.1).toFixed(2));
    const illuminated = sunElevationDeg > 0;

    const earthAngle = (2 * Math.PI * elapsedHours) / 655.7 + phaseOffset * 0.5;
    const earthElevationDeg = Number((Math.cos(earthAngle) * 6.5 + 2.0).toFixed(2));
    const commAvailable = earthElevationDeg > 0;

    series.push({
      timestamp,
      elapsed_hours: elapsedHours,
      sun_elevation_deg: sunElevationDeg,
      illuminated,
      earth_elevation_deg: earthElevationDeg,
      comm_available: commAvailable,
      operational_window: illuminated && commAvailable,
    });
  }

  const totalPoints = series.length;
  const sunHours = series.filter((p) => p.illuminated).length * passoHoras;
  const commHours = series.filter((p) => p.comm_available).length * passoHoras;
  const overlapHours = series.filter((p) => p.operational_window).length * passoHoras;

  return {
    site_id: site.id,
    site_name: site.name,
    passo_horas: passoHoras,
    summary: {
      illumination_pct: Number(((sunHours / (totalPoints * passoHoras)) * 100).toFixed(1)),
      comm_availability_pct: Number(((commHours / (totalPoints * passoHoras)) * 100).toFixed(1)),
      simultaneous_window_hours: overlapHours,
    },
    timeline: series,
  };
}

// ============================================================================
// 3. NÚCLEO FETCH ASSÍNCRONO COM TIMEOUT E FALLBACK AUTOMÁTICO
// ============================================================================

async function requestWithFallback(endpoint, options = {}, mockResolver) {
  // 1. Se o toggle manual estiver ativo, retorna o mock imediatamente
  if (apiState.forceMock) {
    notifyStatus('mock-manual');
    const data = await mockResolver();
    return { data, source: 'mock-manual' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${apiState.baseUrl}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errBody = await response.json();
        errorDetail = errBody.detail || JSON.stringify(errBody);
      } catch {
        // Ignora erro de parse caso a resposta não seja JSON
      }
      throw new Error(`Falha na API (${endpoint}): ${errorDetail}`);
    }

    const data = await response.json();
    notifyStatus('online');
    return { data, source: 'online' };
  } catch (error) {
    clearTimeout(timeoutId);
    console.warn(`[API Fallback] Backend indisponível em ${endpoint}. Usando mock JSON.`, error.message);
    notifyStatus('mock-fallback', error);

    const data = await mockResolver();
    return { data, source: 'mock-fallback' };
  }
}

// ============================================================================
// 4. ENDPOINTS DO PROJETO (CONTRATO FASTAPI)
// ============================================================================

/**
 * GET /api/sites
 * Lista os locais de pouso disponíveis no Polo Sul lunar.
 */
export async function getSites() {
  return requestWithFallback(
    '/sites',
    { method: 'GET' },
    async () => ({ sites: MOCK_SITES })
  );
}

/**
 * POST /api/simulate
 * Simula iluminação solar e comunicação direta com a Terra para um cenário.
 */
export async function simulateScenario({
  site_id,
  start_date,
  duration_hours = 168,
  passo_horas = 6,
  usar_topografia = true,
}) {
  const payload = {
    site_id,
    start_date,
    duration_hours,
    passo_horas,
    usar_topografia,
  };

  return requestWithFallback(
    '/simulate',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    async () => generateMockTimeline(site_id, start_date, duration_hours, passo_horas)
  );
}

/**
 * POST /api/compare
 * Compara N cenários simultâneos (MOD-01).
 */
export async function compareScenarios({
  scenarios = [],
  start_date,
  duration_hours = 168,
  passo_horas = 6,
  usar_topografia = true,
}) {
  const payload = {
    scenarios,
    start_date,
    duration_hours,
    passo_horas,
    usar_topografia,
  };

  return requestWithFallback(
    '/compare',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    async () => {
      const targetIds = scenarios.length > 0
        ? scenarios.map((item) => (typeof item === 'string' ? item : item.site_id))
        : ['shackleton_rim', 'connecting_ridge'];

      const results = targetIds.map((id) =>
        generateMockTimeline(id, start_date, duration_hours, passo_horas)
      );

      return {
        passo_horas,
        total_scenarios: results.length,
        results,
      };
    }
  );
}