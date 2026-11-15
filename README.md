# ☾ Lunar Site Planner

### Lunar South Pole Lighting, Terrain & Direct-to-Earth (DTE) Communication Decision Tool

[![NASA Space Apps Challenge 2026](https://img.shields.io/badge/NASA%20Space%20Apps-2026%20Global%20Submission-0B3D91?style=for-the-badge&logo=nasa)](https://www.spaceappschallenge.org/)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Backend-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Three.js](https://img.shields.io/badge/Three.js-3D%20Simulation-000000?style=for-the-badge&logo=threedotjs&logoColor=white)](https://threejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**Lunar Site Planner** is a scientific mission-planning and public outreach web application built for the **NASA Space Apps Challenge** (*Lunar South Pole Lighting & Communication Tool*). It evaluates candidate landing sites and mission windows at the lunar south pole by combining real **NASA/JPL SPICE ephemerides** with **LRO/LOLA Digital Elevation Models (DEM)** to determine solar illumination, topographic shadowing, terrain slope, and Direct-to-Earth (DTE) line-of-sight communication.

---

## 🚀 Key Features

* **High-Precision Ephemeris Engine (`de421.bsp`):** Computes topocentric Sun and Earth elevation and azimuth angles in the `MOON_ME_DE421` reference frame, accounting for the apparent solar disc semidiameter ($0.265^\circ$) and zero atmospheric refraction.

* **3-Tier Topographic Horizon & Slope Engine (LRO/LOLA):**
  * **Tier 1 (Real DEM):** Extracts $360^\circ$ horizon obstruction profiles ($40\text{ km}$ radius), $64 \times 64$ 3D elevation meshes, and local terrain slope (`slope_deg`) from NASA LRO/LOLA South Polar Stereographic GeoTIFF data ($40\text{ m/px}$).
  * **Tier 2 (Cataloged Profiles):** Curated geological and horizon profiles for key lunar sites.
  * **Tier 3 (Deterministic Synthetic Model):** Seamless fallback for latitudes outside the polar DEM coverage ($> -80^\circ$).

* **Dual User Modes:**
  * 🛠️ **Engineer Mode:** Exposes custom coordinates, integration step controls, real-time `GO / NO-GO` telemetry checks, vertical vs. horizontal solar array efficiency, DTE round-trip signal latency, and multi-scenario trade-off comparison.
  * 🚀 **Explorer Mode:** Translates complex orbital mechanics into intuitive visual explanations and guided takeaways for students and the general public.

* **Interactive 3D Orbital & Surface Simulation (React + Three.js):**
  1. *Trans-Lunar Injection (TLI) Trajectory View* (Earth–Moon–Sun geometry)
  2. *3D Lunar Globe View* (selenographic site inspection)
  3. *Surface Terrain & Sky View* (real-time shadow casting synced with a mission timeline scrubber)

* **Scientific Data Visualizations (Plotly.js):**
  * Dynamic Sun & Earth elevation timeline with highlighted **Simultaneous Operational Windows** (Sun above terrain + active Earth DTE link).
  * $360^\circ$ Polar Skyplot overlaying the local horizon terrain mask against solar and terrestrial paths.

---

## 📍 Curated Lunar Landing Sites Catalog

The platform includes 7 pre-configured scientific and mission-relevant sites:

1. **Shackleton Crater Rim** — Artemis candidate region / Peaks of Eternal Light
2. **Connecting Ridge** — High-illumination ridge between Shackleton and de Gerlache
3. **Malapert Massif** — Elevated south polar massif with continuous Earth visibility
4. **Cabeus Crater** — LCROSS impact site / Permanently Shadowed Region volatile target
5. **IM-1 Nova-C (Malapert A)** — Intuitive Machines Odysseus landing region
6. **Nobile Rim** — VIPER mission target region
7. **Apollo 11 (Tranquility Base)** — Equatorial reference baseline

---

## 🏗️ System Architecture

```text
lunar-site-planner/
├── backend/
│   ├── main.py               # FastAPI server, async lifespan, REST endpoints & static delivery
│   ├── ephemeris_engine.py   # Skyfield + NASA de421.bsp & MOON_ME_DE421 calculations
│   ├── lola_horizon.py       # Rasterio 360° horizon raycasting, 64x64 mesh & slope gradient
│   ├── terrain_engine.py     # 3-tier topographic hierarchy & angular obstruction logic
│   ├── metrics_analyzer.py   # GO/NO-GO synthesis, Sunset/Earthset countdowns, solar power & latency
│   ├── sites_catalog.py      # Curated selenographic coordinates & geological metadata
│   └── data_loader.py        # Resilient SPICE kernel & background LOLA GeoTIFF downloader
├── frontend/
│   ├── index.html            # Semantic HTML5 layout (Engineer / Explorer modes)
│   ├── css/style.css         # Responsive dark-space UI theme
│   └── js/
│       ├── main.js           # Form orchestration, timeline sync & state management
│       ├── api.js            # Async FastAPI client with offline contingency fallback
│       ├── app.js            # React 18 + Three.js 3D orbital, globe & surface engine
│       ├── charts.js         # Plotly.js Elevation Timeline, 360° Polar Skyplot & Comparator
│       └── ui_cards.js       # Real-time KPI cards, 1s live countdowns & scenario table
├── data/                     # Local cache for NASA SPICE kernels (.bsp) and LOLA DEM (.tif)
└── requirements.txt          # Python dependencies
```

---

## 🛠️ Installation & Local Setup

### Prerequisites

* Python **3.10+**
* Internet connection on first run (to automatically fetch NASA `de421.bsp` and LRO/LOLA DEM files into `/data`)

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/lunar-site-planner.git
cd lunar-site-planner
```

### 2. Create a virtual environment & install dependencies

```bash
python -m venv venv

# Windows (PowerShell)
.\venv\Scripts\Activate.ps1

# Linux / macOS
source venv/bin/activate

pip install -r requirements.txt
```

### 3. Run the FastAPI server

```bash
uvicorn backend.main:app --reload --port 8000
```

### 4. Open the application

Navigate to **`http://127.0.0.1:8000`** in your browser.

---

## 📡 API Endpoints Overview

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/sites` | Returns the curated catalog of 7 lunar sites with coordinates and metadata. |
| `POST` | `/simular-pouso` | Runs full simulation: $360^\circ$ horizon, slope, solar/Earth timeline, GO/NO-GO, and KPIs. |
| `GET` | `/api/fases` | Returns synodic lunar cycle phases and local lunar sunrise windows. |
| `GET` | `/api/viagem` | Computes 3D $(X, Y, Z)$ ephemeris vectors for Sun, Earth, Moon, and TLI trajectory. |

---

## 📊 GO / NO-GO Engineering Criteria

A candidate site and mission window receives a **GO** classification when all operational thresholds are satisfied:

* **Solar Illumination:** $\ge 50\%$ of the mission window with the Sun above local topographic relief.
* **Direct-to-Earth (DTE) Link:** $\ge 50\%$ of the window with unobstructed line-of-sight to Earth.
* **Landing Safety Slope:** Local terrain slope $\le 15.0^\circ$ derived from a $5 \times 5$ central gradient on the LOLA DEM.

---

## 🛰️ Data Sources & Acknowledgments

* **NASA/JPL Solar System Dynamics:** DE421 Planetary and Lunar Ephemerides (`de421.bsp`, `MOON_ME_DE421` frame).
* **NASA Goddard / LRO LOLA Science Team:** Lunar Orbiter Laser Altimeter (LOLA) South Polar Digital Elevation Models.
* Built with ❤️ for the **2026 NASA Space Apps Challenge**.