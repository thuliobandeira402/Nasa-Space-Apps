# backend/terrain_engine.py
import math
import numpy as np
from data_loader import LOLA_DEM_PATH
from sites_catalog import SITES_CATALOG
from lola_horizon import horizonte_lola, extrair_malha_terreno_lola


def _distancia_angular_graus(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat, dlon = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(a))))


def identificar_site_conhecido(lat: float, lon: float, tolerancia_graus: float = 0.25) -> str | None:
    melhor_id, melhor_dist = None, tolerancia_graus
    for site in SITES_CATALOG:
        d = _distancia_angular_graus(lat, lon, site["lat"], site["lon"])
        if d <= melhor_dist:
            melhor_id, melhor_dist = site["id"], d
    return melhor_id


def gerar_perfil_horizonte_360(lat: float, lon: float, elevacao_m: float = 0.0) -> dict:
    """
    Obtém o perfil topográfico 360° (raio 100 km) e a malha 3D exclusivamente do GeoTIFF
    real NASA LRO/LOLA para a região polar sul (lat <= -80°).
    Fora da cobertura polar do DEM (-80°S), utiliza esfera lunar de referência (0°),
    sem gerar relevo fictício ou sintético.
    """
    azimutes = np.arange(0, 360, 1)
    site_id = identificar_site_conhecido(lat, lon)

    if lat <= -80.0:
        if not LOLA_DEM_PATH.exists():
            raise FileNotFoundError(
                f"NASA LOLA DEM GeoTIFF not found at {LOLA_DEM_PATH}. Place LDEM_80S_240MPP_COMPACT.TIF in data/lola_dem/."
            )

        horizonte_real = horizonte_lola(lat, lon, str(LOLA_DEM_PATH), raio_m=100_000.0)
        malha = extrair_malha_terreno_lola(lat, lon, str(LOLA_DEM_PATH), grid_size=128, span_km=36.0)
        res_m = int(round(malha["pixel_m"]))

        return {
            "modo_terreno": f"NASA LOLA LDEM (Real Data, {res_m} m/px)",
            "data_quality": "lola_real",
            "resolution_m": res_m,
            "site_id_detectado": site_id,
            "azimutes_graus": azimutes.tolist(),
            "elevacao_horizonte_graus": horizonte_real,
            "obstaculos_principais": [],
            "terrain_grid": malha,
            "slope_deg_real": malha["slope_deg"],
            "center_elevation_m_real": malha["center_elevation_m"],
        }

    return {
        "modo_terreno": "Lunar Reference Sphere (Outside -80°S LOLA Polar DEM)",
        "data_quality": "reference_sphere_no_dem",
        "resolution_m": None,
        "site_id_detectado": site_id,
        "azimutes_graus": azimutes.tolist(),
        "elevacao_horizonte_graus": [0.0] * 360,
        "obstaculos_principais": [],
        "terrain_grid": None,
        "slope_deg_real": None,
        "center_elevation_m_real": elevacao_m,
    }


def aplicar_obstrucao_terreno(dados_efemerides: dict, perfil_horizonte: dict) -> dict:
    """
    Cruza as séries temporais do Sol e da Terra (JPL DE421) com o perfil de horizonte 360° real.
    """
    horizonte_360 = np.array(perfil_horizonte["elevacao_horizonte_graus"], dtype=float)

    sol_alt = np.array(dados_efemerides["sol_elevacao_graus"], dtype=float)
    sol_az = np.array(dados_efemerides["sol_azimute_graus"], dtype=float)

    terra_alt = np.array(dados_efemerides["terra_elevacao_graus"], dtype=float)
    terra_az = np.array(dados_efemerides["terra_azimute_graus"], dtype=float)

    sol_az_idx = np.floor(sol_az).astype(int) % 360
    terra_az_idx = np.floor(terra_az).astype(int) % 360

    horizonte_direcao_sol = horizonte_360[sol_az_idx]
    horizonte_direcao_terra = horizonte_360[terra_az_idx]

    sol_visivel = (sol_alt + 0.265) > horizonte_direcao_sol
    terra_visivel = terra_alt > horizonte_direcao_terra
    terra_link_rf_otimo = terra_alt > (horizonte_direcao_terra + 2.0)

    folga_sol_graus = sol_alt - horizonte_direcao_sol
    folga_terra_graus = terra_alt - horizonte_direcao_terra

    resultado = dict(dados_efemerides)
    resultado.update({
        "horizonte_direcao_sol_graus": np.round(horizonte_direcao_sol, 2).tolist(),
        "horizonte_direcao_terra_graus": np.round(horizonte_direcao_terra, 2).tolist(),
        "folga_acima_horizonte_sol_graus": np.round(folga_sol_graus, 3).tolist(),
        "folga_acima_horizonte_terra_graus": np.round(folga_terra_graus, 3).tolist(),
        "sol_visivel_bool": sol_visivel.tolist(),
        "terra_visivel_bool": terra_visivel.tolist(),
        "terra_link_rf_otimo_bool": terra_link_rf_otimo.tolist(),
    })

    return resultado