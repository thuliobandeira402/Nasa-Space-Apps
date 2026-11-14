# backend/terrain_engine.py
import math
import numpy as np
from data_loader import get_horizon_profiles, LOLA_DEM_PATH
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


def _gerar_malha_sintetica(lat: float, lon: float, elevacao_m: float, grid_size: int = 64) -> dict:
    """Gera malha 3D determinística quando o ponto está fora da cobertura do GeoTIFF polar (-80°S)."""
    seed_local = int(abs(lat) * 10000 + abs(lon) * 1000 + abs(elevacao_m)) % (2**31 - 1)
    rng = np.random.default_rng(seed_local)
    fator_polar = (abs(lat) / 90.0) ** 2

    y, x = np.mgrid[-1.0:1.0:complex(0, grid_size), -1.0:1.0:complex(0, grid_size)]
    z = np.zeros((grid_size, grid_size), dtype=float)

    for _ in range(5):
        cx, cy = rng.uniform(-0.7, 0.7), rng.uniform(-0.7, 0.7)
        sigma = rng.uniform(0.18, 0.45)
        amp = rng.uniform(-120.0, 180.0) * (0.4 + 0.6 * fator_polar)
        z += amp * np.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2.0 * sigma ** 2))

    z += elevacao_m
    pixel_m = 40.0
    dy, dx = np.gradient(z, pixel_m)
    slope_matrix = np.degrees(np.arctan(np.hypot(dx, dy)))
    c = grid_size // 2
    slope_deg = float(np.round(np.mean(slope_matrix[c - 2:c + 3, c - 2:c + 3]), 2))

    min_elev, max_elev = float(np.min(z)), float(np.max(z))
    span = max(1.0, max_elev - min_elev)
    heights_norm = ((z - np.mean(z)) / span).ravel()

    return {
        "size": grid_size,
        "pixel_m": pixel_m,
        "min_elevation_m": round(min_elev, 1),
        "max_elevation_m": round(max_elev, 1),
        "center_elevation_m": round(float(z[c, c]), 1),
        "slope_deg": slope_deg,
        "heights": np.round(heights_norm, 4).tolist(),
    }


def gerar_perfil_horizonte_360(lat: float, lon: float, elevacao_m: float = 0.0) -> dict:
    azimutes = np.arange(0, 360, 1)
    profiles = get_horizon_profiles()
    site_id = identificar_site_conhecido(lat, lon)

    # Caso 1: Cobertura real do DEM LOLA no Polo Sul (lat <= -80°)
    if lat <= -80.0 and LOLA_DEM_PATH.exists():
        try:
            horizonte_real = horizonte_lola(lat, lon, str(LOLA_DEM_PATH))
            malha = extrair_malha_terreno_lola(lat, lon, str(LOLA_DEM_PATH), grid_size=64)
            res_m = int(round(malha["pixel_m"]))
            return {
                "modo_terreno": f"NASA LOLA LDEM (Real Data, {res_m} m/px)",
                "site_id_detectado": site_id,
                "azimutes_graus": azimutes.tolist(),
                "elevacao_horizonte_graus": horizonte_real,
                "obstaculos_principais": [],
                "terrain_grid": malha_fallback,
                "slope_deg_real": None,
                "center_elevation_m_real": elevacao_m,
            }
        except Exception as e:
            print(f"[LOLA] Falha ao ler DEM ({e}); utilizando perfil catalogado/sintético.")

    malha_fallback = _gerar_malha_sintetica(lat, lon, elevacao_m)

    # Caso 2: Sítio catalogado em horizon_profiles.json
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
            "modo_terreno": f"Cataloged Topographic Profile ({site_id})",
            "site_id_detectado": site_id,
            "azimutes_graus": azimutes.tolist(),
            "elevacao_horizonte_graus": np.round(horizonte, 2).tolist(),
            "obstaculos_principais": obstaculos_info,
            "terrain_grid": malha_fallback,
            "slope_deg_real": malha_fallback["slope_deg"],
            "center_elevation_m_real": elevacao_m,
        }

    # Caso 3: Ponto customizado fora de -80°S -> Modelo Topográfico Sintético Determinístico
    fator_polar = (abs(lat) / 90.0) ** 2
    seed_local = int(abs(lat) * 10000 + abs(lon) * 1000 + abs(elevacao_m)) % (2**31 - 1)
    rng = np.random.default_rng(seed_local)

    if elevacao_m >= 1500:
        base_deg = -0.4
    elif elevacao_m < 0:
        base_deg = 2.0 * fator_polar + 0.5
    else:
        base_deg = 0.5 * fator_polar

    horizonte = np.full(360, base_deg, dtype=float)
    obstaculos_info = []

    for i in range(4):
        centro = int(rng.integers(0, 360))
        largura = int(rng.integers(25, 65))
        altura_max = float(np.round(rng.uniform(0.8, 4.2) * (0.3 + 0.7 * fator_polar), 2))
        diff = np.minimum(np.abs(azimutes - centro), 360.0 - np.abs(azimutes - centro))
        curva_montanha = altura_max * np.exp(-0.5 * (diff / (largura / 2.5)) ** 2)
        horizonte = np.maximum(horizonte, base_deg + curva_montanha)
        obstaculos_info.append({
            "az_center": centro,
            "width": largura,
            "max_elev_deg": altura_max,
            "feature": f"Local Relief #{i+1}",
        })

    return {
        "modo_terreno": "Synthetic Topographic Model (Latitude/Elevation Parameterized)",
        "site_id_detectado": site_id,
        "azimutes_graus": azimutes.tolist(),
        "elevacao_horizonte_graus": np.round(horizonte, 2).tolist(),
        "obstaculos_principais": obstaculos_info,
        "terrain_grid": malha_fallback,
        "slope_deg_real": malha_fallback["slope_deg"],
        "center_elevation_m_real": elevacao_m,
    }

