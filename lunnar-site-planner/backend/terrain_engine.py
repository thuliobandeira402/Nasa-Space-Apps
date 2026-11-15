# backend/terrain_engine.py
import math
import numpy as np
from data_loader import get_horizon_profiles, LOLA_DEM_PATH
from sites_catalog import SITES_CATALOG
from lola_horizon import horizonte_lola, extrair_malha_terreno_lola

R_LUA_M = 1_737_400.0


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
    azimutes = np.arange(0, 360, 1)
    profiles = get_horizon_profiles()
    site_id = identificar_site_conhecido(lat, lon)

    # Nível 1 (Primário): Dados Reais do GeoTIFF NASA LOLA (cobertura -80°S a -90°S)
    if lat <= -80.0 and LOLA_DEM_PATH.exists():
        try:
            horizonte_real = horizonte_lola(lat, lon, str(LOLA_DEM_PATH))
            malha = extrair_malha_terreno_lola(lat, lon, str(LOLA_DEM_PATH), grid_size=128)
            res_m = int(round(malha["pixel_m"]))
            return {
                "data_quality": "lola",
                "resolution_m": res_m,
                "modo_terreno": f"NASA LOLA LDEM (Real Data, {res_m} m/px)",
                "site_id_detectado": site_id,
                "azimutes_graus": azimutes.tolist(),
                "elevacao_horizonte_graus": horizonte_real,
                "obstaculos_principais": [],
                "terrain_grid": malha,
                "slope_deg_real": malha["slope_deg"],
                "center_elevation_m_real": malha["center_elevation_m"],
            }
        except Exception as e:
            print(f"[LOLA] Erro ao ler DEM ({e}); verificando perfil catalogado.")

    # Nível 2: Sítio catalogado com perfil topográfico publicado (sem geração aleatória)
    if site_id and site_id in profiles:
        cfg = profiles[site_id]
        base_deg = float(cfg.get("base_horizon_deg", 0.0))
        horizonte = np.full(360, base_deg, dtype=float)
        obstaculos_info = cfg.get("obstacles", [])

        for obs in obstaculos_info:
            centro = float(obs["az_center"])
            largura = float(obs["width"])
            altura_max = float(obs["max_elev_deg"])
            diff = np.minimum(np.abs(azimutes - centro), 360.0 - np.abs(azimutes - centro))
            curva_montanha = altura_max * np.exp(-0.5 * (diff / (largura / 2.5)) ** 2)
            horizonte = np.maximum(horizonte, base_deg + curva_montanha)

        return {
            "data_quality": "catalog",
            "resolution_m": None,
            "modo_terreno": f"Cataloged Topographic Profile ({site_id})",
            "site_id_detectado": site_id,
            "azimutes_graus": azimutes.tolist(),
            "elevacao_horizonte_graus": np.round(horizonte, 2).tolist(),
            "obstaculos_principais": obstaculos_info,
            "terrain_grid": None,
            "slope_deg_real": None,
            "center_elevation_m_real": elevacao_m,
        }

    # Nível 3 (Fora da cobertura polar -80°S, ex: Apollo 11): Datum Esférico Lunar LOLA (sem ruído aleatório)
    # Depressão geométrica do horizonte devido à altitude acima do raio médio lunar (R = 1737.4 km)
    h_acima = max(0.0, elevacao_m)
    depressao_deg = -math.degrees(math.acos(R_LUA_M / (R_LUA_M + h_acima))) if h_acima > 0 else 0.0
    horizonte = np.full(360, round(depressao_deg, 3), dtype=float)

    return {
        "data_quality": "spherical_datum",
        "resolution_m": None,
        "modo_terreno": "Lunar Reference Sphere (Outside -80°S LOLA Polar DEM Coverage)",
        "site_id_detectado": site_id,
        "azimutes_graus": azimutes.tolist(),
        "elevacao_horizonte_graus": horizonte.tolist(),
        "obstaculos_principais": [],
        "terrain_grid": None,
        "slope_deg_real": None,
        "center_elevation_m_real": elevacao_m,
    }


def aplicar_obstrucao_terreno(dados_efemerides: dict, perfil_horizonte: dict) -> dict:
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
    terra_visivel = terra_alt > np.maximum(0.0, horizonte_direcao_terra)

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
    })

    return resultado