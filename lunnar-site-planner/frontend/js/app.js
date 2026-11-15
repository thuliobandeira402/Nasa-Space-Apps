import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const html = htm.bind(React.createElement);
let reactRoot = null;

const VIEW_H = 480;
const NEAR_UNITS = 14;
const SKY_SUN_R = 150;
const SKY_EARTH_R = 140;
const SHADOW_LIGHT_R = 40;
const HORIZON_R = 70;
const BEAM_LEN = 16;
const SUN_RADIUS_UNITS = SKY_SUN_R * Math.tan(THREE.MathUtils.degToRad(0.265));
const EARTH_RADIUS_UNITS = SKY_EARTH_R * Math.tan(THREE.MathUtils.degToRad(0.95));
const EARTH_TEXTURE_URL =
  'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r169/examples/textures/planets/earth_atmos_2048.jpg';

function azElToVector3(azDeg, elDeg, radius) {
  const az = THREE.MathUtils.degToRad(azDeg || 0);
  const el = THREE.MathUtils.degToRad(elDeg || 0);
  return new THREE.Vector3(
    radius * Math.cos(el) * Math.sin(az),
    radius * Math.sin(el),
    -radius * Math.cos(el) * Math.cos(az)
  );
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createRegolithTexture(size = 256) {
  const rand = mulberry32(1969);
  const field = new Float32Array(size * size);
  const octaves = [
    [8, 0.5],
    [16, 0.25],
    [32, 0.15],
    [64, 0.1],
  ];
  for (const [cells, amp] of octaves) {
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells;
      const y0 = Math.floor(fy);
      const y1 = (y0 + 1) % cells;
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const x0 = Math.floor(fx);
        const x1 = (x0 + 1) % cells;
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const a = lattice[y0 * cells + x0] * (1 - sx) + lattice[y0 * cells + x1] * sx;
        const b = lattice[y1 * cells + x0] * (1 - sx) + lattice[y1 * cells + x1] * sx;
        field[y * size + x] += (a * (1 - sy) + b * sy) * amp;
      }
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(185 + Math.min(1, Math.max(0, field[i])) * 70);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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

function createStarfield(count = 2500, radius = 400) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = 2 * Math.PI * Math.random();
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = radius * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xe2e8f0,
    size: 1.6,
    sizeAttenuation: false,
    depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}

function createEarthMaterial() {
  const uniforms = {
    uMap: { value: null },
    uHasMap: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uBase: { value: new THREE.Color(0x2563eb) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vN;
      void main() {
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform float uHasMap;
      uniform vec3 uSunDir;
      uniform vec3 uBase;
      varying vec2 vUv;
      varying vec3 vN;
      void main() {
        vec3 albedo = mix(uBase, texture2D(uMap, vUv).rgb, uHasMap);
        float d = dot(normalize(vN), normalize(uSunDir));
        float lit = smoothstep(-0.05, 0.25, d);
        gl_FragColor = vec4(albedo * (0.04 + 0.96 * lit), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  new THREE.TextureLoader().load(
    EARTH_TEXTURE_URL,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      uniforms.uMap.value = tex;
      uniforms.uHasMap.value = 1;
    },
    undefined,
    () => {}
  );
  return material;
}

function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    mats.forEach((m) => {
      if (m.map) m.map.dispose();
      if (m.bumpMap) m.bumpMap.dispose();
      if (m.uniforms?.uMap?.value) m.uniforms.uMap.value.dispose();
      m.dispose();
    });
  });
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children[0];
    group.remove(child);
    disposeObject(child);
  }
}

function centerHeight(hm, size) {
  const c = Math.floor(size / 2);
  if (size % 2 === 1) return hm[c * size + c];
  return (hm[(c - 1) * size + c - 1] + hm[(c - 1) * size + c] + hm[c * size + c - 1] + hm[c * size + c]) / 4;
}

function prepareGrid(grid) {
  if (!grid?.size) return null;
  const size = grid.size;
  const n = size * size;
  let hm;
  if (Array.isArray(grid.heights_m) && grid.heights_m.length === n) {
    hm = Float32Array.from(grid.heights_m);
  } else if (Array.isArray(grid.heights) && grid.heights.length === n) {
    const span = Math.max(1, (grid.max_elevation_m ?? 0) - (grid.min_elevation_m ?? 0));
    hm = Float32Array.from(grid.heights, (h) => h * span);
  } else {
    return null;
  }
  const extentM = grid.extent_m ?? (size - 1) * (grid.pixel_m ?? 40);
  return { size, hm, extentM };
}

function computeSlopeDeg(hm, size, cellM) {
  const out = new Float32Array(size * size);
  for (let r = 0; r < size; r++) {
    const r0 = Math.max(0, r - 1);
    const r1 = Math.min(size - 1, r + 1);
    for (let c = 0; c < size; c++) {
      const c0 = Math.max(0, c - 1);
      const c1 = Math.min(size - 1, c + 1);
      const dzdx = (hm[r * size + c1] - hm[r * size + c0]) / ((c1 - c0) * cellM);
      const dzdy = (hm[r1 * size + c] - hm[r0 * size + c]) / ((r1 - r0) * cellM);
      out[r * size + c] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
    }
  }
  return out;
}

function carveHole(geo, halfUnits) {
  const idx = geo.index.array;
  const pos = geo.attributes.position;
  const out = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i];
    const b = idx[i + 1];
    const c = idx[i + 2];
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    if (Math.abs(cx) < halfUnits && Math.abs(cy) < halfUnits) continue;
    out.push(a, b, c);
  }
  geo.setIndex(out);
}

