/**
 * Interactive 3D Component (React 18 + HTM + Three.js)
 * Integrated with NASA LRO/LOLA DEM & JPL DE421 Ephemerides
 */

import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const html = htm.bind(React.createElement);
let reactRoot = null;

// Coordenadas locais de superfície (Modo 3: Y+ = Zênite local, Z- = Norte, X+ = Leste)
function azElToVector3(azDeg, elDeg, radius) {
  const az = THREE.MathUtils.degToRad(azDeg || 0);
  const el = THREE.MathUtils.degToRad(elDeg || 0);
  return new THREE.Vector3(
    radius * Math.cos(el) * Math.sin(az),
    radius * Math.sin(el),
    -radius * Math.cos(el) * Math.cos(az)
  );
}

// Converte (Azimute, Elevação) medidos no ponto (latDeg, lonDeg) para o vetor 3D contínuo no Globo Lunar (Modo 2)
function localAzElToGlobeVector3(latDeg, lonDeg, azDeg, elDeg, radius) {
  const lat = THREE.MathUtils.degToRad(latDeg ?? -89.9);
  const lon = THREE.MathUtils.degToRad(lonDeg ?? 0);
  const az = THREE.MathUtils.degToRad(azDeg || 0);
  const el = THREE.MathUtils.degToRad(elDeg || 0);

  // Vetor normal (Up / Zênite) no ponto (lat, lon) da esfera
  const up = new THREE.Vector3(
    Math.cos(lat) * Math.cos(lon),
    Math.sin(lat),
    Math.cos(lat) * Math.sin(lon)
  ).normalize();

  // Vetor Leste local
  const east = new THREE.Vector3(-Math.sin(lon), 0, Math.cos(lon)).normalize();
  // Vetor Norte local (tangente ao meridiano em direção ao Polo Norte Y+)
  const north = new THREE.Vector3(
    -Math.sin(lat) * Math.cos(lon),
    Math.cos(lat),
    -Math.sin(lat) * Math.sin(lon)
  ).normalize();

  // Direção contínua do astro sem saltos artificiais
  const dir = new THREE.Vector3()
    .addScaledVector(north, Math.cos(el) * Math.cos(az))
    .addScaledVector(east, Math.cos(el) * Math.sin(az))
    .addScaledVector(up, Math.sin(el))
    .normalize();

  return dir.multiplyScalar(radius);
}

// Curva smoothstep ampla para transição gradual e realista de luz/penumbra ao cruzar o relevo
function smoothSolarFactor(sunElevDeg, maskElevDeg) {
  const margin = (sunElevDeg + 0.265) - (maskElevDeg || 0);
  // Janela suave de -1.8° a +1.8° em torno da crista da montanha para evitar cortes bruscos
  const t = Math.max(0, Math.min(1, (margin + 1.8) / 3.6));
  return t * t * (3 - 2 * t);
}

function translatePhaseName(rawName) {
  if (!rawName) return 'JPL DE421 Ephemerides · LRO/LOLA';
  return rawName
    .replace('Lua Nova', 'New Moon')
    .replace('Lua Crescente', 'Waxing Crescent')
    .replace('Quarto Crescente', 'First Quarter')
    .replace('Gibosa Crescente', 'Waxing Gibbous')
    .replace('Lua Cheia', 'Full Moon')
    .replace('Gibosa Minguante', 'Waning Gibbous')
    .replace('Quarto Minguante', 'Last Quarter')
    .replace('Lua Minguante', 'Waning Crescent')
    .replace('iluminada', 'illuminated');
}

function createGlowTexture(rgbaCenter = 'rgba(255, 252, 235, 1)', rgbaMid = 'rgba(255, 200, 90, 0.75)') {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, rgbaCenter);
  grad.addColorStop(0.28, rgbaMid);
  grad.addColorStop(0.65, 'rgba(255, 160, 40, 0.18)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function createLabelSprite(text, colorHex = '#ffffff', bgRgba = 'rgba(6, 10, 24, 0.85)', scaleWidth = 4.2) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = bgRgba;
  ctx.strokeStyle = colorHex;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(6, 8, 308, 48, 12);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = colorHex;
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 160, 33);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scaleWidth, 1.0, 1);
  return sprite;
}

function createLunarGlobeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#94a3b8');
  grad.addColorStop(0.5, '#cbd5e1');
  grad.addColorStop(1, '#94a3b8');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  for (let i = 0; i < 180; i++) {
    const x = ((i * 73) % 500) + 6;
    const y = ((i * 41) % 240) + 8;
    const r = (i % 5) * 3 + 2;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(71, 85, 105, 0.25)' : 'rgba(241, 245, 249, 0.22)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return new THREE.CanvasTexture(canvas);
}

function createStarfield(count = 3200, minRadius = 110, maxRadius = 220) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = minRadius + Math.random() * (maxRadius - minRadius);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xf1f5f9, size: 0.55, sizeAttenuation: true });
  return new THREE.Points(geo, mat);
}

