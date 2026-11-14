import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import * as THREE from 'three';
import { getFases, getViagem, simularPouso, setOfflineMock, isOfflineMock } from './api.js';

const html = htm.bind(React.createElement);

const PRESET_SITES = [
  { id: 'shackleton', name: 'Shackleton Crater Rim', lat: -89.9, lon: 0.0 },
  { id: 'connecting_ridge', name: 'Connecting Ridge', lat: -89.45, lon: 222.5 },
  { id: 'malapert', name: 'Malapert Massif', lat: -86.0, lon: 0.0 },
  { id: 'de_gerlache', name: 'de Gerlache Rim', lat: -88.5, lon: 271.0 },
];

// ============================================================================
// COMPONENTE CENA 3D (THREE.JS) — MODOS: VIAGEM | GLOBO 3D | SUPERFÍCIE
// ============================================================================
function LunarViewport3D({ mode, timeIndex, viagemData, pousoData }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 700;
    const height = container.clientHeight || 420;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#060913');

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Luz ambiente + Luz Solar direcional dinâmica conforme o Slider de Tempo
    const ambientLight = new THREE.AmbientLight(0x334155, 0.7);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfffbeb, 2.4);
    const currentStep = pousoData?.timeline?.[timeIndex] || { sun_elevation_deg: 2, earth_elevation_deg: 4 };
    const sunRad = THREE.MathUtils.degToRad(Math.max(-10, currentStep.sun_elevation_deg) * 4);
    sunLight.position.set(Math.cos(sunRad) * 15, Math.sin(sunRad) * 15 + 2, 8);
    scene.add(sunLight);

    let animId;
    const dynamicObjects = [];

    if (mode === 'viagem') {
      // MODO 1: VIAGEM — Trajetória orbital Terra -> Lua (TLI)
      camera.position.set(0, 6.5, 11);
      camera.lookAt(0, 0, 1);

      const earthGeo = new THREE.SphereGeometry(1.1, 32, 32);
      const earthMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.5 });
      const earthMesh = new THREE.Mesh(earthGeo, earthMat);
      earthMesh.position.set(-3, 0, 0);
      scene.add(earthMesh);

      const moonGeo = new THREE.SphereGeometry(0.45, 24, 24);
      const moonMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.9 });
      const moonMesh = new THREE.Mesh(moonGeo, moonMat);
      moonMesh.position.set(2.3, 0, 2.8);
      scene.add(moonMesh);

      const pts = (viagemData?.tli_trajectory || []).map((p) => new THREE.Vector3(p.x, p.y, p.z));
      if (pts.length > 1) {
        const curveGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const curveMat = new THREE.LineBasicMaterial({ color: 0x38bdf8 });
        scene.add(new THREE.Line(curveGeo, curveMat));

        // Sonda posicionada conforme o Slider de Tempo
        const probeIdx = Math.min(pts.length - 1, Math.floor((timeIndex / 120) * pts.length));
        const probeMesh = new THREE.Mesh(
          new THREE.ConeGeometry(0.14, 0.4, 12),
          new THREE.MeshBasicMaterial({ color: 0xfbbf24 })
        );
        probeMesh.position.copy(pts[probeIdx]);
        scene.add(probeMesh);
      }

      dynamicObjects.push(earthMesh, moonMesh);
    } else if (mode === 'globo') {
      // MODO 2: GLOBO 3D — Relevo NASA LOLA e sombras solares
      camera.position.set(0, -3.2, 5.2);
      camera.lookAt(0, 0, 0);

      const globeGeo = new THREE.SphereGeometry(2.3, 64, 64);
      const globeMat = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.95,
        metalness: 0.05,
        wireframe: false,
      });
      const globeMesh = new THREE.Mesh(globeGeo, globeMat);
      scene.add(globeMesh);

      // Marcador do sítio no Polo Sul
      const latRad = THREE.MathUtils.degToRad(pousoData?.lat ?? -89.9);
      const lonRad = THREE.MathUtils.degToRad(pousoData?.lon ?? 0);
      const r = 2.34;
      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 16, 16),
        new THREE.MeshBasicMaterial({ color: pousoData?.go_nogo === 'GO' ? 0x10b981 : 0xef4444 })
      );
      pin.position.set(
        r * Math.cos(latRad) * Math.cos(lonRad),
        r * Math.sin(latRad),
        r * Math.cos(latRad) * Math.sin(lonRad)
      );
      globeMesh.add(pin);
      dynamicObjects.push(globeMesh);
    } else {
      // MODO 3: SUPERFÍCIE — Horizonte local, Sol, Terra e Lander
      camera.position.set(0, 2.4, 6.2);
      camera.lookAt(0, 0.4, 0);

      const terrainGeo = new THREE.PlaneGeometry(14, 14, 36, 36);
      const pos = terrainGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const dist = Math.sqrt(x * x + y * y);
        const crater = Math.sin(dist * 1.3) * 0.35 + Math.cos(x * 1.1) * 0.15;
        pos.setZ(i, crater);
      }
      terrainGeo.computeVertexNormals();

      const terrainMesh = new THREE.Mesh(
        terrainGeo,
        new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.95, flatShading: true })
      );
      terrainMesh.rotation.x = -Math.PI / 2;
      scene.add(terrainMesh);

      // Módulo de Pouso (Lander) no centro
      const lander = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.28, 0.45, 16),
        new THREE.MeshStandardMaterial({
          color: pousoData?.go_nogo === 'GO' ? 0x10b981 : 0xf59e0b,
          emissive: 0x111827,
        })
      );
      lander.position.set(0, 0.35, 0);
      scene.add(lander);
    }

    const animate = () => {
      animId = requestAnimationFrame(animate);
      dynamicObjects.forEach((obj) => {
        obj.rotation.y += 0.002;
      });
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [mode, timeIndex, viagemData, pousoData]);

  return html`<div ref=${mountRef} className="w-full h-[420px] rounded-xl overflow-hidden border border-slate-800"></div>`;
}

