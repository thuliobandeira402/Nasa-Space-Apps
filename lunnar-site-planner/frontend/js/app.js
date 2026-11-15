/**
 * Interactive 3D Component (React 18 + HTM + Three.js)
 * 100% Real Data: High-Density NASA LRO/LOLA DEM (128x128, 36 km span) & JPL DE421 Ephemerides
 */

import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getLolaPolarMapUrl } from './api.js';

const html = htm.bind(React.createElement);
let reactRoot = null;

function azElToVector3(azDeg, elDeg, radius) {
  const az = THREE.MathUtils.degToRad(azDeg || 0);
  const el = THREE.MathUtils.degToRad(elDeg || 0);
  return new THREE.Vector3(
    radius * Math.cos(el) * Math.sin(az),
    radius * Math.sin(el),
    -radius * Math.cos(el) * Math.cos(az)
  );
}

function localAzElToGlobeVector3(latDeg, lonDeg, azDeg, elDeg, radius) {
  const lat = THREE.MathUtils.degToRad(latDeg ?? -89.9);
  const lon = THREE.MathUtils.degToRad(lonDeg ?? 0);
  const az = THREE.MathUtils.degToRad(azDeg || 0);
  const el = THREE.MathUtils.degToRad(elDeg || 0);

  const up = new THREE.Vector3(
    Math.cos(lat) * Math.cos(lon),
    Math.sin(lat),
    Math.cos(lat) * Math.sin(lon)
  ).normalize();

  const east = new THREE.Vector3(-Math.sin(lon), 0, Math.cos(lon)).normalize();
  const north = new THREE.Vector3(
    -Math.sin(lat) * Math.cos(lon),
    Math.cos(lat),
    -Math.sin(lat) * Math.sin(lon)
  ).normalize();

  const dir = new THREE.Vector3()
    .addScaledVector(north, Math.cos(el) * Math.cos(az))
    .addScaledVector(east, Math.cos(el) * Math.sin(az))
    .addScaledVector(up, Math.sin(el))
    .normalize();

  return dir.multiplyScalar(radius);
}

function solarDiscIlluminatedFraction(sunElevDeg, maskElevDeg) {
  const R = 0.265;
  const h = sunElevDeg - (maskElevDeg || 0);
  if (h <= -R) return 0.0;
  if (h >= R) return 1.0;
  const u = Math.max(-1, Math.min(1, h / R));
  return 0.5 + (u * Math.sqrt(1 - u * u) + Math.asin(u)) / Math.PI;
}

function getHorizonMaskAtAzimuth(horizonProfile = [], azDeg = 0) {
  if (!Array.isArray(horizonProfile) || horizonProfile.length === 0) return 0;
  const norm = ((azDeg % 360) + 360) % 360;
  const exactIdx = (norm / 360) * (horizonProfile.length - 1);
  const i0 = Math.floor(exactIdx);
  const i1 = Math.min(horizonProfile.length - 1, i0 + 1);
  const frac = exactIdx - i0;
  const e0 = horizonProfile[i0]?.elevation_deg ?? 0;
  const e1 = horizonProfile[i1]?.elevation_deg ?? 0;
  return e0 * (1 - frac) + e1 * frac;
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

/**
 * Cria rótulo 3D compacto, nítido e proporcional (screenHeight = 0.036 por padrão)
 * para ser lido de qualquer distância sem tampar a cena.
 */
function createLabelSprite(text, colorHex = '#ffffff', bgRgba = 'rgba(6, 10, 24, 0.9)', screenHeight = 0.036) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontStr = '700 34px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.font = fontStr;

  const textWidth = Math.ceil(ctx.measureText(text).width);
  const padX = 28;
  const width = Math.max(140, textWidth + padX * 2);
  const height = 68;

  canvas.width = width;
  canvas.height = height;

  ctx.font = fontStr;
  ctx.fillStyle = bgRgba;
  ctx.strokeStyle = colorHex;
  ctx.lineWidth = 3.5;

  ctx.beginPath();
  ctx.roundRect(4, 4, width - 8, height - 8, 14);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
  });

  const sprite = new THREE.Sprite(mat);
  const aspect = width / height;
  sprite.scale.set(screenHeight * aspect, screenHeight, 1);
  sprite.renderOrder = 999;
  return sprite;
}

