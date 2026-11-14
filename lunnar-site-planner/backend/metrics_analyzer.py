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
            "tipo_transicao": "SEM_DADOS",
            "descricao_status": "Dados insuficientes"
        }

    visivel_inicial = bool(vetor_visivel[0])
    # Procura o primeiro índice onde o estado muda em relação ao instante t=0
    indices_mudanca = np.where(vetor_visivel != visivel_inicial)[0]

    if len(indices_mudanca) > 0:
        horas = int(indices_mudanca[0] * passo_horas)
        if visivel_inicial:
            tipo = "SUNSET" if nome_astro == "Sol" else "EARTHSET"
            desc = f"{horas}h restantes até o {'pôr do Sol' if nome_astro == 'Sol' else 'ocultamento da Terra'}"
        else:
            tipo = "SUNRISE" if nome_astro == "Sol" else "EARTHRISE"
            desc = f"{horas}h até o {'nascer do Sol' if nome_astro == 'Sol' else 'retorno do sinal da Terra'}"
    else:
        horas = int(len(vetor_visivel) * passo_horas)
        if visivel_inicial:
            tipo = "CONTINUO_VISIVEL"
            desc = f"{'Iluminação' if nome_astro == 'Sol' else 'Comunicação'} contínua em toda a janela ({horas}h)"
        else:
            tipo = "CONTINUO_OCULTO"
            desc = f"{'Sombra' if nome_astro == 'Sol' else 'Sem visada direta'} durante toda a janela ({horas}h)"

    return {
        "visivel_no_pouso": visivel_inicial,
        "horas_ate_transicao": horas,
        "tipo_transicao": tipo,
        "descricao_status": desc
    }


def _calcular_maior_janela_continua(vetor_visivel: np.ndarray, passo_horas: int) -> int:
    """
    Encontra a maior sequência ininterrupta de horas com visibilidade (ou sombra).
    """
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
    Transforma as séries temporais (efemérides + obstrução de terreno)
    nos KPIs executivos, engenharia de potência e contexto educacional.
    """
    passo_horas = int(dados.get("passo_horas", 1))
    alt_sun = np.array(dados.get("sol_elevacao_graus", []), dtype=float)
    alt_earth = np.array(dados.get("terra_elevacao_graus", []), dtype=float)
    dist_earth = np.array(dados.get("distancia_terra_km", []), dtype=float)

    if len(alt_sun) == 0:
        raise ValueError("As séries temporais de efemérides estão vazias.")

    SOLAR_SEMIDIAMETER_DEG = 0.265

    # Usa a visibilidade com topografia (se o terrain_engine rodou) ou horizonte ideal (> -0.265°)
    sol_visivel_sem_relevo = (alt_sun + SOLAR_SEMIDIAMETER_DEG) > 0.0
    sol_visivel = np.array(dados.get("sol_visivel_bool", sol_visivel_sem_relevo), dtype=bool)
    terra_visivel = np.array(dados.get("terra_visivel_bool", alt_earth > 0.0), dtype=bool)

    # 1. Métricas de Iluminação e Perda Topográfica
    pct_luz_sem_relevo = float(np.mean(sol_visivel_sem_relevo) * 100.0)
    pct_luz_real = float(np.mean(sol_visivel) * 100.0)
    perda_sombra_terreno_pct = max(0.0, pct_luz_sem_relevo - pct_luz_real)

    # 2. Métricas de Comunicação Direct-to-Earth (DTE)
    pct_comunicacao_real = float(np.mean(terra_visivel) * 100.0)
    latencia_media_seg = float(np.mean(dist_earth) * 2.0 / 299792.458) if len(dist_earth) > 0 else 2.56

    # 3. Engenharia de Energia: Painel Horizontal (sin) vs. Painel Vertical/Rastreador (cos)
    rad_sun = np.radians(np.clip(alt_sun, 0.0, 90.0))
    potencia_horiz = np.where(sol_visivel, np.sin(rad_sun) * 100.0, 0.0)
    potencia_vert = np.where(sol_visivel, np.cos(rad_sun) * 100.0, 0.0)

    media_horiz_pct = float(np.mean(potencia_horiz))
    media_vert_pct = float(np.mean(potencia_vert))

    # 4. Contagens Regressivas (Sunset/Sunrise e Earthset/Earthrise) e Janelas Operacionais
    evento_sol = _analisar_proximo_evento(sol_visivel, passo_horas, "Sol")
    evento_terra = _analisar_proximo_evento(terra_visivel, passo_horas, "Terra")

    maior_janela_sol_h = _calcular_maior_janela_continua(sol_visivel, passo_horas)
    maior_janela_noite_h = _calcular_maior_janela_continua(~sol_visivel, passo_horas)

    elevacao_max_sol = float(np.max(alt_sun))
    elevacao_min_sol = float(np.min(alt_sun))

    # 5. Veredito de Viabilidade da Missão
    if pct_luz_real >= 70.0 and pct_comunicacao_real >= 50.0:
        veredito = "VIÁVEL (ÓTIMO)"
    elif pct_luz_real >= 35.0 and pct_comunicacao_real >= 20.0:
        veredito = "CONDICIONAL / CRÍTICO"
    elif pct_luz_real >= 35.0 and pct_comunicacao_real < 20.0:
        veredito = "REQUER SATÉLITE RELAY"
    else:
        veredito = "INVIÁVEL (SOMBRA EXTREMA)"

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
            f"Considerando o relevo local, o Sol ilumina o ponto de pouso durante {pct_luz_real:.1f}% da janela "
            f"(as montanhas e crateras ao redor bloqueiam {perda_sombra_terreno_pct:.1f}% da luz teórica). "
            f"A maior noite contínua dura {maior_janela_noite_h} horas seguidas. "
            f"Como o Sol atinge no máximo {elevacao_max_sol:.1f}° de altura, painéis solares verticais "
            f"entregam {media_vert_pct:.1f}% de eficiência média, contra {media_horiz_pct:.1f}% de painéis planos no chão."
        )
    }