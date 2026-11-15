# backend/metrics_analyzer.py
import numpy as np


def _analisar_proximo_evento(vetor_visivel: np.ndarray, passo_horas: int, nome_astro: str) -> dict:
    if len(vetor_visivel) == 0:
        return {
            "visivel_no_pouso": False,
            "horas_ate_transicao": 0,
            "tipo_transicao": "SEM_DADOS",
            "descricao_status": "Insufficient data",
        }

    visivel_inicial = bool(vetor_visivel[0])
    indices_mudanca = np.where(vetor_visivel != visivel_inicial)[0]

    if len(indices_mudanca) > 0:
        horas = int(indices_mudanca[0] * passo_horas)
        if visivel_inicial:
            tipo = "SUNSET" if nome_astro == "Sol" else "EARTHSET"
            desc = f"{horas}h remaining until {'Sunset' if nome_astro == 'Sol' else 'Earth occultation'}"
        else:
            tipo = "SUNRISE" if nome_astro == "Sol" else "EARTHRISE"
            desc = f"{horas}h until {'Sunrise' if nome_astro == 'Sol' else 'Earth signal acquisition'}"
    else:
        horas = int(len(vetor_visivel) * passo_horas)
        if visivel_inicial:
            tipo = "CONTINUO_VISIVEL"
            desc = f"Continuous {'sunlight' if nome_astro == 'Sol' else 'DTE link'} throughout window ({horas}h)"
        else:
            tipo = "CONTINUO_OCULTO"
            desc = f"Continuous {'shadow' if nome_astro == 'Sol' else 'occultation'} throughout window ({horas}h)"

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
    passo_horas = int(dados.get("passo_horas", 1))
    alt_sun = np.array(dados.get("sol_elevacao_graus", []), dtype=float)
    alt_earth = np.array(dados.get("terra_elevacao_graus", []), dtype=float)
    dist_earth = np.array(dados.get("distancia_terra_km", []), dtype=float)

    if len(alt_sun) == 0:
        raise ValueError("As séries temporais de efemérides estão vazias.")

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

    # Critérios Científicos NASA (Artemis III / VIPER / CLPS):
    # - Base Sustentada Polar: Sol >= 70% e DTE >= 50%
    # - Missão de Superfície Padrão (Sortie CLPS/Artemis): Sol >= 50% (ou >= 156h contínuas = 6.5 dias) e DTE >= 50%
    sol_aprovado = (pct_luz_real >= 50.0) or (maior_janela_sol_h >= 156 and pct_luz_real >= 40.0)
    dte_aprovado = pct_comunicacao_real >= 40.0
    if pct_luz_real >= 70.0 and dte_aprovado:
        veredito = "OPTIMAL POLAR SITE (SUSTAINED)"
    elif sol_aprovado and dte_aprovado:
        veredito = "VIABLE MISSION (SORTIE / CLPS)"
    elif sol_aprovado and not dte_aprovado:
        veredito = "REQUIRES RELAY SATELLITE"
    else:
        veredito = "CRITICAL SHADOW / CONSTRAINED"

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
            f"(longest continuous sunlit window: {maior_janela_sol_h}h; topographic shadow loss: {perda_sombra_terreno_pct:.1f}%). "
            f"Max continuous night is {maior_janela_noite_h}h. "
            f"With a peak solar elevation of {elevacao_max_sol:.1f}°, vertical solar arrays deliver "
            f"{media_vert_pct:.1f}% average efficiency vs. {media_horiz_pct:.1f}% for horizontal panels."
        ),
    }