def aplicar_obstrucao_terreno(dados_efemerides: dict, perfil_horizonte: dict) -> dict:
    """
    Cruza as séries temporais do Sol e da Terra (vindas do ephemeris_engine)
    com o perfil de horizonte de 360°.
    """
    horizonte_360 = np.array(perfil_horizonte["elevacao_horizonte_graus"], dtype=float)

    sol_alt = np.array(dados_efemerides["sol_elevacao_graus"], dtype=float)
    sol_az = np.array(dados_efemerides["sol_azimute_graus"], dtype=float)

    terra_alt = np.array(dados_efemerides["terra_elevacao_graus"], dtype=float)
    terra_az = np.array(dados_efemerides["terra_azimute_graus"], dtype=float)

    # Converte o azimute (0.0 a 359.99) em índice inteiro (0 a 359) para buscar na tabela de horizonte
    sol_az_idx = np.floor(sol_az).astype(int) % 360
    terra_az_idx = np.floor(terra_az).astype(int) % 360

    # Descobre qual é a altura da montanha exatamente na direção onde o Sol/Terra estão a cada hora
    horizonte_direcao_sol = horizonte_360[sol_az_idx]
    horizonte_direcao_terra = horizonte_360[terra_az_idx]

    # Há visibilidade real somente se o astro estiver ACIMA da montanha naquela direção
    sol_visivel = (sol_alt + 0.265) > horizonte_direcao_sol
    terra_visivel = terra_alt > horizonte_direcao_terra

    # Margem livre acima do horizonte (positivo = visível, negativo = quantos graus está escondido atrás da cratera)
    folga_sol_graus = sol_alt - horizonte_direcao_sol
    folga_terra_graus = terra_alt - horizonte_direcao_terra

    resultado = dict(dados_efemerides)
    resultado.update({
        "horizonte_direcao_sol_graus": np.round(horizonte_direcao_sol, 2).tolist(),
        "horizonte_direcao_terra_graus": np.round(horizonte_direcao_terra, 2).tolist(),
        "folga_acima_horizonte_sol_graus": np.round(folga_sol_graus, 3).tolist(),
        "folga_acima_horizonte_terra_graus": np.round(folga_terra_graus, 3).tolist(),
        "sol_visivel_bool": sol_visivel.tolist(),
        "terra_visivel_bool": terra_visivel.tolist()
    })

    return resultado