function buildTerrain(G, u, { holeHalfUnits = 0, near = true, texture = null } = {}) {
  const widthUnits = G.extentM * u;
  const geo = new THREE.PlaneGeometry(widthUnits, widthUnits, G.size - 1, G.size - 1);
  if (holeHalfUnits > 0) carveHole(geo, holeHalfUnits);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(G.size * G.size * 3), 3));

  let minH = Infinity;
  let maxH = -Infinity;
  for (let i = 0; i < G.hm.length; i++) {
    if (G.hm[i] < minH) minH = G.hm[i];
    if (G.hm[i] > maxH) maxH = G.hm[i];
  }

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.97,
    metalness: 0.0,
    map: texture,
    bumpMap: texture,
    bumpScale: texture ? 0.6 : 0,
    polygonOffset: !near,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = near;

  return {
    mesh,
    hm: G.hm,
    size: G.size,
    u,
    minH,
    maxH,
    slope: computeSlopeDeg(G.hm, G.size, G.extentM / (G.size - 1)),
  };
}

const SLOPE_STOPS = [
  [0, new THREE.Color(0x3ddc97)],
  [5, new THREE.Color(0xc6e24a)],
  [10, new THREE.Color(0xffb547)],
  [15, new THREE.Color(0xff5c7a)],
];
const ALT_LOW = new THREE.Color(0x2b3a5c);
const ALT_HIGH = new THREE.Color(0xe8edf7);
const _base = new THREE.Color();
const _tmp = new THREE.Color();

function slopeColor(deg, out) {
  if (deg >= 15) return out.copy(SLOPE_STOPS[3][1]);
  for (let i = 0; i < 3; i++) {
    const [a, ca] = SLOPE_STOPS[i];
    const [b, cb] = SLOPE_STOPS[i + 1];
    if (deg <= b) return out.copy(ca).lerp(cb, (deg - a) / (b - a));
  }
  return out.copy(SLOPE_STOPS[3][1]);
}

