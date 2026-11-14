/**
 * Componente Interativo 3D (React 18 + HTM + Three.js)
 * Montado no container #react-3d-root do index.html
 */

import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const html = htm.bind(React.createElement);
let reactRoot = null;

function LunarScene3D({ simData, viagemData, fasesData, onStepChange }) {
  const [viewMode, setViewMode] = useState('superficie'); // 'viagem' | 'globo' | 'superficie'
  const [stepIdx, setStepIdx] = useState(0);
  const canvasWrapRef = useRef(null);

  useEffect(() => {
    setStepIdx(0);
  }, [simData]);

  useEffect(() => {
    const container = canvasWrapRef.current;
    if (!container) return;

    const width = container.clientWidth || 720;
    const height = 380;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#060913');

    const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const timeline = simData?.timeline || [];
    const currentFrame = timeline[stepIdx] || {
      sun_elevation_deg: 2.0,
      sun_azimuth_deg: 45,
      earth_elevation_deg: 4.0,
      sun_visible: true,
    };

    // Iluminação Solar dinâmica conforme elevação e azimute do passo atual
    scene.add(new THREE.AmbientLight(0x334155, 0.55));
    const sunLight = new THREE.DirectionalLight(0xfffbeb, currentFrame.sun_visible ? 2.6 : 0.25);
    const elevRad = THREE.MathUtils.degToRad(Math.max(1, currentFrame.sun_elevation_deg * 3));
    const azRad = THREE.MathUtils.degToRad(currentFrame.sun_azimuth_deg || 0);
    sunLight.position.set(
      Math.cos(azRad) * Math.cos(elevRad) * 14,
      Math.sin(elevRad) * 14,
      Math.sin(azRad) * Math.cos(elevRad) * 14
    );
    sunLight.castShadow = true;
    scene.add(sunLight);

    if (viewMode === 'viagem') {
      // MODO 1: VIAGEM — Trajetória orbital Terra -> Lua (TLI)
      camera.position.set(0, 6.2, 10.5);
      controls.target.set(0, 0, 1);

      const earth = new THREE.Mesh(
        new THREE.SphereGeometry(1.05, 32, 32),
        new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.45 })
      );
      earth.position.set(-3.1, 0, 0);

      const moon = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 24, 24),
        new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.9 })
      );
      moon.position.set(2.5, 0, 2.3);
      scene.add(earth, moon);

      const pts = (viagemData?.tli_trajectory || []).map((p) => new THREE.Vector3(p.x, p.y, p.z));
      if (pts.length > 1) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: 0x38bdf8 })
        );
        scene.add(line);

        const maxT = Math.max(1, timeline.length - 1);
        const probeIdx = Math.min(pts.length - 1, Math.floor((stepIdx / maxT) * pts.length));
        const probe = new THREE.Mesh(
          new THREE.ConeGeometry(0.14, 0.38, 12),
          new THREE.MeshBasicMaterial({ color: 0xfbbf24 })
        );
        probe.position.copy(pts[probeIdx]);
        scene.add(probe);
      }
    } else if (viewMode === 'globo') {
      // MODO 2: GLOBO 3D — Relevo NASA LOLA e sombras solares
      camera.position.set(0, -3.4, 5.0);
      controls.target.set(0, 0, 0);

      const globe = new THREE.Mesh(
        new THREE.SphereGeometry(2.2, 64, 64),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.95 })
      );
      scene.add(globe);

      const latRad = THREE.MathUtils.degToRad(simData?.lat ?? -89.9);
      const lonRad = THREE.MathUtils.degToRad(simData?.lon ?? 0);
      const r = 2.24;
      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 16, 16),
        new THREE.MeshBasicMaterial({ color: simData?.go_nogo === 'GO' ? 0x10b981 : 0xef4444 })
      );
      pin.position.set(
        r * Math.cos(latRad) * Math.cos(lonRad),
        r * Math.sin(latRad),
        r * Math.cos(latRad) * Math.sin(lonRad)
      );
      globe.add(pin);
    } else {
      // MODO 3: SUPERFÍCIE — Horizonte local, Sol, Terra e Lander
      camera.position.set(0, 2.3, 5.8);
      controls.target.set(0, 0.35, 0);

      const terrainGeo = new THREE.PlaneGeometry(14, 14, 40, 40);
      const pos = terrainGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const dist = Math.sqrt(x * x + y * y);
        pos.setZ(i, Math.sin(dist * 1.25) * 0.32 + Math.cos(x * 1.1) * 0.14);
      }
      terrainGeo.computeVertexNormals();

      const terrain = new THREE.Mesh(
        terrainGeo,
        new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.96, flatShading: true })
      );
      terrain.rotation.x = -Math.PI / 2;
      terrain.receiveShadow = true;
      scene.add(terrain);

      const lander = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.28, 0.45, 16),
        new THREE.MeshStandardMaterial({
          color: currentFrame.sun_visible ? 0xfbbf24 : 0x38bdf8,
          metalness: 0.4,
          roughness: 0.3,
        })
      );
      lander.position.set(0, 0.32, 0);
      lander.castShadow = true;
      scene.add(lander);
    }

    let animId;
    const renderLoop = () => {
      animId = requestAnimationFrame(renderLoop);
      controls.update();
      renderer.render(scene, camera);
    };
    renderLoop();

    const onResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / height;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, height);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
    };
  }, [viewMode, stepIdx, simData, viagemData]);

  const timeline = simData?.timeline || [];
  const activeFrame = timeline[stepIdx];

  function handleSliderChange(e) {
    const nextIdx = Number(e.target.value);
    setStepIdx(nextIdx);
    if (onStepChange) onStepChange(nextIdx);
  }

  return html`
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className=${`btn small ${viewMode === 'viagem' ? 'primary' : ''}`}
            onClick=${() => setViewMode('viagem')}
          >
            1. Viagem (TLI)
          </button>
          <button
            type="button"
            className=${`btn small ${viewMode === 'globo' ? 'primary' : ''}`}
            onClick=${() => setViewMode('globo')}
          >
            2. Globo 3D (LOLA)
          </button>
          <button
            type="button"
            className=${`btn small ${viewMode === 'superficie' ? 'primary' : ''}`}
            onClick=${() => setViewMode('superficie')}
          >
            3. Superfície
          </button>
        </div>

        <span className="text-xs font-mono text-slate-400">
          ${fasesData?.fase_nome || 'Efemérides JPL DE421'}
        </span>
      </div>

      <div ref=${canvasWrapRef} className="w-full h-[380px] rounded-lg overflow-hidden border border-slate-800"></div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
        <label htmlFor="time-slider-3d" className="text-xs font-mono text-slate-300 whitespace-nowrap">
          Slider Tempo: <strong>${activeFrame ? activeFrame.timestamp.replace('T', ' ').slice(0, 16) + ' UTC' : '--'}</strong>
        </label>
        <input
          id="time-slider-3d"
          type="range"
          min="0"
          max=${Math.max(0, timeline.length - 1)}
          value=${stepIdx}
          onChange=${handleSliderChange}
          className="w-full accent-sky-500 cursor-pointer"
        />
      </div>
    </div>
  `;
}

export function mountOrUpdate3DScene({ simData, viagemData, fasesData, onStepChange }) {
  const container = document.getElementById('react-3d-root');
  if (!container) return;

  if (!reactRoot) {
    reactRoot = createRoot(container);
  }

  reactRoot.render(
    html`<${LunarScene3D}
      simData=${simData}
      viagemData=${viagemData}
      fasesData=${fasesData}
      onStepChange=${onStepChange}
    />`
  );
}