// ============================================================================
// APLICAÇÃO PRINCIPAL REACT
// ============================================================================
function LunarSimulatorApp() {
  const [selectedSite, setSelectedSite] = useState(PRESET_SITES[0]);
  const [lat, setLat] = useState(-89.9);
  const [lon, setLon] = useState(0.0);
  const [startDate, setStartDate] = useState('2027-03-01');
  const [days, setDays] = useState(30);

  const [viewMode, setViewMode] = useState('superficie'); // 'viagem' | 'globo' | 'superficie'
  const [timeIndex, setTimeIndex] = useState(0);
  const [offline, setOffline] = useState(isOfflineMock());

  const [fasesData, setFasesData] = useState(null);
  const [viagemData, setViagemData] = useState(null);
  const [pousoData, setPousoData] = useState(null);
  const [comparedSites, setComparedSites] = useState([]);
  const [loading, setLoading] = useState(false);

  async function runFullSimulation(e) {
    if (e) e.preventDefault();
    setLoading(true);

    const [resFases, resViagem, resPouso] = await Promise.all([
      getFases({ start_date: startDate, days, lat, lon }),
      getViagem({ start_date: startDate, duration_days: 4 }),
      simularPouso({ site_name: selectedSite.name, lat, lon, start_date: startDate, days }),
    ]);

    setFasesData(resFases.data);
    setViagemData(resViagem.data);
    setPousoData(resPouso.data);
    setTimeIndex(0);
    setLoading(false);
  }

  useEffect(() => {
    runFullSimulation();
  }, []);

  function handleSelectPreset(siteId) {
    const found = PRESET_SITES.find((s) => s.id === siteId);
    if (!found) return;
    setSelectedSite(found);
    setLat(found.lat);
    setLon(found.lon);
  }

  function handleAddComparison() {
    if (!pousoData) return;
    setComparedSites((prev) => [...prev, { ...pousoData, start_date: startDate }]);
  }

  function handleToggleMock() {
    const next = !offline;
    setOfflineMock(next);
    setOffline(next);
    runFullSimulation();
  }

  const timeline = pousoData?.timeline || [];
  const currentFrame = timeline[timeIndex] || {
    hours: 0,
    sun_elevation_deg: 0,
    earth_elevation_deg: 0,
    dte_signal_ok: false,
  };

  // Avaliação dinâmica GO / NO-GO no instante do Slider de Tempo
  const topoOk = (pousoData?.slope_deg ?? 99) <= 15.0;
  const sunOk = currentFrame.sun_elevation_deg > 0;
  const commOk = currentFrame.dte_signal_ok;
  const isGo = topoOk && sunOk && commOk;

  return html`
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <!-- TOPBAR -->
      <header className="border-b border-slate-800 bg-slate-900/90 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl text-amber-400">☾</span>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Lunar Site Planner 3D</h1>
            <p className="text-xs text-slate-400">NASA Space Apps · React + Three.js + FastAPI (Skyfield/LOLA)</p>
          </div>
        </div>

        <!-- Seletor dos 3 Modos do Fluxograma -->
        <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick=${() => setViewMode('viagem')}
            className=${`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              viewMode === 'viagem' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            1. Viagem (TLI)
          </button>
          <button
            type="button"
            onClick=${() => setViewMode('globo')}
            className=${`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              viewMode === 'globo' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            2. Globo 3D (LOLA)
          </button>
          <button
            type="button"
            onClick=${() => setViewMode('superficie')}
            className=${`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              viewMode === 'superficie' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            3. Superfície & Pouso
          </button>
        </div>

        <!-- Toggle Offline Mock -->
        <button
          type="button"
          onClick=${handleToggleMock}
          className=${`px-3 py-1.5 text-xs font-mono rounded-lg border ${
            offline
              ? 'border-amber-500/50 bg-amber-950/40 text-amber-300'
              : 'border-emerald-500/50 bg-emerald-950/40 text-emerald-300'
          }`}
        >
          ${offline ? 'MODO OFFLINE (MOCK)' : 'API FASTAPI CONECTADA'}
        </button>
      </header>

      <!-- CONTEÚDO PRINCIPAL -->
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
        <!-- CONTROLES DO USUÁRIO (4 colunas) -->
        <aside className="lg:col-span-4 space-y-4">
          <form onSubmit=${runFullSimulation} className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Parâmetros da Missão</h2>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Sítio de Pouso (Polo Sul)</label>
              <select
                value=${selectedSite.id}
                onChange=${(e) => handleSelectPreset(e.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100"
              >
                ${PRESET_SITES.map(
                  (s) => html`<option key=${s.id} value=${s.id}>${s.name}</option>`
                )}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Latitude (°)</label>
                <input
                  type="number"
                  step="0.01"
                  value=${lat}
                  onChange=${(e) => setLat(Number(e.target.value))}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Longitude (°)</label>
                <input
                  type="number"
                  step="0.01"
                  value=${lon}
                  onChange=${(e) => setLon(Number(e.target.value))}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Data Início (UTC)</label>
                <input
                  type="date"
                  value=${startDate}
                  onChange=${(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Duração (dias)</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value=${days}
                  onChange=${(e) => setDays(Number(e.target.value))}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled=${loading}
                className="flex-1 bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm py-2.5 px-4 rounded-lg transition"
              >
                ${loading ? 'Calculando...' : 'Simular Pouso'}
              </button>
              <button
                type="button"
                onClick=${handleAddComparison}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-2.5 px-3 rounded-lg border border-slate-700"
              >
                + Comparar
              </button>
            </div>
          </form>

          <!-- PAINEL AUTOMÁTICO GO / NO-GO (3 CRITÉRIOS DO FLUXOGRAMA) -->
          <div
            className=${`rounded-xl border p-5 transition-all ${
              isGo
                ? 'border-emerald-500/60 bg-emerald-950/30'
                : 'border-red-500/60 bg-red-950/30'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Viabilidade de Pouso
              </span>
              <span
                className=${`px-3 py-1 rounded-full text-sm font-bold font-mono ${
                  isGo ? 'bg-emerald-500 text-slate-950' : 'bg-red-500 text-white'
                }`}
              >
                ${isGo ? 'GO' : 'NO-GO'}
              </span>
            </div>

            <ul className="space-y-2 text-xs">
              <li className="flex justify-between">
                <span className="text-slate-300">1. Segurança Topográfica (Slope):</span>
                <span className=${topoOk ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono'}>
                  ${pousoData?.slope_deg ?? '--'}° ${topoOk ? '✔' : '✖ (>15°)'}
                </span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-300">2. Iluminação Solar (Pôr do Sol ${pousoData?.sunset_duration_min ?? 52}m):</span>
                <span className=${sunOk ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono'}>
                  ${currentFrame.sun_elevation_deg}° ${sunOk ? '✔' : '✖'}
                </span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-300">3. Comunicação Direta (Terra):</span>
                <span className=${commOk ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono'}>
                  ${currentFrame.earth_elevation_deg}° ${commOk ? '✔' : '✖'}
                </span>
              </li>
            </ul>
          </div>
        </aside>

        <!-- VIEWPORT 3D + SLIDER DE TEMPO + COMPARADOR (8 colunas) -->
        <section className="lg:col-span-8 space-y-4">
          <${LunarViewport3D}
            mode=${viewMode}
            timeIndex=${timeIndex}
            viagemData=${viagemData}
            pousoData=${pousoData}
          />

          <!-- SLIDER DE TEMPO -->
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-2">
            <div className="flex justify-between text-xs font-mono text-slate-300">
              <span>SLIDER DE TEMPO DA MISSÃO</span>
              <span>T+ ${currentFrame.hours}h | Fase: ${fasesData?.fase_nome || '--'}</span>
            </div>
            <input
              type="range"
              min="0"
              max=${Math.max(0, timeline.length - 1)}
              value=${timeIndex}
              onChange=${(e) => setTimeIndex(Number(e.target.value))}
              className="w-full accent-sky-500 cursor-pointer"
            />
          </div>

          <!-- COMPARADOR DE SÍTIOS -->
          ${comparedSites.length > 0 &&
          html`
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Comparador de Sítios (${comparedSites.length})
                </h3>
                <button
                  type="button"
                  onClick=${() => setComparedSites([])}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Limpar
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2">Sítio</th>
                      <th className="py-2">Data</th>
                      <th className="py-2">Slope</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    ${comparedSites.map(
                      (item, idx) => html`
                        <tr key=${idx}>
                          <td className="py-2 font-medium">${item.site_name}</td>
                          <td className="py-2 font-mono text-slate-400">${item.start_date}</td>
                          <td className="py-2 font-mono">${item.slope_deg}°</td>
                          <td className="py-2 font-mono font-bold ${item.go_nogo === 'GO' ? 'text-emerald-400' : 'text-red-400'}">
                            ${item.go_nogo}
                          </td>
                        </tr>
                      `
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          `}
        </section>
      </main>
    </div>
  `;
}

createRoot(document.getElementById('root')).render(html`<${LunarSimulatorApp} />`);