function createStarfield(count = 3200, minRadius = 120, maxRadius = 240) {
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

// Constrói o anel de horizonte distante de 40 km do LOLA ao redor da malha local
// para mostrar fisicamente montanhas distantes que bloqueiam Sol ou Terra
function buildHorizonRidgeMesh(horizonProfile = [], radius = 24, baseY = -1.5) {
  const group = new THREE.Group();
  if (!Array.isArray(horizonProfile) || horizonProfile.length < 3) {
    return { group, wallMesh: null };
  }

  const segs = 180;
  const positions = new Float32Array((segs + 1) * 2 * 3);
  const colors = new Float32Array((segs + 1) * 2 * 3);
  const indices = [];
  const crestPts = [];

  for (let i = 0; i <= segs; i++) {
    const az = (i / segs) * 360;
    const elevDeg = Math.max(0.0, getHorizonMaskAtAzimuth(horizonProfile, az));
    const topVec = azElToVector3(az, elevDeg, radius);
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

    colors[vIdx * 3] = 0.08;
    colors[vIdx * 3 + 1] = 0.11;
    colors[vIdx * 3 + 2] = 0.18;

    colors[(vIdx + 1) * 3] = 0.36;
    colors[(vIdx + 1) * 3 + 1] = 0.44;
    colors[(vIdx + 1) * 3 + 2] = 0.58;

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
    opacity: 0.55,
    side: THREE.DoubleSide,
  });
  const wallMesh = new THREE.Mesh(wallGeo, wallMat);
  group.add(wallMesh);

  const crestLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(crestPts),
    new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.75 })
  );
  group.add(crestLine);

  return { group, wallMesh };
}

function computeTerrainVertexColors(grid, posCount, colorMode = 'natural') {
  const colors = new Float32Array(posCount * 3);
  const tmpColor = new THREE.Color();

  const cRegolithDark = new THREE.Color(0x525866);
  const cRegolithMid = new THREE.Color(0x9ca3af);
  const cRegolithBright = new THREE.Color(0xe5e7eb);

  const cElevLow = new THREE.Color(0x1e3a8a);
  const cElevMid = new THREE.Color(0x10b981);
  const cElevHigh = new THREE.Color(0xfbbf24);
  const cElevPeak = new THREE.Color(0xf8fafc);

  const cSlopeSafe = new THREE.Color(0x10b981);
  const cSlopeWarn = new THREE.Color(0xf59e0b);
  const cSlopeDanger = new THREE.Color(0xef4444);

  for (let i = 0; i < posCount; i++) {
    const normH = grid?.heights?.[i] ?? 0;
    const tElev = Math.min(1, Math.max(0, normH + 0.5));
    const slopeDeg = grid?.slopes?.[i] ?? 5.0;

    if (colorMode === 'elevation') {
      if (tElev < 0.35) {
        tmpColor.lerpColors(cElevLow, cElevMid, tElev / 0.35);
      } else if (tElev < 0.75) {
        tmpColor.lerpColors(cElevMid, cElevHigh, (tElev - 0.35) / 0.4);
      } else {
        tmpColor.lerpColors(cElevHigh, cElevPeak, (tElev - 0.75) / 0.25);
      }
    } else if (colorMode === 'slope') {
      if (slopeDeg <= 10.0) {
        tmpColor.lerpColors(cSlopeSafe, cSlopeWarn, slopeDeg / 10.0);
      } else {
        const tS = Math.min(1, (slopeDeg - 10.0) / 12.0);
        tmpColor.lerpColors(cSlopeWarn, cSlopeDanger, tS);
      }
    } else {
      if (tElev < 0.5) {
        tmpColor.lerpColors(cRegolithDark, cRegolithMid, tElev * 2.0);
      } else {
        tmpColor.lerpColors(cRegolithMid, cRegolithBright, (tElev - 0.5) * 2.0);
      }
    }

    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  return colors;
}

function buildLunarLanderMesh() {
  const group = new THREE.Group();

  const padRing = new THREE.Mesh(
    new THREE.RingGeometry(0.32, 0.44, 32),
    new THREE.MeshBasicMaterial({ color: 0xfbbf24, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
  );
  padRing.rotation.x = -Math.PI / 2;
  padRing.position.y = 0.02;
  group.add(padRing);

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.22, 0.38, 8),
    new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0x78350f,
      emissiveIntensity: 0.25,
      metalness: 0.55,
      roughness: 0.3,
    })
  );
  body.position.y = 0.26;
  body.castShadow = true;
  group.add(body);

  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.15, 0.14, 12),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.35, roughness: 0.35 })
  );
  top.position.y = 0.5;
  group.add(top);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 0.22, 8),
    new THREE.MeshBasicMaterial({ color: 0xe2e8f0 })
  );
  mast.position.y = 0.65;
  group.add(mast);

  const legMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.6, roughness: 0.35 });
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 8), legMat);
    leg.position.set(Math.cos(angle) * 0.22, 0.14, Math.sin(angle) * 0.22);
    leg.rotation.z = -Math.cos(angle) * 0.55;
    leg.rotation.x = Math.sin(angle) * 0.55;
    group.add(leg);

    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.025, 12), legMat);
    foot.position.set(Math.cos(angle) * 0.32, 0.015, Math.sin(angle) * 0.32);
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
  const leftPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.22), panelMat);
  leftPanel.position.set(-0.38, 0.34, 0);
  const rightPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.22), panelMat);
  rightPanel.position.set(0.38, 0.34, 0);
  group.add(leftPanel, rightPanel);

  return { group, body, panelMat, padRing };
}

