# backend/metrics_analyzer.py
import numpy as np


def _analisar_proximo_evento(vetor_visivel: np.ndarray, passo_horas: int, nome_astro: str) -> dict:
    """
    Identifica se o astro (Sol ou Terra) está visível no instante t=0 (pouso)
    e calcula quantas horas faltam até a próxima transição (Sunset/Sunrise ou Earthset/Earthrise).
    """
    if len(vetor_visivel) == 0:
        return {
            "visivel_no_pouso": False,
            "horas_ate_transicao": 0,
            "tipo_transicao": "NO_DATA",
            "descricao_status": "Insufficient data",
        }

    visivel_inicial = bool(vetor_visivel[0])
    indices_mudanca = np.where(vetor_visivel != visivel_inicial)[0]

    if len(indices_mudanca) > 0:
        horas = int(indices_mudanca[0] * passo_horas)
        if visivel_inicial:
            tipo = "SUNSET" if nome_astro == "Sol" else "EARTHSET"
            desc = f"{horas}h remaining until {'sunset' if nome_astro == 'Sol' else 'Earth occultation'}"
        else:
            tipo = "SUNRISE" if nome_astro == "Sol" else "EARTHRISE"
            desc = f"{horas}h until {'sunrise' if nome_astro == 'Sol' else 'Earth signal acquisition'}"
    else:
        horas = int(len(vetor_visivel) * passo_horas)
        if visivel_inicial:
            tipo = "CONTINUOUS_VISIBLE"
            desc = f"Continuous {'solar illumination' if nome_astro == 'Sol' else 'Earth DTE link'} across window ({horas}h)"
        else:
            tipo = "CONTINUOUS_OCCULTED"
            desc = f"Continuous {'shadow' if nome_astro == 'Sol' else 'no direct Earth LOS'} across window ({horas}h)"

    return {
        "visivel_no_pouso": visivel_inicial,
        "horas_ate_transicao": horas,
        "tipo_transicao": tipo,
        "descricao_status": desc,
    }


def _calcular_maior_janela_continua(vetor_visivel: np.ndarray, passo_horas: int) -> int:
    if len(vetor_visivel) == 0 or not np.any(vetor_visivel):
        return 0
    padded = np.concatenate(([0], vetor_visivel.astype(int), [0]))
    diffs = np.diff(padded)
    inicios = np.where(diffs == 1)[0]
    fins = np.where(diffs == -1)[0]
    duracoes = (fins - inicios) * passo_horas
    return int(np.max(duracoes))


def analisar_metricas(dados: dict) -> dict:
    """
    Transforma as séries temporais (efemérides + obstrução real LOLA)
    nos KPIs executivos, engenharia de potência e contexto educacional em inglês.
    """
    passo_horas = int(dados.get("passo_horas", 1))
    alt_sun = np.array(dados.get("sol_elevacao_graus", []), dtype=float)
    alt_earth = np.array(dados.get("terra_elevacao_graus", []), dtype=float)
    dist_earth = np.array(dados.get("distancia_terra_km", []), dtype=float)

    if len(alt_sun) == 0:
        raise ValueError("Ephemeris time series are empty.")

    SOLAR_SEMIDIAMETER_DEG = 0.265

    sol_visivel_sem_relevo = (alt_sun + SOLAR_SEMIDIAMETER_DEG) > 0.0
    sol_visivel = np.array(dados.get("sol_visivel_bool", sol_visivel_sem_relevo), dtype=bool)
    terra_visivel = np.array(dados.get("terra_visivel_bool", alt_earth > 0.0), dtype=bool)

    pct_luz_sem_relevo = float(np.mean(sol_visivel_sem_relevo) * 100.0)
    pct_luz_real = float(np.mean(sol_visivel) * 100.0)
    perda_sombra_terreno_pct = max(0.0, pct_luz_sem_relevo - pct_luz_real)

    pct_comunicacao_real = float(np.mean(terra_visivel) * 100.0)
    latencia_media_seg = float(np.mean(dist_earth) * 2.0 / 299792.458) if len(dist_earth) > 0 else 2.56

    rad_sun = np.radians(np.clip(alt_sun, 0.0, 90.0))
    potencia_horiz = np.where(sol_visivel, np.sin(rad_sun) * 100.0, 0.0)
    potencia_vert = np.where(sol_visivel, np.cos(rad_sun) * 100.0, 0.0)

    media_horiz_pct = float(np.mean(potencia_horiz))
    media_vert_pct = float(np.mean(potencia_vert))

    evento_sol = _analisar_proximo_evento(sol_visivel, passo_horas, "Sol")
    evento_terra = _analisar_proximo_evento(terra_visivel, passo_horas, "Terra")

    maior_janela_sol_h = _calcular_maior_janela_continua(sol_visivel, passo_horas)
    maior_janela_noite_h = _calcular_maior_janela_continua(~sol_visivel, passo_horas)

    elevacao_max_sol = float(np.max(alt_sun))
    elevacao_min_sol = float(np.min(alt_sun))

    if pct_luz_real >= 70.0 and pct_comunicacao_real >= 50.0:
        veredito = "VIABLE (OPTIMAL)"
    elif pct_luz_real >= 35.0 and pct_comunicacao_real >= 20.0:
        veredito = "CONDITIONAL / CRITICAL"
    elif pct_luz_real >= 35.0 and pct_comunicacao_real < 20.0:
        veredito = "REQUIRES ORBITAL RELAY"
    else:
        veredito = "UNVIABLE (EXTREME SHADOW)"

    return {
        "veredito": veredito,
        "iluminacao_solar_pct": round(pct_luz_real, 1),
        "iluminacao_teorica_sem_relevo_pct": round(pct_luz_sem_relevo, 1),
        "perda_sombra_topografica_pct": round(perda_sombra_terreno_pct, 1),
        "visibilidade_terra_pct": round(pct_comunicacao_real, 1),
        "elevacao_max_sol_graus": round(elevacao_max_sol, 2),
        "elevacao_min_sol_graus": round(elevacao_min_sol, 2),
        "potencia_media_painel_horizontal_pct": round(media_horiz_pct, 1),
        "potencia_media_painel_vertical_pct": round(media_vert_pct, 1),
        "evento_sol": evento_sol,
        "evento_terra": evento_terra,
        "maior_janela_continua_sol_horas": maior_janela_sol_h,
        "maior_noite_continua_horas": maior_janela_noite_h,
        "latencia_ida_volta_seg": round(latencia_media_seg, 2),
        "contexto_educacional": (
            f"Accounting for local LOLA topography, the Sun illuminates the landing site for {pct_luz_real:.1f}% of the window "
            f"(surrounding ridges and craters block {perda_sombra_terreno_pct:.1f}% of theoretical flat-horizon sunlight). "
            f"The longest continuous lunar night lasts {maior_janela_noite_h} hours. "
            f"Because the Sun reaches a maximum elevation of {elevacao_max_sol:.1f}°, vertical solar arrays "
            f"achieve {media_vert_pct:.1f}% average geometric efficiency versus {media_horiz_pct:.1f}% for horizontal arrays."
        ),
    }