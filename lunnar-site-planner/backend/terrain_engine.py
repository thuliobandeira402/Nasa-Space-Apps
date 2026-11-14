# backend/terrain_engine.py
import numpy as np
from data_loader import get_horizon_profiles
from sites_catalog import SITES_CATALOG


def _identificar_site_conhecido(lat: float, lon: float, tolerancia_graus: float = 0.25) -> str | None:
    """
    Verifica se a coordenada informada corresponde a algum local do SITES_CATALOG.
    Retorna o 'id' do local (ex: 'shackleton_rim') ou None se for um ponto customizado.
    """
    for site in SITES_CATALOG:
        if abs(site["lat"] - lat) <= tolerancia_graus and abs(site["lon"] - lon) <= tolerancia_graus:
            return site["id"]
    return None


def gerar_perfil_horizonte_360(lat: float, lon: float, elevacao_m: float = 0.0) -> dict:
    """
    Gera a elevação do horizonte (em graus) para todos os 360 graus de azimute (0° a 359°).
    - Se for um local catalogado em horizon_profiles.json, constrói as montanhas/crateras reais.
    - Se for uma coordenada customizada, gera um relevo determinístico baseado na latitude e altitude.
    """
    azimutes = np.arange(0, 360, 1)
    profiles = get_horizon_profiles()
    site_id = _identificar_site_conhecido(lat, lon)

    # Caso 1: Local conhecido com perfil topográfico mapeado no JSON
    if site_id and site_id in profiles:
        cfg = profiles[site_id]
        base_deg = float(cfg.get("base_horizon_deg", 0.0))
        horizonte = np.full(360, base_deg, dtype=float)
        obstaculos_info = cfg.get("obstacles", [])

        for obs in obstaculos_info:
            centro = float(obs["az_center"])
            largura = float(obs["width"])
            altura_max = float(obs["max_elev_deg"])

            # Distância angular circular (resolve a virada de 359° para 0°)
            diff = np.minimum(np.abs(azimutes - centro), 360.0 - np.abs(azimutes - centro))
            # Curva Gaussiana suave simulando o formato da montanha/borda de cratera
            curva_montanha = altura_max * np.exp(-0.5 * (diff / (largura / 2.5)) ** 2)
            horizonte = np.maximum(horizonte, base_deg + curva_montanha)

        modo_terreno = f"Perfil Topográfico Mapeado ({site_id})"

    # Caso 2: Coordenada customizada escolhida pelo usuário
    else:
        # Quanto mais próximo do Polo Sul (|lat| -> 90), mais acidentado é o terreno (crateras profundas)
        fator_polar = (abs(lat) / 90.0) ** 2

        # Seed fixa baseada na coordenada: a mesma coordenada sempre gera o mesmo relevo!
        seed_local = int(abs(lat) * 10000 + abs(lon) * 1000 + abs(elevacao_m)) % (2**31 - 1)
        rng = np.random.default_rng(seed_local)

        # Se estiver no topo de um maciço (>1500m), o horizonte base é negativo; em cratera (<0m), é alto
        if elevacao_m >= 1500:
            base_deg = -0.4
        elif elevacao_m < 0:
            base_deg = 2.0 * fator_polar + 0.5
        else:
            base_deg = 0.5 * fator_polar

        horizonte = np.full(360, base_deg, dtype=float)
        obstaculos_info = []

        # Gera 4 feições topográficas locais (colinas/bordas de cratera)
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
                "feature": f"Relevo Local #{i+1}"
            })

        modo_terreno = "Modelo Topográfico Sintético (Parametrizado por Latitude/Altitude)"

    return {
        "modo_terreno": modo_terreno,
        "site_id_detectado": site_id,
        "azimutes_graus": azimutes.tolist(),
        "elevacao_horizonte_graus": np.round(horizonte, 2).tolist(),
        "obstaculos_principais": obstaculos_info
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