function LunarScene3D({ simData, viagemData, fasesData, onStepChange }) {
  const [viewMode, setViewMode] = useState('superficie'); // 'viagem' | 'globo' | 'superficie'
  const [colorMode, setColorMode] = useState('natural');  // 'natural' | 'elevation' | 'slope'
  const [vertExag, setVertExag] = useState(1.5);          // Exagero vertical (1.0x a 4.0x)
  const [stepIdx, setStepIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const canvasWrapRef = useRef(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const sceneObjectsRef = useRef({
    viewMode: 'superficie',
    terrainGeo: null,
    terrainMesh: null,
    horizonBeltGroup: null,
    horizonWallMesh: null,
    landerGroup: null,
    sunLight: null,
    hemiLight: null,
    rimLight: null,
    sunMesh: null,
    sunRayLine: null,
    sunRayMat: null,
    earthGroup: null,
    commBeamGroup: null,
    commPulses: [],
    commLineMat: null,
    commLine: null,
    commBlockGroup: null,
    globePin: null,
    globePinPos: new THREE.Vector3(0, -2.24, 0),
    landerBody: null,
    landerPanelMat: null,
    landerPadRing: null,
    landerLight: null,
    probeMesh: null,
    tliPoints: [],
    landerTopPos: new THREE.Vector3(0, 0.72, 0),
    earthTargetPos: new THREE.Vector3(0, 8, -28),
    earthCurrentPos: new THREE.Vector3(0, 8, -28),
    commBeamEndPos: new THREE.Vector3(0, 8, -28),
    sunVisualTargetPos: new THREE.Vector3(20, 5, 20),
    sunLightTargetPos: new THREE.Vector3(20, -10, 20),
    sunRayEndTargetPos: new THREE.Vector3(20, 5, 20),
    targetSunIntensity: 3.6,
    targetHemiIntensity: 0.22,
    targetLanderLightIntensity: 0.3,
    earthVisibleNow: true,
    compassRadius: 24,
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

  // Atualiza cores do terreno e escala vertical instantaneamente sem recriar a câmera!
  useEffect(() => {
    const refs = sceneObjectsRef.current;
    const grid = simData?.terrain_grid;
    if (viewMode !== 'superficie' || !refs.terrainGeo || !grid) return;

    const terrainGeo = refs.terrainGeo;
    const pos = terrainGeo.attributes.position;
    const gridSize = grid.size || Math.round(Math.sqrt(pos.count));
    const terrainSpan = 36;

    const elevSpanM = Math.max(10, (grid.max_elevation_m ?? 1000) - (grid.min_elevation_m ?? 0));
    const spanMeters = (grid.span_km || 36.0) * 1000.0;
    const physicalRatio = elevSpanM / spanMeters;

    for (let i = 0; i < pos.count; i++) {
      let h = 0;
      if (Array.isArray(grid.heights_rel) && grid.heights_rel[i] !== undefined) {
        h = grid.heights_rel[i] * terrainSpan * vertExag;
      } else if (Array.isArray(grid.heights) && grid.heights[i] !== undefined) {
        h = grid.heights[i] * terrainSpan * Math.max(0.08, physicalRatio) * vertExag;
      }
      pos.setZ(i, h);
    }
    pos.needsUpdate = true;
    terrainGeo.computeVertexNormals();
    terrainGeo.computeBoundingBox();
    terrainGeo.computeBoundingSphere();

    const c = Math.floor(gridSize / 2);
    const getZ = (r, col) => pos.getZ(Math.min(gridSize - 1, Math.max(0, r)) * gridSize + Math.min(gridSize - 1, Math.max(0, col)));
    const centerZ = 0.25 * (getZ(c - 1, c - 1) + getZ(c - 1, c) + getZ(c, c - 1) + getZ(c, c));
    const stepWorld = terrainSpan / Math.max(1, gridSize - 1);
    const dzdx = (getZ(c, c + 1) - getZ(c, c - 1)) / (2 * stepWorld);
    const dzdy = (getZ(c - 1, c) - getZ(c + 1, c)) / (2 * stepWorld);
    const normalVec = new THREE.Vector3(-dzdx, 1, dzdy).normalize();

    if (refs.landerGroup) {
      refs.landerGroup.position.set(0, centerZ, 0);
      refs.landerGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normalVec);
      refs.landerTopPos.set(0, centerZ + 0.72, 0);
      if (refs.landerLight) {
        refs.landerLight.position.set(0, centerZ + 1.1, 0);
      }
    }

    if (refs.horizonBeltGroup) {
      refs.horizonBeltGroup.position.y = centerZ + 0.72;
      refs.horizonBeltGroup.scale.set(1, vertExag, 1);
    }

    const newColors = computeTerrainVertexColors(grid, pos.count, colorMode);
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(newColors, 3));
    terrainGeo.attributes.color.needsUpdate = true;
  }, [colorMode, vertExag, simData, viewMode]);

  useEffect(() => {
    const container = canvasWrapRef.current;
    if (!container) return;

    const width = container.clientWidth || 720;
    const height = 430;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#030612');
    scene.add(createStarfield(3200, 120, 240));

    const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 600);
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
    controls.maxDistance = 90;
    controls.minDistance = 1.8;

    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x090d16, 0.16);
    scene.add(hemiLight);

    const rimLight = new THREE.DirectionalLight(0x334155, 0.08);
    rimLight.position.set(-22, 14, -22);
    scene.add(rimLight);

    const sunLight = new THREE.DirectionalLight(0xfffbeb, 3.8);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 120;
    const d = 22;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0004;
    scene.add(sunLight);

    const refs = {
      viewMode,
      terrainGeo: null,
      terrainMesh: null,
      horizonBeltGroup: null,
      horizonWallMesh: null,
      landerGroup: null,
      sunLight,
      hemiLight,
      rimLight,
      sunMesh: null,
      sunRayLine: null,
      sunRayMat: null,
      earthGroup: null,
      commBeamGroup: null,
      commPulses: [],
      commLineMat: null,
      commLine: null,
      commBlockGroup: null,
      globePin: null,
      globePinPos: new THREE.Vector3(0, -2.24, 0),
      landerBody: null,
      landerPanelMat: null,
      landerPadRing: null,
      landerLight: null,
      probeMesh: null,
      tliPoints: [],
      landerTopPos: new THREE.Vector3(0, 0.72, 0),
      earthTargetPos: new THREE.Vector3(0, 8, -28),
      earthCurrentPos: new THREE.Vector3(0, 8, -28),
      commBeamEndPos: new THREE.Vector3(0, 8, -28),
      sunVisualTargetPos: new THREE.Vector3(20, 5, 20),
      sunLightTargetPos: new THREE.Vector3(25, -10, 20),
      sunRayEndTargetPos: new THREE.Vector3(20, 5, 20),
      targetSunIntensity: 3.8,
      targetHemiIntensity: 0.16,
      targetLanderLightIntensity: 0.3,
      earthVisibleNow: true,
      compassRadius: 24,
    };

    const initFrame = timeline[stepIdx] || activeFrame;
    const initSunEl = Number(initFrame.sun_elevation_deg || 0);
    const initSunAz = Number(initFrame.sun_azimuth_deg || 0);
    const initEarthEl = Number(initFrame.earth_elevation_deg || 0);
    const initEarthAz = Number(initFrame.earth_azimuth_deg || 0);

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
      const earthLabel = createLabelSprite('🌍 EARTH', '#38bdf8', 'rgba(6, 10, 24, 0.9)', 0.036);
      earthLabel.position.set(0, 1.55, 0);
      earthGroup.add(earthMesh, atmoMesh, earthLabel);

      const moonGroup = new THREE.Group();
      moonGroup.position.set(mPos.x, mPos.y, mPos.z);
      const moon = new THREE.Mesh(
        new THREE.SphereGeometry(0.46, 32, 32),
        new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.92 })
      );
      const moonLabel = createLabelSprite('☾ MOON', '#cbd5e1', 'rgba(6, 10, 24, 0.9)', 0.034);
      moonLabel.position.set(0, 0.85, 0);
      moonGroup.add(moon, moonLabel);

      scene.add(earthGroup, moonGroup);

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
      camera.position.set(0, -4.6, 5.8);
      controls.target.set(0, -0.5, 0);

      const globeMat = new THREE.MeshStandardMaterial({
        color: 0xdbeafe,
        roughness: 0.92,
        metalness: 0.02,
      });

      const globe = new THREE.Mesh(new THREE.SphereGeometry(2.2, 96, 96), globeMat);
      scene.add(globe);

      const texLoader = new THREE.TextureLoader();
      texLoader.load(
        getLolaPolarMapUrl(),
        (lolaTex) => {
          const capRadius = 2.206 * Math.sin(THREE.MathUtils.degToRad(10));
          const capGeo = new THREE.CircleGeometry(capRadius, 64);
          const capMat = new THREE.MeshStandardMaterial({
            map: lolaTex,
            roughness: 0.9,
            metalness: 0.03,
            side: THREE.DoubleSide,
          });
          const polarCap = new THREE.Mesh(capGeo, capMat);
          polarCap.rotation.x = Math.PI / 2;
          polarCap.position.y = -2.202 * Math.cos(THREE.MathUtils.degToRad(10));
          globe.add(polarCap);
        },
        undefined,
        () => {}
      );

      const gridHelper = new THREE.PolarGridHelper(2.25, 12, 4, 64, 0x334155, 0x1e293b);
      gridHelper.rotation.x = Math.PI / 2;
      globe.add(gridHelper);

      const siteLat = simData?.lat ?? -89.9;
      const siteLon = simData?.lon ?? 0.0;
      const latRad = THREE.MathUtils.degToRad(siteLat);
      const lonRad = THREE.MathUtils.degToRad(siteLon);
      const r = 2.24;
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

      const sunInitPos = localAzElToGlobeVector3(siteLat, siteLon, initSunAz, initSunEl, 8.2);
      const earthInitPos = localAzElToGlobeVector3(siteLat, siteLon, initEarthAz, initEarthEl, 6.8);
      refs.sunVisualTargetPos.copy(sunInitPos);
      refs.sunLightTargetPos.copy(sunInitPos.clone().multiplyScalar(4.0));
      refs.earthTargetPos.copy(earthInitPos);
      refs.earthCurrentPos.copy(earthInitPos);
      refs.commBeamEndPos.copy(earthInitPos);
      sunLight.position.copy(refs.sunLightTargetPos);

      const sunGroup = new THREE.Group();
      sunGroup.position.copy(sunInitPos);
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
      const sunLabel = createLabelSprite('☀️ SUN', '#fbbf24', 'rgba(6, 10, 24, 0.9)', 0.036);
      sunLabel.position.set(0, 0.9, 0);
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
        new THREE.BufferGeometry().setFromPoints([pinPos, sunInitPos]),
        sunRayMat
      );
      sunRayLine.computeLineDistances();
      scene.add(sunRayLine);
      refs.sunRayLine = sunRayLine;
      refs.sunRayMat = sunRayMat;

      const earthGroup = new THREE.Group();
      earthGroup.position.copy(earthInitPos);
      const earthSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.38, 24, 24),
        new THREE.MeshStandardMaterial({
          color: 0x2563eb,
          emissive: 0x1d4ed8,
          emissiveIntensity: 0.65,
          roughness: 0.35,
        })
      );
      const earthLabel = createLabelSprite('🌍 EARTH', '#38bdf8', 'rgba(6, 10, 24, 0.9)', 0.036);
      earthLabel.position.set(0, 0.85, 0);
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
        new THREE.BufferGeometry().setFromPoints([pinPos, earthInitPos]),
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
      // MODO 3: RELEVO REAL LOLA + CORDILHEIRA 360° + VETORES ANCORADOS NA SONDA
      const grid = simData?.terrain_grid;
      const gridSize = grid?.size || 128;
      const segments = gridSize - 1;
      const terrainSpan = 36;
      const terrainGeo = new THREE.PlaneGeometry(terrainSpan, terrainSpan, segments, segments);
      const pos = terrainGeo.attributes.position;

      const elevSpanM = grid ? Math.max(10, (grid.max_elevation_m ?? 1000) - (grid.min_elevation_m ?? 0)) : 10;
      const spanMeters = (grid?.span_km || 36.0) * 1000.0;
      const physicalRatio = elevSpanM / spanMeters;

      for (let i = 0; i < pos.count; i++) {
        let h = 0;
        if (grid && Array.isArray(grid.heights_rel) && grid.heights_rel[i] !== undefined) {
          h = grid.heights_rel[i] * terrainSpan * vertExag;
        } else if (grid && Array.isArray(grid.heights) && grid.heights[i] !== undefined) {
          h = grid.heights[i] * terrainSpan * Math.max(0.08, physicalRatio) * vertExag;
        }
        pos.setZ(i, h);
      }

      const initColors = computeTerrainVertexColors(grid, pos.count, colorMode);
      terrainGeo.setAttribute('color', new THREE.BufferAttribute(initColors, 3));
      terrainGeo.computeVertexNormals();
      terrainGeo.computeBoundingBox();
      terrainGeo.computeBoundingSphere();

      const terrain = new THREE.Mesh(
        terrainGeo,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.92,
          metalness: 0.03,
        })
      );
      terrain.rotation.x = -Math.PI / 2;
      terrain.receiveShadow = true;
      terrain.castShadow = true;
      scene.add(terrain);

      refs.terrainGeo = terrainGeo;
      refs.terrainMesh = terrain;

      const c = Math.floor(gridSize / 2);
      const getZ = (r, col) => pos.getZ(Math.min(gridSize - 1, Math.max(0, r)) * gridSize + Math.min(gridSize - 1, Math.max(0, col)));
      const centerZ = 0.25 * (getZ(c - 1, c - 1) + getZ(c - 1, c) + getZ(c, c - 1) + getZ(c, c));
      const stepWorld = terrainSpan / Math.max(1, gridSize - 1);
      const dzdx = (getZ(c, c + 1) - getZ(c, c - 1)) / (2 * stepWorld);
      const dzdy = (getZ(c - 1, c) - getZ(c + 1, c)) / (2 * stepWorld);
      const normalVec = new THREE.Vector3(-dzdx, 1, dzdy).normalize();

      camera.position.set(-4.5, centerZ + 4.8, 12.5);
      controls.target.set(0, centerZ + 0.3, 0);
      controls.maxPolarAngle = Math.PI / 2 - 0.01;

      const landerObj = buildLunarLanderMesh();
      landerObj.group.position.set(0, centerZ, 0);
      landerObj.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normalVec);
      scene.add(landerObj.group);

      refs.landerGroup = landerObj.group;
      refs.landerBody = landerObj.body;
      refs.landerPanelMat = landerObj.panelMat;
      refs.landerPadRing = landerObj.padRing;
      refs.landerTopPos = new THREE.Vector3(0, centerZ + 0.72, 0);

      // Silhueta 3D da Cordilheira do Horizonte (40 km LOLA) ancorada no nível da sonda
      const horizonObj = buildHorizonRidgeMesh(simData?.horizon_profile || [], 24, -2.5);
      horizonObj.group.position.y = centerZ + 0.72;
      horizonObj.group.scale.set(1, vertExag, 1);
      scene.add(horizonObj.group);
      refs.horizonBeltGroup = horizonObj.group;
      refs.horizonWallMesh = horizonObj.wallMesh;

      const landerLight = new THREE.PointLight(0x38bdf8, 0.4, 6.0);
      landerLight.position.set(0, centerZ + 1.1, 0);
      scene.add(landerLight);
      refs.landerLight = landerLight;

      // Posições iniciais do Sol e da Terra ancoradas na altura da antena do Lander (landerTopPos)!
      const sunInitVisual = refs.landerTopPos.clone().add(azElToVector3(initSunAz, initSunEl * vertExag, 34));
      const earthInitVisual = refs.landerTopPos.clone().add(azElToVector3(initEarthAz, initEarthEl * vertExag, 30));
      refs.sunVisualTargetPos.copy(sunInitVisual);
      refs.earthTargetPos.copy(earthInitVisual);
      refs.earthCurrentPos.copy(earthInitVisual);
      refs.commBeamEndPos.copy(earthInitVisual);

      // Sol no Céu + Rótulo "☀️ SUN" compacto e legível
      const sunGroup = new THREE.Group();
      sunGroup.position.copy(sunInitVisual);
      const sunSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.95, 32, 32),
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
      sunSprite.scale.set(8.0, 8.0, 1);
      const sunLabel = createLabelSprite('☀️ SUN', '#fbbf24', 'rgba(6, 10, 24, 0.92)', 0.036);
      sunLabel.position.set(0, 1.9, 0);
      sunGroup.add(sunSphere, sunSprite, sunLabel);
      scene.add(sunGroup);
      refs.sunMesh = sunGroup;

      // Terra no Céu + Rótulo "🌍 EARTH" compacto e legível
      const earthGroup = new THREE.Group();
      earthGroup.position.copy(earthInitVisual);
      const earthSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.9, 32, 32),
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
      earthGlow.scale.set(5.2, 5.2, 1);
      const earthLabel = createLabelSprite('🌍 EARTH', '#38bdf8', 'rgba(6, 10, 24, 0.92)', 0.036);
      earthLabel.position.set(0, 1.8, 0);
      earthGroup.add(earthSphere, earthGlow, earthLabel);
      scene.add(earthGroup);
      refs.earthGroup = earthGroup;

      // Feixe de Comunicação DTE (Lander <-> Terra ou até o ponto real de colisão no relevo)
      const commBeamGroup = new THREE.Group();
      const commLineMat = new THREE.LineDashedMaterial({
        color: 0x3ddc97,
        dashSize: 0.55,
        gapSize: 0.3,
        transparent: true,
        opacity: 0.85,
      });
      const commLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([refs.landerTopPos, earthInitVisual]),
        commLineMat
      );
      commLine.computeLineDistances();
      commBeamGroup.add(commLine);

      const pulseGeo = new THREE.SphereGeometry(0.1, 10, 10);
      const commPulses = [];
      for (let i = 0; i < 12; i++) {
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

      // Marcador 3D Compacto no Ponto Exato onde a Montanha intercepta o Feixe Terra-Sonda
      const commBlockGroup = new THREE.Group();
      commBlockGroup.visible = false;

      const hitSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xff5c7a })
      );
      const hitGlow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: createGlowTexture('rgba(255, 92, 122, 0.95)', 'rgba(239, 68, 68, 0.45)'),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      hitGlow.scale.set(1.8, 1.8, 1);

      const blockBadge = createLabelSprite(
        '⛰️ Terrain blocking communication',
        '#ff5c7a',
        'rgba(28, 8, 18, 0.92)',
        0.034
      );
      blockBadge.position.set(0, 0.95, 0);

      commBlockGroup.add(hitSphere, hitGlow, blockBadge);
      scene.add(commBlockGroup);
      refs.commBlockGroup = commBlockGroup;
    }

    sceneObjectsRef.current = refs;

    let animId;
    const clock = new THREE.Clock();
    const renderLoop = () => {
      animId = requestAnimationFrame(renderLoop);
      const elapsed = clock.getElapsedTime();
      const r = sceneObjectsRef.current;

      if (r.sunLight) {
        r.sunLight.intensity += (r.targetSunIntensity - r.sunLight.intensity) * 0.08;
        r.sunLight.position.lerp(r.sunLightTargetPos, 0.12);
      }
      if (r.hemiLight) {
        r.hemiLight.intensity += (r.targetHemiIntensity - r.hemiLight.intensity) * 0.08;
      }
      if (r.landerLight) {
        r.landerLight.intensity += (r.targetLanderLightIntensity - r.landerLight.intensity) * 0.08;
      }

      if (r.sunMesh) {
        r.sunMesh.position.lerp(r.sunVisualTargetPos, 0.14);
      }
      if (r.sunRayLine) {
        const originPt = r.viewMode === 'globo' ? r.globePinPos : r.landerTopPos;
        r.sunRayLine.geometry.setFromPoints([originPt, r.sunRayEndTargetPos]);
        r.sunRayLine.computeLineDistances();
      }

      if (r.earthGroup) {
        r.earthCurrentPos.lerp(r.earthTargetPos, 0.14);
        r.earthGroup.position.copy(r.earthCurrentPos);

        const originPt = r.viewMode === 'globo' ? r.globePinPos : r.landerTopPos;

        // No Modo 3, lança o raio EXATAMENTE na linha reta Sonda -> Terra contra a malha local e o anel de horizonte
        if (r.viewMode === 'superficie' && !r.earthVisibleNow && r.terrainMesh) {
          r.terrainMesh.updateMatrixWorld();
          if (r.horizonWallMesh) r.horizonWallMesh.updateMatrixWorld();

          const vecToEarth = r.earthCurrentPos.clone().sub(originPt);
          const distToEarth = vecToEarth.length();
          const dirToEarth = vecToEarth.clone().normalize();

          const raycaster = raycasterRef.current;
          raycaster.set(originPt, dirToEarth);

          const obstacles = [r.terrainMesh];
          if (r.horizonWallMesh) obstacles.push(r.horizonWallMesh);

          const hits = raycaster.intersectObjects(obstacles, false);
          const validHit = hits.find((h) => h.distance > 0.45 && h.distance < distToEarth - 0.5);

          if (validHit) {
            r.commBeamEndPos.copy(validHit.point);
          } else {
            // Se a Terra está abaixo de 0° (atrás da curvatura lunar / horizonte distante), crava na crista do horizonte
            const hitDist = Math.min(23.5, distToEarth * 0.78);
            r.commBeamEndPos.copy(originPt).addScaledVector(dirToEarth, hitDist);
          }

          if (r.commBlockGroup) {
            r.commBlockGroup.position.copy(r.commBeamEndPos);
            r.commBlockGroup.visible = true;
          }
        } else {
          r.commBeamEndPos.copy(r.earthCurrentPos);
          if (r.commBlockGroup) {
            r.commBlockGroup.visible = false;
          }
        }

        if (r.commLine) {
          r.commLine.geometry.setFromPoints([originPt, r.commBeamEndPos]);
          r.commLine.computeLineDistances();
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
          pMesh.position.lerpVectors(originPt, r.commBeamEndPos, t);
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
    const earthMaskElev = Math.max(0, getHorizonMaskAtAzimuth(simData?.horizon_profile, earthAz));
    const earthVisible = activeFrame.earth_visible !== undefined
      ? Boolean(activeFrame.earth_visible)
      : earthElev > earthMaskElev;
    refs.earthVisibleNow = earthVisible;

    if (viewMode === 'viagem') {
      const spaceSunPos = azElToVector3(sunAz, Math.max(8, sunElev), 38);
      refs.sunLightTargetPos.copy(spaceSunPos);
      refs.targetSunIntensity = 3.4;
      refs.targetHemiIntensity = 0.22;
    } else if (viewMode === 'globo') {
      const siteLat = simData?.lat ?? -89.9;
      const siteLon = simData?.lon ?? 0.0;

      const sunGlobePos = localAzElToGlobeVector3(siteLat, siteLon, sunAz, sunElev, 8.2);
      refs.sunVisualTargetPos.copy(sunGlobePos);
      refs.sunRayEndTargetPos.copy(sunGlobePos);
      refs.sunLightTargetPos.copy(sunGlobePos.clone().multiplyScalar(4.0));

      refs.targetSunIntensity = 3.8;
      refs.targetHemiIntensity = 0.14;

      if (refs.sunRayMat) {
        refs.sunRayMat.color.setHex(sunVisible ? 0xfbbf24 : 0xff5c7a);
        refs.sunRayMat.opacity = sunVisible ? 0.75 : 0.35;
      }

      const earthGlobePos = localAzElToGlobeVector3(siteLat, siteLon, earthAz, earthElev, 6.8);
      refs.earthTargetPos.copy(earthGlobePos);

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
      // MODO 3 (LOCAL SURFACE): Elevação escalada com vertExag e ancorada em landerTopPos para geometria visual 100% coerente!
      const discFrac = solarDiscIlluminatedFraction(sunElev, maskElev);
      const lightEl = Math.max(2.2, sunElev * vertExag + 2.0);
      const sunLightPos = refs.landerTopPos.clone().add(azElToVector3(sunAz, lightEl, 42));

      refs.sunLightTargetPos.copy(sunLightPos);
      refs.targetSunIntensity = 0.18 + 3.8 * discFrac;
      refs.targetHemiIntensity = 0.12 + 0.18 * discFrac;
      refs.targetLanderLightIntensity = 1.8 * (1 - discFrac) + 0.25;

      const sunVisualPos = refs.landerTopPos.clone().add(azElToVector3(sunAz, sunElev * vertExag, 34));
      refs.sunVisualTargetPos.copy(sunVisualPos);

      // Quando bloqueada pela montanha, garante que a Terra fique visualmente na elevação real atrás da crista
      const visualEarthEl = !earthVisible
        ? Math.min(earthElev, earthMaskElev - 0.6) * vertExag
        : earthElev * vertExag;
      const earthPos = refs.landerTopPos.clone().add(azElToVector3(earthAz, visualEarthEl, 30));
      refs.earthTargetPos.copy(earthPos);

      if (refs.commLineMat) {
        const beamColor = earthVisible ? 0x3ddc97 : 0xff5c7a;
        refs.commLineMat.color.setHex(beamColor);
        refs.commLineMat.opacity = earthVisible ? 0.85 : 0.75;
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
  }, [stepIdx, activeFrame, viewMode, timeline.length, simData, vertExag]);

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
  const slopeNow = typeof simData?.slope_deg === 'number' ? `${simData.slope_deg.toFixed(1)}°` : 'N/A';

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
          ${simData?.modo_terreno || 'NASA LOLA LDEM (Real Data, 240 m/px)'} · ${translatePhaseName(fasesData?.fase_nome)}
        </span>
      </div>

      ${viewMode === 'superficie' &&
      html`
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300 py-1">
          <div className="flex items-center gap-1.5">
            <span>Color:</span>
            <button
              type="button"
              className=${`btn small ${colorMode === 'natural' ? 'primary' : ''}`}
              onClick=${() => setColorMode('natural')}
            >
              Natural
            </button>
            <button
              type="button"
              className=${`btn small ${colorMode === 'elevation' ? 'primary' : ''}`}
              onClick=${() => setColorMode('elevation')}
            >
              Elevation
            </button>
            <button
              type="button"
              className=${`btn small ${colorMode === 'slope' ? 'primary' : ''}`}
              onClick=${() => setColorMode('slope')}
            >
              Slope
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="vert-exag-slider" className="whitespace-nowrap">
              Vertical Exaggeration <strong>${vertExag.toFixed(1)}x</strong>
            </label>
            <input
              id="vert-exag-slider"
              type="range"
              min="1"
              max="4"
              step="0.25"
              value=${vertExag}
              onChange=${(e) => setVertExag(Number(e.target.value))}
              style=${{ width: '110px' }}
            />
          </div>
        </div>
      `}

      <div className="relative w-full h-[430px] rounded-lg overflow-hidden border border-slate-800">
        <div ref=${canvasWrapRef} className="w-full h-full"></div>

        <div className="hud-3d">
          <div>
            <span>SUN</span>
            <strong>${sunElevNow.toFixed(2)}°</strong>
            <em className=${sunVis ? 'ok' : 'bad'}>
              ${sunVis ? 'GENERATING' : 'SHADOW'}
            </em>
          </div>
          <div>
            <span>EARTH</span>
            <strong>${earthElevNow.toFixed(2)}°</strong>
            <em className=${earthVis ? 'ok' : 'bad'}>${earthVis ? 'ACTIVE LINK' : 'OCCULTED'}</em>
          </div>
          ${simData?.terrain_grid &&
          html`
            <div>
              <span>LOLA ELEV</span>
              <strong>${simData.terrain_grid.min_elevation_m}m to ${simData.terrain_grid.max_elevation_m}m</strong>
            </div>
          `}
          <div>
            <span>SLOPE</span>
            <strong>${slopeNow}</strong>
          </div>
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