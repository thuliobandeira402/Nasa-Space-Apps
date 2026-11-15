# backend/main.py
import struct
import zlib
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import rasterio
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from rasterio.enums import Resampling
from skyfield import almanac

from data_loader import LOLA_DEM_PATH, get_planetary_context
from ephemeris_engine import calcular_visibilidade
from metrics_analyzer import analisar_metricas
from sites_catalog import SITES_CATALOG, get_site_by_id
from terrain_engine import aplicar_obstrucao_terreno, gerar_perfil_horizonte_360, identificar_site_conhecido


@asynccontextmanager
async def lifespan(app: FastAPI):
    if LOLA_DEM_PATH.exists():
        print(f"LOLA DEM loaded locally: {LOLA_DEM_PATH.name}")
        app.state.lola_dem_path = LOLA_DEM_PATH
    else:
        print("[WARNING] LOLA DEM not found in data/lola_dem/.")
    yield


app = FastAPI(
    title="NASA Lunar Landing Site Planner API",
    description="Lunar ephemeris, 360° LOLA topography, and visibility analysis engine",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

NOME_PADRAO = "Custom Coordinates"


class SimulacaoRequest(BaseModel):
    nome_local: str = Field(default=NOME_PADRAO)
    nome: str | None = Field(default=None)
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    elevacao_m: float = Field(default=0.0, ge=-10000.0, le=15000.0)
    ano: int = Field(default=2026, ge=1900, le=2050)
    mes: int = Field(default=11, ge=1, le=12)
    dia: int = Field(default=15, ge=1, le=31)
    data_inicio: str | None = Field(default=None, description="Optional YYYY-MM-DD")
    dias_simulacao: int = Field(default=30, ge=1, le=90)
    passo_horas: int = Field(default=1, ge=1, le=24)
    usar_topografia: bool = Field(default=True)


class ComparacaoRequest(BaseModel):
    cenario_a: SimulacaoRequest | None = None
    cenario_b: SimulacaoRequest | None = None
    cenarios: list[SimulacaoRequest] | None = None


def _normalizar_efemerides(dados_brutos: list | dict, passo_horas: int) -> dict:
    if isinstance(dados_brutos, dict):
        dados_brutos.setdefault("passo_horas", passo_horas)
        return dados_brutos

    if not dados_brutos:
        raise ValueError("calcular_visibilidade returned an empty list.")

    return {
        "passo_horas": passo_horas,
        "timestamps": [item["timestamp"] for item in dados_brutos],
        "hora_indice": [item.get("hora_indice", i * passo_horas) for i, item in enumerate(dados_brutos)],
        "sol_elevacao_graus": [item["sun_elevation_deg"] for item in dados_brutos],
        "sol_azimute_graus": [item["sun_azimuth_deg"] for item in dados_brutos],
        "terra_elevacao_graus": [item["earth_elevation_deg"] for item in dados_brutos],
        "terra_azimute_graus": [item["earth_azimuth_deg"] for item in dados_brutos],
        "fases_lua_iluminada_pct": [item.get("moon_illumination_pct", 50.0) for item in dados_brutos],
        "distancia_terra_km": [item.get("earth_distance_km", 384400.0) for item in dados_brutos],
    }


@app.get("/api/lola-polar-map")
def obter_mapa_polar_lola():
    """
    Gera PNG real (512x512) de relevo sombreado (hillshade) diretamente do GeoTIFF
    NASA LOLA do Polo Sul (-80°S a -90°S) para texturizar o Globo 3D.
    """
    if not LOLA_DEM_PATH.exists():
        raise HTTPException(status_code=404, detail="LOLA DEM file not found.")

    size = 512
    with rasterio.open(LOLA_DEM_PATH) as src:
        z = src.read(1, out_shape=(size, size), resampling=Resampling.bilinear).astype("float64")
        if src.nodata is not None:
            z[z == src.nodata] = np.nan
        scale = float(src.scales[0]) if src.scales else 1.0
        offset = float(src.offsets[0]) if src.offsets else 0.0
        z = z * scale + offset

    med = float(np.nanmean(z))
    z = np.where(np.isnan(z), med, z)

    dy, dx = np.gradient(z, 240.0)
    slope = np.pi / 2.0 - np.arctan(np.hypot(dx, dy))
    aspect = np.arctan2(-dx, dy)
    az_rad = np.radians(315.0)
    alt_rad = np.radians(35.0)
    shaded = np.sin(alt_rad) * np.sin(slope) + np.cos(alt_rad) * np.cos(slope) * np.cos(az_rad - aspect)
    shaded = np.clip((shaded + 1.0) * 0.5, 0.0, 1.0)

    z_norm = (z - np.min(z)) / max(1.0, float(np.max(z) - np.min(z)))
    img_gray = np.clip((0.45 * z_norm + 0.55 * shaded) * 235 + 20, 0, 255).astype(np.uint8)

    raw_rows = b"".join(b"\x00" + img_gray[r].tobytes() for r in range(size))
    compressed = zlib.compress(raw_rows, level=6)

    def _chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack("!I", len(data)) + tag + data + struct.pack("!I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack("!IIBBBBB", size, size, 8, 0, 0, 0, 0)
    png_bytes = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", compressed) + _chunk(b"IEND", b"")
    return Response(content=png_bytes, media_type="image/png")


@app.get("/api/sites")
def listar_locais_predefinidos():
    return {"sites": SITES_CATALOG}


@app.get("/api/fases")
def obter_fases_lunares(
    start_date: str = Query(default="2027-03-01"),
    days: int = Query(default=30, ge=1, le=90),
    lat: float = Query(default=-89.9),
    lon: float = Query(default=0.0),
):
    try:
        dt0 = datetime.strptime(start_date.strip(), "%Y-%m-%d").replace(tzinfo=UTC)
    except ValueError:
        raise HTTPException(status_code=400, detail="start_date must be YYYY-MM-DD")

    ctx = get_planetary_context()
    ts, eph = ctx["ts"], ctx["eph"]
    t0 = ts.from_datetime(dt0)
    t1 = ts.from_datetime(dt0 + timedelta(days=days))

    fase_graus = float(almanac.moon_phase(eph, t0).degrees)
    illum_pct = round(float(almanac.fraction_illuminated(eph, "moon", t0)) * 100.0, 1)

    nomes_fases = [
        "New Moon",
        "Waxing Crescent",
        "First Quarter",
        "Waxing Gibbous",
        "Full Moon",
        "Waning Gibbous",
        "Last Quarter",
        "Waning Crescent",
    ]
    idx_fase = int(((fase_graus + 22.5) % 360) // 45)
    fase_nome = f"{nomes_fases[idx_fase]} ({illum_pct}% illuminated)"

    times_fases, estados_fases = almanac.find_discrete(t0, t1, almanac.moon_phases(eph))
    eventos = [
        {
            "timestamp": tf.utc_iso(),
            "fase_id": int(ef),
            "fase": ["New Moon", "First Quarter", "Full Moon", "Last Quarter"][int(ef)],
        }
        for tf, ef in zip(times_fases, estados_fases)
    ]

    return {
        "ciclo_sinodico_dias": 29.53,
        "fase_graus": round(fase_graus, 2),
        "iluminacao_pct": illum_pct,
        "fase_nome": fase_nome,
        "eventos_fase": eventos,
    }


@app.get("/api/viagem")
def obter_trajetoria_viagem(
    start_date: str = Query(default="2027-03-01"),
    duration_days: int = Query(default=4, ge=1, le=15),
):
    try:
        dt0 = datetime.strptime(start_date.strip(), "%Y-%m-%d").replace(tzinfo=UTC)
    except ValueError:
        raise HTTPException(status_code=400, detail="start_date must be YYYY-MM-DD")

    ctx = get_planetary_context()
    ts, earth, moon = ctx["ts"], ctx["earth"], ctx["moon"]

    steps = 48
    dts = [dt0 + timedelta(hours=(duration_days * 24 * i) / steps) for i in range(steps + 1)]
    t_arr = ts.from_datetimes(dts)

    moon_vec_km = (moon - earth).at(t_arr[-1]).position.km
    dist_km = float(np.linalg.norm(moon_vec_km))

    escala = 4.2 / 384400.0
    earth_scene = np.array([-3.2, 0.0, 0.0])
    moon_offset = np.array([moon_vec_km[0], moon_vec_km[2] * 0.35, moon_vec_km[1]]) * escala
    moon_scene = earth_scene + moon_offset

    trajectory = []
    perp = np.array([-moon_offset[2], 0.0, moon_offset[0]])
    perp = perp / (np.linalg.norm(perp) + 1e-9)

    for i in range(steps + 1):
        u = i / steps
        base = (1 - u) * earth_scene + u * moon_scene
        arco = np.sin(u * np.pi) * 1.45 * perp + np.array([0.0, np.sin(u * np.pi) * 0.45, 0.0])
        pt = base + arco
        trajectory.append({
            "step": i,
            "x": round(float(pt[0]), 3),
            "y": round(float(pt[1]), 3),
            "z": round(float(pt[2]), 3),
        })

    return {
        "distancia_terra_lua_km": round(dist_km, 1),
        "earth_pos": {"x": round(float(earth_scene[0]), 3), "y": 0.0, "z": 0.0},
        "moon_pos": {
            "x": round(float(moon_scene[0]), 3),
            "y": round(float(moon_scene[1]), 3),
            "z": round(float(moon_scene[2]), 3),
        },
        "tli_trajectory": trajectory,
    }


@app.post("/api/simulate")
def simular_local(req: SimulacaoRequest):
    passo_efetivo = 3 if (req.dias_simulacao > 30 and req.passo_horas == 1) else req.passo_horas
    try:
        nome_informado = (req.nome or "").strip()
        nome_local_limpo = (req.nome_local or "").strip()
        if nome_informado:
            nome_final = nome_informado
        elif nome_local_limpo and nome_local_limpo != NOME_PADRAO:
            nome_final = nome_local_limpo
        else:
            site_id = identificar_site_conhecido(req.lat, req.lon)
            site = get_site_by_id(site_id) if site_id else None
            nome_final = site["name"] if site else NOME_PADRAO

        ano, mes, dia = req.ano, req.mes, req.dia
        if req.data_inicio:
            partes = req.data_inicio.strip().split("-")
            if len(partes) != 3:
                raise ValueError("data_inicio must be YYYY-MM-DD")
            ano, mes, dia = int(partes[0]), int(partes[1]), int(partes[2])
            if not (1900 <= ano <= 2050):
                raise ValueError("year must be between 1900 and 2050 (SPICE kernel bounds)")

        if req.usar_topografia:
            perfil_horizonte = gerar_perfil_horizonte_360(req.lat, req.lon, req.elevacao_m)
        else:
            perfil_horizonte = {
                "modo_terreno": "Ideal Lunar Sphere (Topographic Obstruction Disabled)",
                "data_quality": "flat_disabled",
                "resolution_m": None,
                "site_id_detectado": None,
                "azimutes_graus": list(range(360)),
                "elevacao_horizonte_graus": [0.0] * 360,
                "obstaculos_principais": [],
                "terrain_grid": None,
                "slope_deg_real": None,
                "center_elevation_m_real": req.elevacao_m,
            }

        elevacao_efetiva = (
            perfil_horizonte["center_elevation_m_real"]
            if perfil_horizonte.get("center_elevation_m_real") is not None
            else req.elevacao_m
        )

        lista_efemerides = calcular_visibilidade(
            lat=req.lat,
            lon=req.lon,
            elevacao_m=elevacao_efetiva,
            ano=ano,
            mes=mes,
            dia=dia,
            dias_simulacao=req.dias_simulacao,
            passo_horas=passo_efetivo,
        )
        dados_vetorizados = _normalizar_efemerides(lista_efemerides, passo_efetivo)
        dados_processados = aplicar_obstrucao_terreno(dados_vetorizados, perfil_horizonte)
        metricas = analisar_metricas(dados_processados)

        return {
            "local": nome_final,
            "coordenadas": {
                "lat": req.lat,
                "lon": req.lon,
                "elevacao_m": elevacao_efetiva,
            },
            "configuracao": {
                "data_inicio": f"{ano:04d}-{mes:02d}-{dia:02d}",
                "dias_simulacao": req.dias_simulacao,
                "passo_horas": passo_efetivo,
                "topografia_ativa": req.usar_topografia,
            },
            "metricas_resumo": metricas,
            "perfil_horizonte_360": perfil_horizonte,
            "series_temporais": dados_processados,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=f"Invalid parameter: {str(ve)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/compare")
def comparar_cenarios(req: ComparacaoRequest):
    if req.cenarios:
        return {
            "total_cenarios": len(req.cenarios),
            "resultados": [simular_local(c) for c in req.cenarios],
        }
    if req.cenario_a and req.cenario_b:
        res_a = simular_local(req.cenario_a)
        res_b = simular_local(req.cenario_b)
        return {
            "cenario_a": res_a,
            "cenario_b": res_b,
            "resultados": [res_a, res_b],
        }
    raise HTTPException(
        status_code=422,
        detail="Provide 'cenario_a' and 'cenario_b' or a list in 'cenarios'.",
    )


class PousoRequest(BaseModel):
    site_id: str | None = None
    site_name: str | None = None
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-360.0, le=360.0)
    elevacao_m: float | None = Field(default=None, ge=-10000.0, le=15000.0)
    start_date: str = Field(default="2027-03-01")
    days: int = Field(default=30, ge=1, le=90)
    step_min: int = Field(default=60, ge=5, le=360)
    usar_topografia: bool = Field(default=True)


def _normalizar_lon(lon: float) -> float:
    return ((lon + 180.0) % 360.0) - 180.0


@app.post("/simular-pouso")
def simular_pouso(req: PousoRequest):
    lon = _normalizar_lon(req.lon)

    site_req = get_site_by_id(req.site_id) if (req.site_id and req.site_id != "custom") else None
    if site_req and abs(req.lat - site_req["lat"]) < 0.01 and abs(lon - site_req["lon"]) < 0.01:
        site_id = site_req["id"]
        site = site_req
    else:
        site_id = identificar_site_conhecido(req.lat, lon)
        site = get_site_by_id(site_id) if site_id else None

    nome = (req.site_name or "").strip() or (site["name"] if site else NOME_PADRAO)

    passo_horas = max(1, min(24, round(req.step_min / 60)))
    elev_efetiva = (
        req.elevacao_m
        if req.elevacao_m is not None
        else (site["elevation_m"] if site else 0.0)
    )

    res = simular_local(SimulacaoRequest(
        nome=nome,
        lat=req.lat,
        lon=lon,
        elevacao_m=elev_efetiva,
        data_inicio=req.start_date,
        dias_simulacao=req.days,
        passo_horas=passo_horas,
        usar_topografia=req.usar_topografia,
    ))
    s = res["series_temporais"]
    m = res["metricas_resumo"]
    perfil = res["perfil_horizonte_360"]
    passo_h = res["configuracao"]["passo_horas"]

    timeline = []
    for i, ts in enumerate(s["timestamps"]):
        sol_ok = bool(s["sol_visivel_bool"][i])
        terra_ok = bool(s["terra_visivel_bool"][i])
        timeline.append({
            "step": i,
            "timestamp": ts,
            "elapsed_hours": i * passo_h,
            "sun_elevation_deg": s["sol_elevacao_graus"][i],
            "sun_azimuth_deg": s["sol_azimute_graus"][i],
            "terrain_mask_deg": s["horizonte_direcao_sol_graus"][i],
            "sun_visible": sol_ok,
            "earth_elevation_deg": s["terra_elevacao_graus"][i],
            "earth_azimuth_deg": s["terra_azimute_graus"][i],
            "earth_visible": terra_ok,
            "operational_window": sol_ok and terra_ok,
        })

    elev = perfil["elevacao_horizonte_graus"]
    horizon_profile = [{"azimuth_deg": az, "elevation_deg": elev[az % 360]} for az in range(0, 361, 5)]

    sun_pct = m["iluminacao_solar_pct"]
    earth_pct = m["visibilidade_terra_pct"]
    max_sun_h = m["maior_janela_continua_sol_horas"]

    slope = perfil.get("slope_deg_real")
    if slope is None and site:
        slope = site.get("slope_deg")

    seguranca = None if slope is None else (slope <= 15.0)
    iluminacao = (sun_pct >= 50.0) or (max_sun_h >= 156 and sun_pct >= 40.0)
    comunicacao = earth_pct >= 50.0

    if seguranca is None:
        go_nogo = "INCONCLUSIVE"
    elif iluminacao and comunicacao and seguranca:
        go_nogo = "GO"
    else:
        go_nogo = "NO-GO"

    return {
        "site_id": site_id,
        "site_name": nome,
        "lat": req.lat,
        "lon": req.lon,
        "data_quality": perfil.get("data_quality", "lola_real"),
        "resolution_m": perfil.get("resolution_m"),
        "modo_terreno": perfil.get("modo_terreno"),
        "start_date": res["configuracao"]["data_inicio"],
        "days": req.days,
        "step_min": passo_h * 60,
        "slope_deg": slope,
        "sunset_duration_min": m.get("duracao_crepusculo_min"),
        "sun_fraction_pct": sun_pct,
        "earth_fraction_pct": earth_pct,
        "max_continuous_sun_hours": max_sun_h,
        "max_continuous_night_hours": m["maior_noite_continua_horas"],
        "horizon_profile": horizon_profile,
        "terrain_grid": perfil.get("terrain_grid"),
        "criterios": {
            "seguranca_topografica": seguranca,
            "iluminacao_solar": iluminacao,
            "comunicacao_direta": comunicacao,
        },
        "go_nogo": go_nogo,
        "veredito_backend": m["veredito"],
        "assumptions": [
            f"Lunar Ephemerides & Orientation: NASA/JPL SPICE (DE421, MOON_ME_DE421), {passo_h}h integration step.",
            f"360° Horizon (100 km raycast with lunar curvature correction) & 3D Local Terrain (36 × 36 km, 5×5 median baseline slope): {perfil['modo_terreno']}.",
            "Apparent Solar Disc: 0.265° semidiameter without atmospheric refraction (illuminated disc fraction weighted for solar power); Direct-to-Earth (DTE) evaluated via geometric line-of-sight (0° terrain clearance; 2° RF multipath margin noted for link budget).",
            "NASA GO Criteria (Artemis/CLPS): Touchdown slope ≤ 15°, Earth DTE link ≥ 50%, and Solar availability ≥ 50% (or ≥ 156h continuous sunlit sortie window with ≥ 40% monthly illumination).",
            m["contexto_educacional"],
        ],
        "timeline": timeline,
        "evento_sol": m["evento_sol"],
        "evento_terra": m["evento_terra"],
        "metricas_resumo": m,
    }


FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")