function buildHorizonRidgeBelt(horizonProfile = [], radius = 26, baseY = -0.3) {
  const group = new THREE.Group();
  if (!Array.isArray(horizonProfile) || horizonProfile.length < 3) return group;

  const segs = 180;
  const positions = new Float32Array((segs + 1) * 2 * 3);
  const colors = new Float32Array((segs + 1) * 2 * 3);
  const indices = [];

  const getElevAtAz = (azDeg) => {
    const norm = ((azDeg % 360) + 360) % 360;
    const exactIdx = (norm / 360) * (horizonProfile.length - 1);
    const i0 = Math.floor(exactIdx);
    const i1 = Math.min(horizonProfile.length - 1, i0 + 1);
    const frac = exactIdx - i0;
    const e0 = horizonProfile[i0]?.elevation_deg ?? 0;
    const e1 = horizonProfile[i1]?.elevation_deg ?? 0;
    return e0 * (1 - frac) + e1 * frac;
  };

  const crestPts = [];

  for (let i = 0; i <= segs; i++) {
    const az = (i / segs) * 360;
    const elevDeg = Math.max(0.2, getElevAtAz(az));
    const visualElevDeg = Math.min(22, elevDeg * 1.85 + 0.6);

    const topVec = azElToVector3(az, visualElevDeg, radius);
    const botVec = azElToVector3(az, 0, radius);
    botVec.y = baseY;

    crestPts.push(topVec.clone());

    const vIdx = i * 2;
    positions[vIdx * 3] = botVec.x;
    positions[vIdx * 3 + 1] = botVec.y;
    positions[vIdx * 3 + 2] = botVec.z;

    positions[(vIdx + 1) * 3] = topVec.x;
    positions[(vIdx + 1) * 3 + 1] = topVec.y;
    positions[(vIdx + 1) * 3 + 2] = topVec.z;

    colors[vIdx * 3] = 0.06;
    colors[vIdx * 3 + 1] = 0.09;
    colors[vIdx * 3 + 2] = 0.16;

    colors[(vIdx + 1) * 3] = 0.38;
    colors[(vIdx + 1) * 3 + 1] = 0.48;
    colors[(vIdx + 1) * 3 + 2] = 0.64;

    if (i < segs) {
      const a = i * 2;
      const b = a + 1;
      const c = (i + 1) * 2;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  wallGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  wallGeo.setIndex(indices);
  wallGeo.computeVertexNormals();

  const wallMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  group.add(new THREE.Mesh(wallGeo, wallMat));

  const crestLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(crestPts),
    new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.85 })
  );
  group.add(crestLine);

  return group;
}

function buildLunarLanderMesh(centerHeight = 0) {
  const group = new THREE.Group();
  group.position.set(0, centerHeight, 0);

  const padRing = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.72, 32),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.65 })
  );
  padRing.rotation.x = -Math.PI / 2;
  padRing.position.y = 0.02;
  group.add(padRing);

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.38, 0.62, 8),
    new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0x78350f,
      emissiveIntensity: 0.25,
      metalness: 0.55,
      roughness: 0.3,
    })
  );
  body.position.y = 0.44;
  body.castShadow = true;
  group.add(body);

  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.24, 0.22, 12),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.35, roughness: 0.35 })
  );
  top.position.y = 0.84;
  group.add(top);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.35, 8),
    new THREE.MeshBasicMaterial({ color: 0xe2e8f0 })
  );
  mast.position.y = 1.08;
  group.add(mast);

  const legMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.6, roughness: 0.35 });
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.58, 8), legMat);
    leg.position.set(Math.cos(angle) * 0.38, 0.24, Math.sin(angle) * 0.38);
    leg.rotation.z = -Math.cos(angle) * 0.55;
    leg.rotation.x = Math.sin(angle) * 0.55;
    group.add(leg);

    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.04, 12), legMat);
    foot.position.set(Math.cos(angle) * 0.54, 0.02, Math.sin(angle) * 0.54);
    group.add(foot);
  }

  const panelMat = new THREE.MeshStandardMaterial({
    color: 0x2563eb,
    emissive: 0x1d4ed8,
    emissiveIntensity: 0.4,
    metalness: 0.45,
    roughness: 0.25,
    side: THREE.DoubleSide,
  });
  const leftPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 0.36), panelMat);
  leftPanel.position.set(-0.62, 0.56, 0);
  const rightPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 0.36), panelMat);
  rightPanel.position.set(0.62, 0.56, 0);
  group.add(leftPanel, rightPanel);

  return { group, body, panelMat, padRing };
}