function paintTerrain(T, exag, colorMode) {
  const geo = T.mesh.geometry;
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  const k = T.u * exag;
  const range = T.maxH - T.minH || 1;

  for (let i = 0; i < T.hm.length; i++) {
    pos.setZ(i, T.hm[i] * k);
    const hn = (T.hm[i] - T.minH) / range;
    const v = 0.36 + 0.22 * hn;
    _base.setRGB(v, v * 1.01, v * 1.05);
    if (colorMode === 'altitude') {
      _tmp.copy(ALT_LOW).lerp(ALT_HIGH, hn);
      _base.lerp(_tmp, 0.85);
    } else if (colorMode === 'slope') {
      slopeColor(T.slope[i], _tmp);
      _base.lerp(_tmp, 0.65);
    }
    col.setXYZ(i, _base.r, _base.g, _base.b);
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
}

function LunarScene3D({ simData, viagemData, fasesData, onStepChange }) {
  const [viewMode, setViewMode] = useState('superficie');
  const [stepIdx, setStepIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [colorMode, setColorMode] = useState('natural'); // inicia em modo natural
  const [exag, setExag] = useState(2); // exagero mais suave

  const canvasWrapRef = useRef(null);
  const coreRef = useRef({});
  const sceneObjectsRef = useRef({});
  const stepRef = useRef(0);
  stepRef.current = stepIdx;

  const timeline = simData?.timeline || [];
  const activeFrame = timeline[stepIdx] || {
    sun_elevation_deg: 0,
    sun_azimuth_deg: 0,
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
      const next = stepRef.current + 1 >= timeline.length ? 0 : stepRef.current + 1;
      stepRef.current = next;
      setStepIdx(next);
      if (onStepChange) onStepChange(next);
    }, 120);
    return () => clearInterval(timer);
  }, [isPlaying, timeline.length, onStepChange]);

  useEffect(() => {
    const container = canvasWrapRef.current;
    if (!container) return;
    const core = coreRef.current;

    const width = container.clientWidth || 720;
    const height = container.clientHeight || VIEW_H;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#040711');
    const stars = createStarfield(2800, 400);
    scene.add(stars);

    const camera = new THREE.PerspectiveCamera(46, width / height, 0.05, 1500);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;

    scene.add(new THREE.AmbientLight(0x2a3550, 0.6));
    const sunLight = new THREE.DirectionalLight(0xfffbeb, 6);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 5;
    sunLight.shadow.camera.far = 95;
    const d = 10;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.03;
    scene.add(sunLight);

    const content = new THREE.Group();
    scene.add(content);

    Object.assign(core, { scene, camera, renderer, controls, sunLight, content });

    let animId;
    const renderLoop = () => {
      animId = requestAnimationFrame(renderLoop);
      controls.update();
      renderer.render(scene, camera);
    };
    renderLoop();

    const resize = () => {
      const w = container.clientWidth || 720;
      const h = container.clientHeight || VIEW_H;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(container);
    else window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(animId);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', resize);
      clearGroup(content);
      disposeObject(stars);
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      coreRef.current = {};
      sceneObjectsRef.current = {};
    };
  }, []);

  useEffect(() => {
    const core = coreRef.current;
    if (!core.scene) return;
    const { content, camera, controls } = core;
    clearGroup(content);

    const refs = {
      sunMesh: null,
      earthGroup: null,
      earthMat: null,
      commLine: null,
      landerMesh: null,
      landerLight: null,
      probeMesh: null,
      tliPoints: [],
      landerTopPos: new THREE.Vector3(0, 0.48, 0),
      nearT: null,
      farT: null,
    };

    if (viewMode === 'viagem') {
      camera.position.set(0, 6.5, 11.2);
      controls.target.set(0, 0, 1);
      controls.minDistance = 3;
      controls.maxDistance = 40;
      controls.maxPolarAngle = Math.PI;

      const ep = viagemData?.earth_pos ?? { x: -3.2, y: 0, z: 0 };
      const mp = viagemData?.moon_pos ?? { x: 2.6, y: 0, z: 2.3 };

      const earthGroup = new THREE.Group();
      earthGroup.position.set(ep.x, ep.y, ep.z);
      earthGroup.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(1.1, 48, 48),
          new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.4, metalness: 0.1 })
        ),
        new THREE.Mesh(
          new THREE.SphereGeometry(1.18, 48, 48),
          new THREE.MeshBasicMaterial({
            color: 0x60a5fa,
            transparent: true,
            opacity: 0.25,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
          })
        )
      );
      const moon = new THREE.Mesh(
        new THREE.SphereGeometry(0.46, 32, 32),
        new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.92 })
      );
      moon.position.set(mp.x, mp.y, mp.z);
      content.add(earthGroup, moon);

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
        content.add(line, probe);
        refs.probeMesh = probe;
      }
    } else if (viewMode === 'globo') {
      camera.position.set(0, -3.6, 5.2);
      controls.target.set(0, 0, 0);
      controls.minDistance = 3.2;
      controls.maxDistance = 14;
      controls.maxPolarAngle = Math.PI;

      const globe = new THREE.Mesh(
        new THREE.SphereGeometry(2.2, 96, 96),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.95 })
      );
      globe.receiveShadow = true;
      content.add(globe);

      const gridHelper = new THREE.PolarGridHelper(2.25, 12, 4, 64, 0x334155, 0x1e293b);
      gridHelper.rotation.x = Math.PI / 2;
      globe.add(gridHelper);

      const latRad = THREE.MathUtils.degToRad(simData?.lat ?? -89.9);
      const lonRad = THREE.MathUtils.degToRad(simData?.lon ?? 0);
      const r = 2.24;
      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 16, 16),
        new THREE.MeshBasicMaterial({ color: simData?.go_nogo === 'GO' ? 0x3ddc97 : 0xff5c7a })
      );
      pin.position.set(
        r * Math.cos(latRad) * Math.cos(lonRad),
        r * Math.sin(latRad),
        r * Math.cos(latRad) * Math.sin(lonRad)
      );
      globe.add(pin);
    } else {
      camera.position.set(0, 2.3, 7.2);
      controls.target.set(0, 0.4, 0);
      controls.minDistance = 1.5;
      controls.maxDistance = 60;
      controls.maxPolarAngle = Math.PI * 0.49;

      const grid = simData?.terrain_grid;
      const near = prepareGrid(grid) || { size: 2, hm: new Float32Array(4), extentM: 15360 };
      const u = NEAR_UNITS / near.extentM;

      const off = centerHeight(near.hm, near.size);
      for (let i = 0; i < near.hm.length; i++) near.hm[i] -= off;

      const far = prepareGrid(grid?.far_grid);
      if (far) for (let i = 0; i < far.hm.length; i++) far.hm[i] -= off;

      refs.nearT = buildTerrain(near, u, { near: true, texture: createRegolithTexture(256) });
      content.add(refs.nearT.mesh);

      if (far) {
        refs.farT = buildTerrain(far, u, { near: false, holeHalfUnits: NEAR_UNITS / 2 });
        content.add(refs.farT.mesh);
      } else {
        const ground = new THREE.Mesh(
          new THREE.CircleGeometry(HORIZON_R, 64),
          new THREE.MeshStandardMaterial({ color: 0x3b4658, roughness: 1 })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.06;
        ground.receiveShadow = true;
        content.add(ground);
      }

      const lander = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.24, 0.42, 16),
        new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.45, roughness: 0.3 })
      );
      lander.position.set(0, 0.21, 0);
      lander.castShadow = true;
      lander.receiveShadow = true;
      content.add(lander);
      refs.landerMesh = lander;
      refs.landerTopPos = new THREE.Vector3(0, 0.42, 0);

      const landerLight = new THREE.PointLight(0x38bdf8, 0, 3.5);
      landerLight.position.set(0, 0.6, 0);
      content.add(landerLight);
      refs.landerLight = landerLight;

      const sunGroup = new THREE.Group();
      sunGroup.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(SUN_RADIUS_UNITS, 24, 24),
          new THREE.MeshBasicMaterial({ color: 0xfffbeb })
        ),
        (() => {
          const s = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: createGlowTexture(),
              color: 0xffd166,
              transparent: true,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            })
          );
          s.scale.set(18, 18, 1);
          return s;
        })()
      );
      content.add(sunGroup);
      refs.sunMesh = sunGroup;

      const earthMat = createEarthMaterial();
      const earthGroup = new THREE.Group();
      earthGroup.add(
        new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS_UNITS, 48, 48), earthMat),
        new THREE.Mesh(
          new THREE.SphereGeometry(EARTH_RADIUS_UNITS * 1.06, 48, 48),
          new THREE.MeshBasicMaterial({
            color: 0x7dd3fc,
            transparent: true,
            opacity: 0.22,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
            depthWrite: false,
          })
        )
      );
      content.add(earthGroup);
      refs.earthGroup = earthGroup;
      refs.earthMat = earthMat;

      const commLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([refs.landerTopPos, new THREE.Vector3(0, 5, -BEAM_LEN)]),
        new THREE.LineDashedMaterial({ color: 0x3ddc97, dashSize: 0.6, gapSize: 0.35 })
      );
      commLine.computeLineDistances();
      commLine.frustumCulled = false;
      content.add(commLine);
      refs.commLine = commLine;
    }

    controls.update();
    sceneObjectsRef.current = refs;
  }, [viewMode, simData, viagemData]);

  useEffect(() => {
    const refs = sceneObjectsRef.current;
    if (viewMode !== 'superficie' || !refs.nearT) return;
    paintTerrain(refs.nearT, exag, colorMode);
    if (refs.farT) paintTerrain(refs.farT, exag, colorMode);
  }, [exag, colorMode, viewMode, simData, viagemData]);

  useEffect(() => {
    const core = coreRef.current;
    const refs = sceneObjectsRef.current;
    if (!core.sunLight) return;

    if (viewMode !== 'superficie') {
      core.sunLight.position.set(8, 5, 6);
      core.sunLight.intensity = 2.6;
      if (refs.probeMesh && refs.tliPoints?.length > 1) {
        const maxT = Math.max(1, timeline.length - 1);
        const probeIdx = Math.min(refs.tliPoints.length - 1, Math.floor((stepIdx / maxT) * refs.tliPoints.length));
        refs.probeMesh.position.copy(refs.tliPoints[probeIdx]);
      }
      return;
    }

    const sunVisible = Boolean(activeFrame.sun_visible);
    const earthVisible = activeFrame.earth_visible ?? activeFrame.earth_elevation_deg > 0;
    const sunEl = activeFrame.sun_elevation_deg ?? 0;

    core.sunLight.position.copy(azElToVector3(activeFrame.sun_azimuth_deg, sunEl, SHADOW_LIGHT_R));
    const k = THREE.MathUtils.clamp((sunEl - 3) / 30, 0, 1);
    core.sunLight.intensity = sunVisible ? THREE.MathUtils.lerp(7, 2.4, k) : 0.12;

    if (refs.sunMesh) {
      refs.sunMesh.position.copy(azElToVector3(activeFrame.sun_azimuth_deg, sunEl, SKY_SUN_R));
      refs.sunMesh.visible = sunEl > -2;
    }

    if (refs.earthGroup) {
      const eEl = activeFrame.earth_elevation_deg ?? 2;
      const dirE = azElToVector3(activeFrame.earth_azimuth_deg ?? 0, eEl, 1);
      refs.earthGroup.position.copy(dirE.clone().multiplyScalar(SKY_EARTH_R));
      refs.earthGroup.visible = eEl > -3;
      if (refs.earthMat) {
        refs.earthMat.uniforms.uSunDir.value.copy(azElToVector3(activeFrame.sun_azimuth_deg, sunEl, 1));
      }
      if (refs.commLine) {
        refs.commLine.geometry.setFromPoints([refs.landerTopPos, dirE.clone().multiplyScalar(BEAM_LEN)]);
        refs.commLine.computeLineDistances();
        refs.commLine.material.color.setHex(earthVisible ? 0x3ddc97 : 0xff5c7a);
      }
    }

    if (refs.landerMesh && refs.landerLight) {
      refs.landerMesh.material.color.setHex(sunVisible ? 0xfbbf24 : 0x38bdf8);
      refs.landerLight.intensity = sunVisible ? 0 : 1.6;
    }
  }, [stepIdx, activeFrame, viewMode, simData, viagemData, timeline.length]);

  function handleSliderChange(e) {
    setIsPlaying(false);
    const nextIdx = Number(e.target.value);
    setStepIdx(nextIdx);
    if (onStepChange) onStepChange(nextIdx);
  }

  const sunVis = Boolean(activeFrame.sun_visible);
  const earthVis = activeFrame.earth_visible ?? activeFrame.earth_elevation_deg > 0;
  const grid = simData?.terrain_grid;
  const isSurface = viewMode === 'superficie';

  const legendBox = {
    position: 'absolute',
    bottom: '10px',
    left: '10px',
    padding: '0.4rem 0.6rem',
    borderRadius: '10px',
    background: 'rgba(6, 10, 24, 0.78)',
    border: '1px solid rgba(140, 170, 255, .18)',
    fontSize: '0.7rem',
    color: '#98a3c7',
    pointerEvents: 'none',
    minWidth: '150px',
  };

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

      ${isSurface &&
      html`
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-slate-400">Cor:</span>
          ${[
            ['natural', 'Natural'],
            ['altitude', 'Altitude'],
            ['slope', 'Declividade'],
          ].map(
            ([id, label]) => html`
              <button
                key=${id}
                type="button"
                className=${`btn small ${colorMode === id ? 'primary' : ''}`}
                onClick=${() => setColorMode(id)}
              >
                ${label}
              </button>
            `
          )}
          <label htmlFor="exag-slider" className="font-mono text-slate-300 whitespace-nowrap">
            Exagero vertical <strong>${exag}×</strong>
          </label>
          <input
            id="exag-slider"
            type="range"
            min="1"
            max="10"
            step="0.5"
            value=${exag}
            onChange=${(e) => setExag(Number(e.target.value))}
            style=${{ width: '140px' }}
          />
        </div>
      `}

      <div className="relative w-full h-[480px] rounded-lg overflow-hidden border border-slate-800">
        <div ref=${canvasWrapRef} className="w-full h-full"></div>

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
          ${grid &&
          html`
            <div>
              <span>COTA LOLA</span>
              <strong>${grid.min_elevation_m}m a ${grid.max_elevation_m}m</strong>
            </div>
          `}
          ${isSurface &&
          typeof simData?.slope_deg === 'number' &&
          html`
            <div>
              <span>SLOPE</span>
              <strong>${simData.slope_deg}°</strong>
            </div>
          `}
        </div>

        ${isSurface &&
        colorMode === 'slope' &&
        html`
          <div style=${legendBox}>
            <div style=${{ marginBottom: '4px' }}>Declividade local</div>
            <div
              style=${{
                height: '8px',
                borderRadius: '4px',
                background: 'linear-gradient(90deg, #3ddc97, #c6e24a, #ffb547, #ff5c7a)',
              }}
            ></div>
            <div style=${{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
              <span>0°</span><span>5°</span><span>10°</span><span>≥15° (limite)</span>
            </div>
          </div>
        `}
        ${isSurface &&
        colorMode === 'altitude' &&
        grid &&
        html`
          <div style=${legendBox}>
            <div style=${{ marginBottom: '4px' }}>Altitude relativa</div>
            <div
              style=${{
                height: '8px',
                borderRadius: '4px',
                background: 'linear-gradient(90deg, #2b3a5c, #e8edf7)',
              }}
            ></div>
            <div style=${{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
              <span>${grid.min_elevation_m} m</span><span>${grid.max_elevation_m} m</span>
            </div>
          </div>
        `}
      </div>

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