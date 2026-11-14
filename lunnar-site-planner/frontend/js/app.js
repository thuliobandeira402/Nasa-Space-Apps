/**
 * Componente Interativo 3D (React 18 + HTM + Three.js)
 * Integrado com dados reais NASA LRO/LOLA e Efemérides JPL DE421
 */

import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const html = htm.bind(React.createElement);
let reactRoot = null;

// Converte Azimute (0° Norte, 90° Leste) e Elevação (°) em coordenadas cartesianas 3D
function azElToVector3(azDeg, elDeg, radius) {
  const az = THREE.MathUtils.degToRad(azDeg || 0);
  const el = THREE.MathUtils.degToRad(elDeg || 0);
  return new THREE.Vector3(
    radius * Math.cos(el) * Math.sin(az),
    radius * Math.sin(el),
    -radius * Math.cos(el) * Math.cos(az)
  );
}

// Cria textura procedural de halo/brilho para o Sol sem depender de imagens externas
function createGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 252, 235, 1)');
  grad.addColorStop(0.25, 'rgba(255, 210, 110, 0.85)');
  grad.addColorStop(0.6, 'rgba(255, 160, 40, 0.2)');
  grad.addColorStop(1, 'rgba(255, 140, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

// Gera campo estelar esférico
function createStarfield(count = 2500, radius = 180) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = radius * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xe2e8f0, size: 0.45, sizeAttenuation: true });
  return new THREE.Points(geo, mat);
}

