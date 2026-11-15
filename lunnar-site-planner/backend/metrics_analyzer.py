# backend/metrics_analyzer.py
import numpy as np

SOLAR_SEMIDIAMETER_DEG = 0.265


def _fracao_disco_solar(
    alt_sun_deg: np.ndarray,
    mask_deg: np.ndarray,
    r_deg: float = SOLAR_SEMIDIAMETER_DEG,
) -> np.ndarray:
    """Fração geométrica visível [0..1] do disco solar aparente acima da máscara topográfica."""
    h = alt_sun_deg - mask_deg
    u = np.clip(h / r_deg, -1.0, 1.0)
    frac = 0.5 + (u * np.sqrt(np.maximum(0.0, 1.0 - u * u)) + np.arcsin(u)) / np.pi
    return np.where(h <= -r_deg, 0.0, np.where(h >= r_deg, 1.0, frac))


def _calcular_duracao_crepusculo_min(
    alt_sun: np.ndarray,
    horizonte_sol: np.ndarray,
    passo_horas: int,
) -> float | None:
    """Duração mediana (minutos) para o disco solar aparente (0.53°) cruzar o horizonte local."""
    if len(alt_sun) < 2:
        return None
    folga = alt_sun - horizonte_sol
    cruzamentos = np.where(np.diff(np.signbit(folga)))[0]
    if len(cruzamentos) == 0:
        return None
    taxas_deg_h = np.abs(folga[cruzamentos + 1] - folga[cruzamentos]) / max(1, passo_horas)
    taxas_validas = taxas_deg_h[taxas_deg_h > 1e-4]
    if len(taxas_validas) == 0:
        return None
    duracoes_min = (2.0 * SOLAR_SEMIDIAMETER_DEG / taxas_validas) * 60.0
    return round(float(np.median(duracoes_min)), 1)


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
        horas = int(max(1, len(vetor_visivel) - 1) * passo_horas)
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
    limite_janela_h = max(passo_horas, (len(vetor_visivel) - 1) * passo_horas)
    return int(min(np.max(duracoes), limite_janela_h))


def analisar_metricas(dados: dict) -> dict:
    """
    Transforma as séries temporais (efemérides + obstrução real LOLA)
    nos KPIs executivos, engenharia de potência e contexto educacional em inglês.
    """
    passo_horas = int(dados.get("passo_horas", 1))
    alt_sun = np.array(dados.get("sol_elevacao_graus", []), dtype=float)
    alt_earth = np.array(dados.get("terra_elevacao_graus", []), dtype=float)
    dist_earth = np.array(dados.get("distancia_terra_km", []), dtype=float)
    horizonte_sol = np.array(dados.get("horizonte_direcao_sol_graus", np.zeros_like(alt_sun)), dtype=float)

    if len(alt_sun) == 0:
        raise ValueError("Ephemeris time series are empty.")

    sol_visivel_sem_relevo = (alt_sun + SOLAR_SEMIDIAMETER_DEG) > 0.0
    sol_visivel = np.array(dados.get("sol_visivel_bool", sol_visivel_sem_relevo), dtype=bool)
    terra_visivel = np.array(dados.get("terra_visivel_bool", alt_earth > 0.0), dtype=bool)

    pct_luz_sem_relevo = float(np.mean(sol_visivel_sem_relevo) * 100.0)
    pct_luz_real = float(np.mean(sol_visivel) * 100.0)
    perda_sombra_terreno_pct = max(0.0, pct_luz_sem_relevo - pct_luz_real)

    pct_comunicacao_real = float(np.mean(terra_visivel) * 100.0)
    latencia_media_seg = float(np.mean(dist_earth) * 2.0 / 299792.458) if len(dist_earth) > 0 else 2.56

    disc_frac = _fracao_disco_solar(alt_sun, horizonte_sol, SOLAR_SEMIDIAMETER_DEG)
    rad_sun = np.radians(np.clip(alt_sun, 0.0, 90.0))
    potencia_horiz = np.where(sol_visivel, disc_frac * np.sin(rad_sun) * 100.0, 0.0)
    potencia_vert = np.where(sol_visivel, disc_frac * np.cos(rad_sun) * 100.0, 0.0)

    media_horiz_pct = float(np.mean(potencia_horiz))
    media_vert_pct = float(np.mean(potencia_vert))

    evento_sol = _analisar_proximo_evento(sol_visivel, passo_horas, "Sol")
    evento_terra = _analisar_proximo_evento(terra_visivel, passo_horas, "Terra")

    maior_janela_sol_h = _calcular_maior_janela_continua(sol_visivel, passo_horas)
    maior_janela_noite_h = _calcular_maior_janela_continua(~sol_visivel, passo_horas)
    maior_janela_terra_h = _calcular_maior_janela_continua(terra_visivel, passo_horas)
    duracao_crepusculo_min = _calcular_duracao_crepusculo_min(alt_sun, horizonte_sol, passo_horas)

    elevacao_max_sol = float(np.max(alt_sun))
    elevacao_min_sol = float(np.min(alt_sun))

    # Critérios Científicos NASA (Artemis III / VIPER / CLPS):
    # - Energia Solar: >= 50% da janela OU janela contínua >= 156h (6.5 dias) com >= 40% total
    # - Comunicação DTE: >= 50% da janela OU janela contínua >= 72h (3 dias) com >= 40% total (ciclo de libração polar)
    sol_aprovado = (pct_luz_real >= 50.0) or (maior_janela_sol_h >= 156 and pct_luz_real >= 40.0)
    dte_aprovado = (pct_comunicacao_real >= 50.0) or (maior_janela_terra_h >= 72 and pct_comunicacao_real >= 40.0)

    if pct_luz_real >= 70.0 and dte_aprovado:
        veredito = "OPTIMAL POLAR SITE (SUSTAINED)"
    elif sol_aprovado and dte_aprovado:
        veredito = "VIABLE MISSION (SORTIE / CLPS)"
    elif sol_aprovado and not dte_aprovado:
        veredito = "REQUIRES ORBITAL RELAY"
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
        "maior_janela_continua_terra_horas": maior_janela_terra_h,
        "maior_noite_continua_horas": maior_janela_noite_h,
        "duracao_crepusculo_min": duracao_crepusculo_min,
        "latencia_ida_volta_seg": round(latencia_media_seg, 2),
        "contexto_educacional": (
            f"Accounting for local LOLA topography, the Sun illuminates the landing site for {pct_luz_real:.1f}% of the window "
            f"(longest continuous sunlit window: {maior_janela_sol_h}h; surrounding ridges block {perda_sombra_terreno_pct:.1f}% of theoretical flat-horizon sunlight). "
            f"Direct-to-Earth (DTE) link is available for {pct_comunicacao_real:.1f}% of the window (up to {maior_janela_terra_h}h continuous DTE). "
            f"Because the Sun reaches a maximum elevation of {elevacao_max_sol:.1f}°, vertical solar arrays "
            f"achieve {media_vert_pct:.1f}% average geometric efficiency versus {media_horiz_pct:.1f}% for horizontal arrays."
        ),
    }