function LunarScene3D({ simData, viagemData, fasesData, onStepChange }) {
  const [viewMode, setViewMode] = useState('superficie'); // 'viagem' | 'globo' | 'superficie'
  const [stepIdx, setStepIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const canvasWrapRef = useRef(null);
  const sceneObjectsRef = useRef({
    viewMode: 'superficie',
    sunLight: null,
    hemiLight: null,
    rimLight: null,
    sunMesh: null,
    sunRayLine: null,
    sunRayMat: null,
    sunBlockBadge: null,
    earthGroup: null,
    commBeamGroup: null,
    commPulses: [],
    commLineMat: null,
    commLine: null,
    globePin: null,
    globePinHalo: null,
    globePinPos: new THREE.Vector3(0, -2.24, 0),
    landerBody: null,
    landerPanelMat: null,
    landerPadRing: null,
    landerLight: null,
    probeMesh: null,
    tliPoints: [],
    landerTopPos: new THREE.Vector3(0, 1.15, 0),
    earthTargetPos: new THREE.Vector3(0, 8, -28),
    earthCurrentPos: new THREE.Vector3(0, 8, -28),
    sunVisualTargetPos: new THREE.Vector3(20, 5, 20),
    sunLightTargetPos: new THREE.Vector3(20, -10, 20),
    sunRayEndTargetPos: new THREE.Vector3(20, 5, 20),
    targetSunIntensity: 3.2,
    targetHemiIntensity: 0.65,
    targetLanderLightIntensity: 0.3,
    earthVisibleNow: true,
    baseCenterY: 0,
    compassRadius: 26,
    initializedPositions: false,
  });

  const timeline = simData?.timeline || [];
  const activeFrame = timeline[stepIdx] || {
    sun_elevation_deg: 0,
    sun_azimuth_deg: 0,
    terrain_mask_deg: 0,
    earth_elevation_deg: 0,
    earth_azimuth_deg: 0,
    sun_visible: false,
    earth_visible: false,
  };

  useEffect(() => {
    setStepIdx(0);
    setIsPlaying(false);
  }, [simData]);

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

  useEffect(() => {
    const container = canvasWrapRef.current;
    if (!container) return;

    const width = container.clientWidth || 720;
    const height = 420;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#030612');
    scene.add(createStarfield(3200, 110, 220));

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 600);
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
    controls.maxDistance = 85;
    controls.minDistance = 2.0;

    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.6);
    scene.add(hemiLight);

    const rimLight = new THREE.DirectionalLight(0x475569, 0.25);
    rimLight.position.set(-20, 16, -20);
    scene.add(rimLight);

    const sunLight = new THREE.DirectionalLight(0xfffbeb, 3.2);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 110;
    const d = 19;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0005;
    scene.add(sunLight);

    const refs = {
      viewMode,
      sunLight,
      hemiLight,
      rimLight,
      sunMesh: null,
      sunRayLine: null,
      sunRayMat: null,
      sunBlockBadge: null,
      earthGroup: null,
      commBeamGroup: null,
      commPulses: [],
      commLineMat: null,
      commLine: null,
      globePin: null,
      globePinHalo: null,
      globePinPos: new THREE.Vector3(0, -2.24, 0),
      landerBody: null,
      landerPanelMat: null,
      landerPadRing: null,
      landerLight: null,
      probeMesh: null,
      tliPoints: [],
      landerTopPos: new THREE.Vector3(0, 1.15, 0),
      earthTargetPos: new THREE.Vector3(0, 8, -28),
      earthCurrentPos: new THREE.Vector3(0, 8, -28),
      sunVisualTargetPos: new THREE.Vector3(20, 5, 20),
      sunLightTargetPos: new THREE.Vector3(25, -10, 20),
      sunRayEndTargetPos: new THREE.Vector3(20, 5, 20),
      targetSunIntensity: 3.2,
      targetHemiIntensity: 0.6,
      targetLanderLightIntensity: 0.3,
      earthVisibleNow: true,
      baseCenterY: 0,
      compassRadius: 26,
      initializedPositions: false,
    };

    if (viewMode === 'viagem') {
      camera.position.set(0, 6.5, 11.2);
      controls.target.set(0, 0, 1);

      const ePos = viagemData?.earth_pos || { x: -3.2, y: 0, z: 0 };
      const mPos = viagemData?.moon_pos || { x: 2.6, y: 0, z: 2.3 };

      const earthGroup = new THREE.Group();
      earthGroup.position.set(ePos.x, ePos.y, ePos.z);
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
      moon.position.set(mPos.x, mPos.y, mPos.z);
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
      // MODO 2: GLOBO 3D COM MOVIMENTO CONTÍNUO REAL DO SOL E DA TERRA (SEM SALTOS)
      camera.position.set(0, -4.8, 6.2);
      controls.target.set(0, -0.6, 0);

      const globe = new THREE.Mesh(
        new THREE.SphereGeometry(2.2, 96, 96),
        new THREE.MeshStandardMaterial({
          map: createLunarGlobeTexture(),
          roughness: 0.88,
          metalness: 0.04,
        })
      );
      globe.receiveShadow = true;
      scene.add(globe);

      const gridHelper = new THREE.PolarGridHelper(2.26, 12, 4, 64, 0x334155, 0x1e293b);
      gridHelper.rotation.x = Math.PI / 2;
      globe.add(gridHelper);

      const latRad = THREE.MathUtils.degToRad(simData?.lat ?? -89.9);
      const lonRad = THREE.MathUtils.degToRad(simData?.lon ?? 0);
      const r = 2.23;
      const pinPos = new THREE.Vector3(
        r * Math.cos(latRad) * Math.cos(lonRad),
        r * Math.sin(latRad),
        r * Math.cos(latRad) * Math.sin(lonRad)
      );
      refs.globePinPos.copy(pinPos);
      refs.landerTopPos.copy(pinPos);

      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(0.085, 20, 20),
        new THREE.MeshBasicMaterial({ color: 0x3ddc97 })
      );
      pin.position.copy(pinPos);
      scene.add(pin);
      refs.globePin = pin;

      const pinHalo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: createGlowTexture('rgba(61, 220, 151, 0.95)', 'rgba(56, 189, 248, 0.45)'),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      pinHalo.scale.set(0.65, 0.65, 1);
      pinHalo.position.copy(pinPos);
      scene.add(pinHalo);
      refs.globePinHalo = pinHalo;

      const sunGroup = new THREE.Group();
      const sunSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 24, 24),
        new THREE.MeshBasicMaterial({ color: 0xfffbeb })
      );
      const sunSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: createGlowTexture('rgba(255, 252, 235, 1)', 'rgba(251, 191, 36, 0.85)'),
          color: 0xffd166,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      sunSprite.scale.set(3.2, 3.2, 1);
      const sunLabel = createLabelSprite('☀️ SUN', '#fbbf24', 'rgba(6, 10, 24, 0.85)', 1.8);
      sunLabel.scale.set(1.6, 0.42, 1);
      sunLabel.position.set(0, 0.85, 0);
      sunGroup.add(sunSphere, sunSprite, sunLabel);
      scene.add(sunGroup);
      refs.sunMesh = sunGroup;

      const sunRayMat = new THREE.LineDashedMaterial({
        color: 0xfbbf24,
        dashSize: 0.25,
        gapSize: 0.15,
        transparent: true,
        opacity: 0.65,
      });
      const sunRayLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([pinPos, new THREE.Vector3(6, -2, 6)]),
        sunRayMat
      );
      sunRayLine.computeLineDistances();
      scene.add(sunRayLine);
      refs.sunRayLine = sunRayLine;
      refs.sunRayMat = sunRayMat;

      const earthGroup = new THREE.Group();
      const earthSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.38, 24, 24),
        new THREE.MeshStandardMaterial({
          color: 0x2563eb,
          emissive: 0x1d4ed8,
          emissiveIntensity: 0.65,
          roughness: 0.35,
        })
      );
      const earthLabel = createLabelSprite('🌍 EARTH', '#38bdf8', 'rgba(6, 10, 24, 0.85)', 1.9);
      earthLabel.scale.set(1.7, 0.42, 1);
      earthLabel.position.set(0, 0.8, 0);
      earthGroup.add(earthSphere, earthLabel);
      scene.add(earthGroup);
      refs.earthGroup = earthGroup;

      const commBeamGroup = new THREE.Group();
      const commLineMat = new THREE.LineBasicMaterial({
        color: 0x3ddc97,
        transparent: true,
        opacity: 0.6,
      });
      const commLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([pinPos, refs.earthTargetPos]),
        commLineMat
      );
      commBeamGroup.add(commLine);

      const pulseGeo = new THREE.SphereGeometry(0.055, 10, 10);
      const commPulses = [];
      for (let i = 0; i < 8; i++) {
        const pulseMat = new THREE.MeshBasicMaterial({ color: 0x3ddc97 });
        const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
        commBeamGroup.add(pulseMesh);
        commPulses.push(pulseMesh);
      }
      scene.add(commBeamGroup);
      refs.commBeamGroup = commBeamGroup;
      refs.commPulses = commPulses;
      refs.commLineMat = commLineMat;
      refs.commLine = commLine;
    } else {
      // MODO 3: SUPERFÍCIE LOLA + CORDILHEIRA 360° TRANSLÚCIDA + INDICADOR DE OBSTRUÇÃO SOLAR
      const grid = simData?.terrain_grid;
      const gridSize = grid?.size || 64;
      const segments = gridSize - 1;
      const terrainSpan = 34;
      const terrainGeo = new THREE.PlaneGeometry(terrainSpan, terrainSpan, segments, segments);
      const pos = terrainGeo.attributes.position;

      const elevSpan = grid ? Math.max(10, grid.max_elevation_m - grid.min_elevation_m) : 120;
      const verticalScale = Math.min(3.2, Math.max(0.7, elevSpan / 320));

      const getRawNormH = (row, col) => {
        const idx = row * gridSize + col;
        if (grid?.heights && grid.heights[idx] !== undefined) {
          return grid.heights[idx];
        }
        const vx = ((col / segments) - 0.5) * terrainSpan;
        const vy = (0.5 - (row / segments)) * terrainSpan;
        return 0.18 * Math.sin(vx * 0.25) * Math.cos(vy * 0.25);
      };

      const midA = Math.floor((gridSize - 1) / 2);
      const midB = Math.ceil((gridSize - 1) / 2);
      const centerNormH =
        0.25 *
        (getRawNormH(midA, midA) +
          getRawNormH(midA, midB) +
          getRawNormH(midB, midA) +
          getRawNormH(midB, midB));
      const centerHeight = centerNormH * verticalScale;
      refs.baseCenterY = centerHeight;

      const colors = new Float32Array(pos.count * 3);
      const colorLow = new THREE.Color(0x334155);
      const colorMid = new THREE.Color(0x8896ab);
      const colorHigh = new THREE.Color(0xe2e8f0);
      const tmpColor = new THREE.Color();

      for (let i = 0; i < pos.count; i++) {
        const row = Math.floor(i / gridSize);
        const col = i % gridSize;
        const vx = pos.getX(i);
        const vy = pos.getY(i);
        const distFromCenter = Math.hypot(vx, vy);

        const normH = getRawNormH(row, col);
        let h = normH * verticalScale;

        if (distFromCenter < 1.2) {
          const blend = Math.max(0, Math.min(1, distFromCenter / 1.2));
          h = centerHeight * (1 - blend) + h * blend;
        }

        pos.setZ(i, h);

        const t = Math.min(1, Math.max(0, normH + 0.5));
        if (t < 0.5) {
          tmpColor.lerpColors(colorLow, colorMid, t * 2);
        } else {
          tmpColor.lerpColors(colorMid, colorHigh, (t - 0.5) * 2);
        }
        colors[i * 3] = tmpColor.r;
        colors[i * 3 + 1] = tmpColor.g;
        colors[i * 3 + 2] = tmpColor.b;
      }

      terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      terrainGeo.computeVertexNormals();

      const terrain = new THREE.Mesh(
        terrainGeo,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.9,
          metalness: 0.04,
        })
      );
      terrain.rotation.x = -Math.PI / 2;
      terrain.receiveShadow = true;
      terrain.castShadow = true;
      scene.add(terrain);

      const wireframeOverlay = new THREE.Mesh(
        terrainGeo,
        new THREE.MeshBasicMaterial({
          color: 0x94a3b8,
          wireframe: true,
          transparent: true,
          opacity: 0.05,
        })
      );
      wireframeOverlay.rotation.x = -Math.PI / 2;
      wireframeOverlay.position.y = 0.01;
      scene.add(wireframeOverlay);

      camera.position.set(0, centerHeight + 6.5, 16.5);
      controls.target.set(0, centerHeight + 0.6, 0);
      controls.maxPolarAngle = Math.PI / 2 - 0.02;

      const compassRadius = 26;
      refs.compassRadius = compassRadius;

      const compassRing = new THREE.Mesh(
        new THREE.RingGeometry(compassRadius - 0.15, compassRadius, 128),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.45 })
      );
      compassRing.rotation.x = -Math.PI / 2;
      compassRing.position.y = centerHeight - 0.2;
      scene.add(compassRing);

      const horizonBelt = buildHorizonRidgeBelt(simData?.horizon_profile || [], compassRadius, -0.2);
      horizonBelt.position.y = centerHeight;
      scene.add(horizonBelt);

      const cardinals = [
        { label: 'N 0°', az: 0, color: '#38bdf8' },
        { label: 'E 90°', az: 90, color: '#94a3b8' },
        { label: 'S 180°', az: 180, color: '#94a3b8' },
        { label: 'W 270°', az: 270, color: '#94a3b8' },
      ];
      cardinals.forEach((c) => {
        const sp = createLabelSprite(c.label, c.color, 'rgba(6, 10, 24, 0.85)', 3.4);
        const posC = azElToVector3(c.az, 2, compassRadius);
        posC.y += centerHeight;
        sp.position.copy(posC);
        scene.add(sp);
      });

      const skyRadius = 32;
      if (timeline.length > 1) {
        const sunPathPts = timeline.map((pt) => {
          const v = azElToVector3(pt.sun_azimuth_deg, Math.max(-2, pt.sun_elevation_deg), skyRadius);
          v.y += centerHeight;
          return v;
        });
        const sunOrbitLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(sunPathPts),
          new THREE.LineDashedMaterial({ color: 0xfbbf24, dashSize: 0.8, gapSize: 0.4, transparent: true, opacity: 0.45 })
        );
        sunOrbitLine.computeLineDistances();
        scene.add(sunOrbitLine);

        const earthPathPts = timeline.map((pt) => {
          const v = azElToVector3(pt.earth_azimuth_deg, Math.max(-2, pt.earth_elevation_deg), skyRadius - 4);
          v.y += centerHeight;
          return v;
        });
        const earthOrbitLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(earthPathPts),
          new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 0.6, gapSize: 0.3, transparent: true, opacity: 0.45 })
        );
        earthOrbitLine.computeLineDistances();
        scene.add(earthOrbitLine);
      }

      const landerObj = buildLunarLanderMesh(centerHeight);
      scene.add(landerObj.group);
      refs.landerBody = landerObj.body;
      refs.landerPanelMat = landerObj.panelMat;
      refs.landerPadRing = landerObj.padRing;
      refs.landerTopPos = new THREE.Vector3(0, centerHeight + 1.18, 0);

      const landerLight = new THREE.PointLight(0x38bdf8, 0.5, 7.5);
      landerLight.position.set(0, centerHeight + 1.4, 0);
      scene.add(landerLight);
      refs.landerLight = landerLight;

      const sunGroup = new THREE.Group();
      const sunSphere = new THREE.Mesh(
        new THREE.SphereGeometry(1.15, 32, 32),
        new THREE.MeshBasicMaterial({ color: 0xfffbeb })
      );
      const sunSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: createGlowTexture('rgba(255, 252, 235, 1)', 'rgba(251, 191, 36, 0.85)'),
          color: 0xffd166,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      sunSprite.scale.set(9.5, 9.5, 1);
      const sunLabel = createLabelSprite('☀️ SUN', '#fbbf24', 'rgba(6, 10, 24, 0.85)', 3.6);
      sunLabel.position.set(0, 2.1, 0);
      sunGroup.add(sunSphere, sunSprite, sunLabel);
      scene.add(sunGroup);
      refs.sunMesh = sunGroup;

      const sunRayMat = new THREE.LineDashedMaterial({
        color: 0xfbbf24,
        dashSize: 0.6,
        gapSize: 0.35,
        transparent: true,
        opacity: 0.45,
      });
      const sunRayLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([refs.landerTopPos, new THREE.Vector3(0, 10, -26)]),
        sunRayMat
      );
      sunRayLine.computeLineDistances();
      scene.add(sunRayLine);
      refs.sunRayLine = sunRayLine;
      refs.sunRayMat = sunRayMat;

      const sunBlockBadge = createLabelSprite('⛰️ BLOCKED BY RIDGE', '#ff5c7a', 'rgba(28, 10, 20, 0.92)', 5.2);
      sunBlockBadge.visible = false;
      scene.add(sunBlockBadge);
      refs.sunBlockBadge = sunBlockBadge;

      const earthGroup = new THREE.Group();
      const earthSphere = new THREE.Mesh(
        new THREE.SphereGeometry(1.1, 32, 32),
        new THREE.MeshStandardMaterial({
          color: 0x2563eb,
          emissive: 0x1d4ed8,
          emissiveIntensity: 0.65,
          roughness: 0.35,
        })
      );
      const earthGlow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: createGlowTexture('rgba(96, 165, 250, 0.9)', 'rgba(37, 99, 235, 0.45)'),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      earthGlow.scale.set(6.0, 6.0, 1);
      const earthLabel = createLabelSprite('🌍 EARTH', '#38bdf8', 'rgba(6, 10, 24, 0.85)', 3.8);
      earthLabel.position.set(0, 2.0, 0);
      earthGroup.add(earthSphere, earthGlow, earthLabel);
      scene.add(earthGroup);
      refs.earthGroup = earthGroup;

      const commBeamGroup = new THREE.Group();
      const commLineMat = new THREE.LineBasicMaterial({
        color: 0x3ddc97,
        transparent: true,
        opacity: 0.55,
      });
      const commLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([refs.landerTopPos, refs.earthTargetPos]),
        commLineMat
      );
      commBeamGroup.add(commLine);

      const pulseGeo = new THREE.SphereGeometry(0.14, 12, 12);
      const commPulses = [];
      for (let i = 0; i < 14; i++) {
        const pulseMat = new THREE.MeshBasicMaterial({ color: 0x3ddc97 });
        const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
        commBeamGroup.add(pulseMesh);
        commPulses.push(pulseMesh);
      }

      scene.add(commBeamGroup);
      refs.commBeamGroup = commBeamGroup;
      refs.commPulses = commPulses;
      refs.commLineMat = commLineMat;
      refs.commLine = commLine;
    }

    sceneObjectsRef.current = refs;

    let animId;
    const clock = new THREE.Clock();
    const renderLoop = () => {
      animId = requestAnimationFrame(renderLoop);
      const elapsed = clock.getElapsedTime();
      const r = sceneObjectsRef.current;

      // Interpolação ultra-suave (0.045) de luz, sombras e posições 3D para transições naturais
      if (r.sunLight) {
        r.sunLight.intensity += (r.targetSunIntensity - r.sunLight.intensity) * 0.045;
        r.sunLight.position.lerp(r.sunLightTargetPos, 0.08);
      }
      if (r.hemiLight) {
        r.hemiLight.intensity += (r.targetHemiIntensity - r.hemiLight.intensity) * 0.045;
      }
      if (r.landerLight) {
        r.landerLight.intensity += (r.targetLanderLightIntensity - r.landerLight.intensity) * 0.045;
      }

      // Desliza suavemente a esfera do Sol e o raio solar
      if (r.sunMesh) {
        r.sunMesh.position.lerp(r.sunVisualTargetPos, 0.12);
      }
      if (r.sunRayLine) {
        const originPt = r.viewMode === 'globo' ? r.globePinPos : r.landerTopPos;
        r.sunRayLine.geometry.setFromPoints([originPt, r.sunRayEndTargetPos]);
        r.sunRayLine.computeLineDistances();
      }

      // Desliza suavemente a Terra e a linha de comunicação DTE (sem saltos!)
      if (r.earthGroup) {
        r.earthCurrentPos.lerp(r.earthTargetPos, 0.12);
        r.earthGroup.position.copy(r.earthCurrentPos);
        if (r.commLine) {
          const originPt = r.viewMode === 'globo' ? r.globePinPos : r.landerTopPos;
          r.commLine.geometry.setFromPoints([originPt, r.earthCurrentPos]);
        }
      }

      if (r.commPulses && r.commPulses.length > 0) {
        const originPt = r.viewMode === 'globo' ? r.globePinPos : r.landerTopPos;
        const count = r.commPulses.length;
        for (let i = 0; i < count; i++) {
          const pMesh = r.commPulses[i];
          const t = r.earthVisibleNow
            ? ((i / count) + elapsed * 0.28) % 1.0
            : (i + 0.5) / count;
          pMesh.position.lerpVectors(originPt, r.earthCurrentPos, t);
          pMesh.scale.setScalar(r.earthVisibleNow ? 1.0 : 0.65);
        }
      }

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

  // Atualiza os alvos físicos a cada passo do slider
  useEffect(() => {
    const refs = sceneObjectsRef.current;
    if (!refs.sunLight) return;

    const sunElev = Number(activeFrame.sun_elevation_deg || 0);
    const sunAz = Number(activeFrame.sun_azimuth_deg || 0);
    const maskElev = Number(activeFrame.terrain_mask_deg || 0);
    const earthElev = Number(activeFrame.earth_elevation_deg || 0);
    const earthAz = Number(activeFrame.earth_azimuth_deg || 0);

    const sunVisible = Boolean(activeFrame.sun_visible);
    const earthVisible = activeFrame.earth_visible !== undefined
      ? Boolean(activeFrame.earth_visible)
      : earthElev > 0;
    refs.earthVisibleNow = earthVisible;

    const baseCenterY = refs.baseCenterY || 0;

    if (viewMode === 'viagem') {
      const spaceSunPos = azElToVector3(sunAz, Math.max(8, sunElev), 38);
      refs.sunLightTargetPos.copy(spaceSunPos);
      refs.targetSunIntensity = 3.2;
      refs.targetHemiIntensity = 0.55;
    } else if (viewMode === 'globo') {
      // MODO 2 (GLOBO 3D): Elevação 100% CONTÍNUA (sem saltos de if/else ao mudar sunVisible ou earthVisible!)
      const siteLat = simData?.lat ?? -89.9;
      const siteLon = simData?.lon ?? 0.0;

      // Usa sunElev contínuo (com leve offset constante de +6° para iluminar tangencialmente a calota polar sul)
      const continuousSunEl = sunElev * 1.5 + 6.0;
      const sunGlobePos = localAzElToGlobeVector3(siteLat, siteLon, sunAz, continuousSunEl, 8.2);
      refs.sunVisualTargetPos.copy(sunGlobePos);
      refs.sunRayEndTargetPos.copy(sunGlobePos);
      refs.sunLightTargetPos.copy(sunGlobePos.clone().multiplyScalar(3.5));

      const solarFactor = smoothSolarFactor(sunElev, maskElev);
      refs.targetSunIntensity = 2.6 + 0.8 * solarFactor;
      refs.targetHemiIntensity = 0.35 + 0.15 * solarFactor;

      if (refs.sunRayMat) {
        refs.sunRayMat.color.setHex(sunVisible ? 0xfbbf24 : 0xff5c7a);
        refs.sunRayMat.opacity = sunVisible ? 0.75 : 0.35;
      }

      // Usa earthElev 100% contínuo (sem nenhum salto quando earthVisible muda!)
      const continuousEarthEl = earthElev * 1.5 + 4.0;
      const earthGlobePos = localAzElToGlobeVector3(siteLat, siteLon, earthAz, continuousEarthEl, 6.8);
      refs.earthTargetPos.copy(earthGlobePos);

      if (!refs.initializedPositions) {
        refs.earthCurrentPos.copy(earthGlobePos);
        if (refs.sunMesh) refs.sunMesh.position.copy(sunGlobePos);
        refs.initializedPositions = true;
      }

      if (refs.commLineMat) {
        const beamColor = earthVisible ? 0x3ddc97 : 0xff5c7a;
        refs.commLineMat.color.setHex(beamColor);
        refs.commLineMat.opacity = earthVisible ? 0.7 : 0.25;
        refs.commPulses.forEach((p) => p.material.color.setHex(beamColor));
      }

      if (refs.globePin) {
        const instantColor = sunVisible && earthVisible
          ? 0x3ddc97
          : sunVisible
          ? 0xfbbf24
          : 0xff5c7a;
        refs.globePin.material.color.setHex(instantColor);
      }
    } else {
      // MODO 3 (LOCAL SURFACE): Transição suave e contínua de crepúsculo/penumbra
      const solarFactor = smoothSolarFactor(sunElev, maskElev);
      const lightEl = Math.max(4.0, sunElev);
      const sunLightPos = azElToVector3(sunAz, lightEl, 38);
      sunLightPos.y += baseCenterY;

      refs.sunLightTargetPos.copy(sunLightPos);
      // Penumbra suave: mínimo de 0.32 na sombra para não ficar agressivo e máximo de 3.2 no sol pleno
      refs.targetSunIntensity = 0.32 + 2.88 * solarFactor;
      refs.targetHemiIntensity = 0.32 + 0.42 * solarFactor;
      refs.targetLanderLightIntensity = 2.0 * (1 - solarFactor) + 0.3;

      const sunVisualPos = azElToVector3(sunAz, sunElev, 32);
      sunVisualPos.y += baseCenterY;
      refs.sunVisualTargetPos.copy(sunVisualPos);

      const earthPos = azElToVector3(earthAz, earthElev, 28);
      earthPos.y += baseCenterY;
      refs.earthTargetPos.copy(earthPos);

      if (!refs.initializedPositions) {
        refs.earthCurrentPos.copy(earthPos);
        if (refs.sunMesh) refs.sunMesh.position.copy(sunVisualPos);
        refs.initializedPositions = true;
      }

      if (refs.sunRayMat && refs.sunBlockBadge) {
        const visualRidgeDeg = Math.min(22, Math.max(0.2, maskElev) * 1.85 + 0.6);
        const ridgeHitPos = azElToVector3(sunAz, visualRidgeDeg, refs.compassRadius || 26);
        ridgeHitPos.y += baseCenterY;

        if (!sunVisible) {
          refs.sunRayEndTargetPos.copy(ridgeHitPos);
          refs.sunRayMat.color.setHex(0xff5c7a);
          refs.sunRayMat.opacity = 0.85;

          refs.sunBlockBadge.position.copy(ridgeHitPos).add(new THREE.Vector3(0, 1.4, 0));
          refs.sunBlockBadge.visible = true;
        } else {
          refs.sunRayEndTargetPos.copy(sunVisualPos);
          refs.sunRayMat.color.setHex(0xfbbf24);
          refs.sunRayMat.opacity = 0.38;
          refs.sunBlockBadge.visible = false;
        }
      }

      if (refs.commLineMat) {
        const beamColor = earthVisible ? 0x3ddc97 : 0xff5c7a;
        refs.commLineMat.color.setHex(beamColor);
        refs.commLineMat.opacity = earthVisible ? 0.65 : 0.28;
        refs.commPulses.forEach((p) => p.material.color.setHex(beamColor));
      }
    }

    if (refs.landerBody) {
      refs.landerBody.material.color.setHex(sunVisible ? 0xf59e0b : 0x38bdf8);
      if (refs.landerPadRing) {
        refs.landerPadRing.material.color.setHex(sunVisible ? 0xfbbf24 : 0x38bdf8);
      }
    }

    if (refs.probeMesh && refs.tliPoints.length > 1) {
      const maxT = Math.max(1, timeline.length - 1);
      const probeIdx = Math.min(
        refs.tliPoints.length - 1,
        Math.floor((stepIdx / maxT) * refs.tliPoints.length)
      );
      refs.probeMesh.position.copy(refs.tliPoints[probeIdx]);
    }
  }, [stepIdx, activeFrame, viewMode, timeline.length, simData]);

  function handleSliderChange(e) {
    setIsPlaying(false);
    const nextIdx = Number(e.target.value);
    setStepIdx(nextIdx);
    if (onStepChange) onStepChange(nextIdx);
  }

  const sunVis = Boolean(activeFrame.sun_visible);
  const earthElevNow = Number(activeFrame.earth_elevation_deg || 0);
  const earthVis = activeFrame.earth_visible !== undefined
    ? Boolean(activeFrame.earth_visible)
    : earthElevNow > 0;
  const sunElevNow = Number(activeFrame.sun_elevation_deg || 0);
  const ridgeElevNow = Number(activeFrame.terrain_mask_deg || 0);

  return html`
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className=${`btn small ${viewMode === 'viagem' ? 'primary' : ''}`}
            onClick=${() => setViewMode('viagem')}
          >
            1. TLI Transfer
          </button>
          <button
            type="button"
            className=${`btn small ${viewMode === 'globo' ? 'primary' : ''}`}
            onClick=${() => setViewMode('globo')}
          >
            2. 3D Globe (LOLA)
          </button>
          <button
            type="button"
            className=${`btn small ${viewMode === 'superficie' ? 'primary' : ''}`}
            onClick=${() => setViewMode('superficie')}
          >
            3. Local Surface
          </button>
        </div>

        <span className="text-xs font-mono text-slate-400">
          ${translatePhaseName(fasesData?.fase_nome)}
        </span>
      </div>

      <div className="relative w-full h-[420px] rounded-lg overflow-hidden border border-slate-800">
        <div ref=${canvasWrapRef} className="w-full h-full"></div>

        <div className="hud-3d" aria-live="polite">
          <div>
            <span>SUN</span>
            <strong>${sunElevNow.toFixed(2)}°</strong>
            <em className=${sunVis ? 'ok' : 'bad'}>
              ${sunVis ? 'SOLAR POWER' : `BLOCKED BY RIDGE (${ridgeElevNow.toFixed(1)}°)`}
            </em>
          </div>
          <div>
            <span>EARTH</span>
            <strong>${earthElevNow.toFixed(2)}°</strong>
            <em className=${earthVis ? 'ok' : 'bad'}>${earthVis ? 'DTE LINK' : 'OCCULTED'}</em>
          </div>
          ${simData?.terrain_grid &&
          html`
            <div>
              <span>LOLA ELEV</span>
              <strong>${simData.terrain_grid.min_elevation_m}m to ${simData.terrain_grid.max_elevation_m}m</strong>
            </div>
          `}
        </div>
      </div>

      <div className="slider-bar">
        <button
          type="button"
          className="btn small"
          onClick=${() => setIsPlaying((p) => !p)}
          disabled=${timeline.length <= 1}
        >
          ${isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>

        <label htmlFor="time-slider-3d" className="text-xs font-mono text-slate-300 whitespace-nowrap">
          <strong>
            ${activeFrame.timestamp
              ? activeFrame.timestamp.replace('T', ' ').slice(0, 16) + ' UTC'
              : 'Awaiting simulation'}
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