function LunarScene3D({ simData, viagemData, fasesData, onStepChange }) {
  const [viewMode, setViewMode] = useState('superficie'); // 'viagem' | 'globo' | 'superficie'
  const [stepIdx, setStepIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const canvasWrapRef = useRef(null);
  // Referências dos objetos dinâmicos para atualização em 60 FPS sem recriar WebGL
  const sceneObjectsRef = useRef({
    sunLight: null,
    sunMesh: null,
    earthGroup: null,
    commLine: null,
    landerMesh: null,
    landerLight: null,
    probeMesh: null,
    tliPoints: [],
    landerTopPos: new THREE.Vector3(0, 0.55, 0),
  });

  const timeline = simData?.timeline || [];
  const activeFrame = timeline[stepIdx] || {
    sun_elevation_deg: 0,
    sun_azimuth_deg: 0,
    earth_elevation_deg: 0,
    earth_azimuth_deg: 0,
    sun_visible: false,
    earth_visible: false,
  };

  // Reseta timeline e pausa animação ao receber nova simulação
  useEffect(() => {
    setStepIdx(0);
    setIsPlaying(false);
  }, [simData]);

  // Controle de Play/Pause automático
  useEffect(() => {
    if (!isPlaying || timeline.length <= 1) return;
    const timer = setInterval(() => {
      setStepIdx((prev) => {
        const next = prev + 1 >= timeline.length ? 0 : prev + 1;
        if (onStepChange) onStepChange(next);
        return next;
      });
    }, 120);
    return () => clearInterval(timer);
  }, [isPlaying, timeline.length, onStepChange]);

  // EFFECT 1: Inicializa cena, malhas LOLA e câmera (roda apenas quando muda o modo ou os dados da API)
  useEffect(() => {
    const container = canvasWrapRef.current;
    if (!container) return;

    const width = container.clientWidth || 720;
    const height = 400;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#040711');
    scene.add(createStarfield(2800, 160));

    const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;

    // Luz ambiente lunar (albedo terrestre + luz estelar) e luz solar direcional de alta precisão
    scene.add(new THREE.AmbientLight(0x1e293b, 0.45));
    const sunLight = new THREE.DirectionalLight(0xfffbeb, 2.8);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 80;
    const d = 10;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0005;
    scene.add(sunLight);

    const refs = {
      sunLight,
      sunMesh: null,
      earthGroup: null,
      commLine: null,
      landerMesh: null,
      landerLight: null,
      probeMesh: null,
      tliPoints: [],
      landerTopPos: new THREE.Vector3(0, 0.55, 0),
    };

    if (viewMode === 'viagem') {
      // MODO 1: VIAGEM ORBITAL (TLI) COM ATMOSFERA FRESNEL
      camera.position.set(0, 6.5, 11.2);
      controls.target.set(0, 0, 1);

      const earthGroup = new THREE.Group();
      earthGroup.position.set(-3.2, 0, 0);
      const earthMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1.1, 48, 48),
        new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.4, metalness: 0.1 })
      );
      const atmoMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1.18, 48, 48),
        new THREE.MeshBasicMaterial({
          color: 0x60a5fa,
          transparent: true,
          opacity: 0.25,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
        })
      );
      earthGroup.add(earthMesh, atmoMesh);

      const moon = new THREE.Mesh(
        new THREE.SphereGeometry(0.46, 32, 32),
        new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.92 })
      );
      moon.position.set(2.6, 0, 2.3);
      scene.add(earthGroup, moon);

      const pts = (viagemData?.tli_trajectory || []).map((p) => new THREE.Vector3(p.x, p.y, p.z));
      refs.tliPoints = pts;
      if (pts.length > 1) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: 0x38bdf8 })
        );
        const probe = new THREE.Mesh(
          new THREE.ConeGeometry(0.14, 0.4, 16),
          new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xd97706, emissiveIntensity: 0.5 })
        );
        probe.position.copy(pts[0]);
        scene.add(line, probe);
        refs.probeMesh = probe;
      }
    } else if (viewMode === 'globo') {
      // MODO 2: GLOBO LUNAR 3D COM COORDENADAS REAIS E INDICADOR GO/NO-GO
      camera.position.set(0, -3.6, 5.2);
      controls.target.set(0, 0, 0);

      const globe = new THREE.Mesh(
        new THREE.SphereGeometry(2.2, 96, 96),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.95 })
      );
      globe.receiveShadow = true;
      scene.add(globe);

      // Grade de referência polar
      const gridHelper = new THREE.PolarGridHelper(2.25, 12, 4, 64, 0x334155, 0x1e293b);
      gridHelper.rotation.x = Math.PI / 2;
      globe.add(gridHelper);

      const latRad = THREE.MathUtils.degToRad(simData?.lat ?? -89.9);
      const lonRad = THREE.MathUtils.degToRad(simData?.lon ?? 0);
      const r = 2.24;
      const isGo = simData?.go_nogo === 'GO';
      const pinColor = isGo ? 0x3ddc97 : 0xff5c7a;

      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 16, 16),
        new THREE.MeshBasicMaterial({ color: pinColor })
      );
      pin.position.set(
        r * Math.cos(latRad) * Math.cos(lonRad),
        r * Math.sin(latRad),
        r * Math.cos(latRad) * Math.sin(lonRad)
      );
      globe.add(pin);
    } else {
      // MODO 3: SUPERFÍCIE REAL (MALHA LRO/LOLA + HORIZONTE 360° + SOL + TERRA + FEIXE DE SINAL)
      camera.position.set(0, 2.6, 6.2);
      controls.target.set(0, 0.6, 0);

      // 1. Terreno Local Real vindo do raster LOLA (/simular-pouso -> terrain_grid)
      const grid = simData?.terrain_grid;
      const segments = grid?.size ? grid.size - 1 : 63;
      const terrainGeo = new THREE.PlaneGeometry(14, 14, segments, segments);
      const pos = terrainGeo.attributes.position;

      // Calcula escala vertical proporcional ao relevo real em metros
      const elevSpan = grid ? Math.max(10, grid.max_elevation_m - grid.min_elevation_m) : 100;
      const verticalScale = Math.min(2.4, Math.max(0.4, elevSpan / 180));

      let centerHeight = 0;
      const centerIdx = Math.floor(pos.count / 2);

      for (let i = 0; i < pos.count; i++) {
        const h = grid?.heights?.[i] !== undefined ? grid.heights[i] * verticalScale : 0;
        pos.setZ(i, h);
        if (i === centerIdx) centerHeight = h;
      }
      terrainGeo.computeVertexNormals();

      const terrain = new THREE.Mesh(
        terrainGeo,
        new THREE.MeshStandardMaterial({
          color: 0x64748b,
          roughness: 0.96,
          metalness: 0.02,
          flatShading: false,
        })
      );
      terrain.rotation.x = -Math.PI / 2;
      terrain.receiveShadow = true;
      terrain.castShadow = true;
      scene.add(terrain);

      // 2. Perfil de Horizonte 360° Real do LOLA (montanhas distantes que bloqueiam Sol/Terra)
      const horizon = simData?.horizon_profile || [];
      if (horizon.length > 2) {
        const hRadius = 24;
        const ringGeo = new THREE.CylinderGeometry(hRadius, hRadius, 1, horizon.length, 1, true);
        const rPos = ringGeo.attributes.position;

        for (let i = 0; i < rPos.count; i++) {
          if (rPos.getY(i) > 0) {
            const angle = Math.atan2(rPos.getX(i), -rPos.getZ(i));
            const azDeg = (THREE.MathUtils.radToDeg(angle) + 360) % 360;
            const idx = Math.round((azDeg / 360) * (horizon.length - 1));
            const elevDeg = horizon[idx]?.elevation_deg ?? horizon[idx] ?? 0;
            const mountainY = Math.max(0.1, Math.tan(THREE.MathUtils.degToRad(elevDeg)) * hRadius);
            rPos.setY(i, mountainY);
          } else {
            rPos.setY(i, -1.5);
          }
        }
        ringGeo.computeVertexNormals();
        const horizonMesh = new THREE.Mesh(
          ringGeo,
          new THREE.MeshStandardMaterial({
            color: 0x1e293b,
            roughness: 1,
            side: THREE.DoubleSide,
          })
        );
        scene.add(horizonMesh);
      }

      // 3. Lander posicionado exatamente sobre a cota real do terreno no centro
      const lander = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.3, 0.48, 16),
        new THREE.MeshStandardMaterial({
          color: 0xfbbf24,
          metalness: 0.45,
          roughness: 0.3,
        })
      );
      lander.position.set(0, centerHeight + 0.24, 0);
      lander.castShadow = true;
      lander.receiveShadow = true;
      scene.add(lander);
      refs.landerMesh = lander;
      refs.landerTopPos = new THREE.Vector3(0, centerHeight + 0.48, 0);

      // Luz de operação por bateria/RTG (acende na noite lunar)
      const landerLight = new THREE.PointLight(0x38bdf8, 0, 3.5);
      landerLight.position.set(0, centerHeight + 0.65, 0);
      scene.add(landerLight);
      refs.landerLight = landerLight;

      // 4. Sol Real no Céu (Esfera emissiva + Sprite Halo)
      const sunGroup = new THREE.Group();
      const sunSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.85, 24, 24),
        new THREE.MeshBasicMaterial({ color: 0xfffbeb })
      );
      const sunSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: createGlowTexture(),
          color: 0xffd166,
          transparent: true,
          blending: THREE.AdditiveBlending,
        })
      );
      sunSprite.scale.set(7.5, 7.5, 1);
      sunGroup.add(sunSphere, sunSprite);
      scene.add(sunGroup);
      refs.sunMesh = sunGroup;

      // 5. Terra Real no Céu (Esfera + Atmosfera Fresnel)
      const earthGroup = new THREE.Group();
      const earthSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.95, 32, 32),
        new THREE.MeshStandardMaterial({
          color: 0x2563eb,
          emissive: 0x1d4ed8,
          emissiveIntensity: 0.45,
          roughness: 0.4,
        })
      );
      const earthAtmo = new THREE.Mesh(
        new THREE.SphereGeometry(1.06, 32, 32),
        new THREE.MeshBasicMaterial({
          color: 0x7dd3fc,
          transparent: true,
          opacity: 0.32,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
        })
      );
      earthGroup.add(earthSphere, earthAtmo);
      scene.add(earthGroup);
      refs.earthGroup = earthGroup;

      // 6. Linha de Visada / Comunicação Terra-Lander
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        refs.landerTopPos,
        new THREE.Vector3(0, 5, -20),
      ]);
      const lineMat = new THREE.LineDashedMaterial({
        color: 0x3ddc97,
        dashSize: 0.6,
        gapSize: 0.35,
      });
      const commLine = new THREE.Line(lineGeo, lineMat);
      scene.add(commLine);
      refs.commLine = commLine;
    }

    sceneObjectsRef.current = refs;

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
  }, [viewMode, simData, viagemData]);

  // EFFECT 2: Atualização instantânea (60 FPS) ao mover o slider de tempo
  useEffect(() => {
    const refs = sceneObjectsRef.current;
    if (!refs.sunLight) return;

    const sunVisible = Boolean(activeFrame.sun_visible);
    const earthVisible = activeFrame.earth_visible ?? activeFrame.earth_elevation_deg > 0;

    // Atualiza vetor real do Sol (Azimute + Elevação)
    const sunPos = azElToVector3(activeFrame.sun_azimuth_deg, activeFrame.sun_elevation_deg, 32);
    refs.sunLight.position.copy(sunPos);
    refs.sunLight.intensity = sunVisible ? 2.8 : 0.18;

    if (refs.sunMesh) {
      refs.sunMesh.position.copy(sunPos);
      refs.sunMesh.visible = activeFrame.sun_elevation_deg > -2;
    }

    // Atualiza vetor real da Terra + Feixe de Comunicação
    if (refs.earthGroup) {
      const earthPos = azElToVector3(
        activeFrame.earth_azimuth_deg ?? 0,
        activeFrame.earth_elevation_deg ?? 2,
        28
      );
      refs.earthGroup.position.copy(earthPos);

      if (refs.commLine) {
        refs.commLine.geometry.setFromPoints([refs.landerTopPos, earthPos]);
        refs.commLine.computeLineDistances();
        refs.commLine.material.color.setHex(earthVisible ? 0x3ddc97 : 0xff5c7a);
      }
    }

    // Atualiza estado energético do Lander (Painel Solar vs Bateria/RTG)
    if (refs.landerMesh && refs.landerLight) {
      refs.landerMesh.material.color.setHex(sunVisible ? 0xfbbf24 : 0x38bdf8);
      refs.landerLight.intensity = sunVisible ? 0 : 1.6;
    }

    // Atualiza posição da sonda na trajetória TLI (Modo Viagem)
    if (refs.probeMesh && refs.tliPoints.length > 1) {
      const maxT = Math.max(1, timeline.length - 1);
      const probeIdx = Math.min(
        refs.tliPoints.length - 1,
        Math.floor((stepIdx / maxT) * refs.tliPoints.length)
      );
      refs.probeMesh.position.copy(refs.tliPoints[probeIdx]);
    }
  }, [stepIdx, activeFrame, viewMode, timeline.length]);

  function handleSliderChange(e) {
    setIsPlaying(false);
    const nextIdx = Number(e.target.value);
    setStepIdx(nextIdx);
    if (onStepChange) onStepChange(nextIdx);
  }

  const sunVis = Boolean(activeFrame.sun_visible);
  const earthVis = activeFrame.earth_visible ?? activeFrame.earth_elevation_deg > 0;

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
          ${fasesData?.fase_nome || 'Efemérides JPL DE421 · LRO/LOLA'}
        </span>
      </div>

      <!-- Container relativo para o Canvas 3D + HUD de Telemetria em Tempo Real -->
      <div className="relative w-full h-[400px] rounded-lg overflow-hidden border border-slate-800">
        <div ref=${canvasWrapRef} className="w-full h-full"></div>

        <!-- HUD de Telemetria Real -->
        <div className="hud-3d" aria-live="polite">
          <div>
            <span>SOL</span>
            <strong>${Number(activeFrame.sun_elevation_deg || 0).toFixed(2)}°</strong>
            <em className=${sunVis ? 'ok' : 'bad'}>${sunVis ? 'GERANDO' : 'BATERIA'}</em>
          </div>
          <div>
            <span>TERRA</span>
            <strong>${Number(activeFrame.earth_elevation_deg || 0).toFixed(2)}°</strong>
            <em className=${earthVis ? 'ok' : 'bad'}>${earthVis ? 'LINK ATIVO' : 'SEM VISADA'}</em>
          </div>
          ${simData?.terrain_grid &&
          html`
            <div>
              <span>COTA LOLA</span>
              <strong>${simData.terrain_grid.min_elevation_m}m a ${simData.terrain_grid.max_elevation_m}m</strong>
            </div>
          `}
        </div>
      </div>

      <!-- Barra de Tempo + Botão Play/Pause -->
      <div className="slider-bar">
        <button
          type="button"
          className="btn small"
          onClick=${() => setIsPlaying((p) => !p)}
          disabled=${timeline.length <= 1}
        >
          ${isPlaying ? '⏸ Pausar' : '▶ Play'}
        </button>

        <label htmlFor="time-slider-3d" className="text-xs font-mono text-slate-300 whitespace-nowrap">
          <strong>
            ${activeFrame.timestamp
              ? activeFrame.timestamp.replace('T', ' ').slice(0, 16) + ' UTC'
              : 'Aguardando simulação'}
          </strong>
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