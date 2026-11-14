# backend/main.py
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from data_loader import get_sites_catalog
from sites_catalog import SITES_CATALOG, get_site_by_id
from ephemeris_engine import calcular_visibilidade
from terrain_engine import gerar_perfil_horizonte_360, aplicar_obstrucao_terreno, identificar_site_conhecido
from metrics_analyzer import analisar_metricas

# 1. Inicializa a aplicação FastAPI
app = FastAPI(
    title="NASA Lunar Landing Site Planner API",
    description="Motor de cálculo de efemérides, topografia 360° e visibilidade lunar",
    version="1.0.0"
)

# 2. Libera o CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

NOME_PADRAO = "Ponto Customizado"

# 3. Contratos de Entrada (Pydantic Models)
class SimulacaoRequest(BaseModel):
    nome_local: str = Field(default=NOME_PADRAO)
    nome: str | None = Field(default=None)
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    elevacao_m: float = Field(default=0.0, ge=-10000.0, le=15000.0)
    ano: int = Field(default=2026, ge=1900, le=2050)
    mes: int = Field(default=11, ge=1, le=12)
    dia: int = Field(default=15, ge=1, le=31)
    data_inicio: str | None = Field(default=None, description="Opcional YYYY-MM-DD")
    dias_simulacao: int = Field(default=30, ge=1, le=90)
    passo_horas: int = Field(default=1, ge=1, le=24)
    usar_topografia: bool = Field(default=True)


class ComparacaoRequest(BaseModel):
    cenario_a: SimulacaoRequest | None = None
    cenario_b: SimulacaoRequest | None = None
    cenarios: list[SimulacaoRequest] | None = None


def _normalizar_efemerides(dados_brutos: list | dict, passo_horas: int) -> dict:
    """
    Adapta a saída list[dict] do ephemeris_engine.py para o dicionário de listas
    esperado pelo terrain_engine.py e metrics_analyzer.py.
    """
    if isinstance(dados_brutos, dict):
        dados_brutos.setdefault("passo_horas", passo_horas)
        return dados_brutos

    if not dados_brutos:
        raise ValueError("calcular_visibilidade retornou uma lista vazia.")

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


# 4. Rota GET: Lista os locais famosos (Shackleton, Apollo 11, etc.)
@app.get("/api/sites")
def listar_locais_predefinidos():
    return {"sites": SITES_CATALOG}


# 5. Rota POST: Simula 1 único local de pouso (Efemérides + Terreno 360° + KPIs)
@app.post("/api/simulate")
def simular_local(req: SimulacaoRequest):
    passo_efetivo = 3 if (req.dias_simulacao > 30 and req.passo_horas == 1) else req.passo_horas
    try:
        # Resolve nome caso o payload envie "nome" em vez de "nome_local"
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

        # Resolve data caso o payload envie "data_inicio": "YYYY-MM-DD"
        ano, mes, dia = req.ano, req.mes, req.dia
        if req.data_inicio:
            partes = req.data_inicio.strip().split("-")
            if len(partes) != 3:
                raise ValueError("data_inicio deve estar no formato YYYY-MM-DD")
            ano, mes, dia = int(partes[0]), int(partes[1]), int(partes[2])
            if not (1900 <= ano <= 2050):
                raise ValueError("ano deve estar entre 1900 e 2050 (limite dos kernels SPICE)")

        # Passo A: Efemérides via Skyfield + normalização para vetores
        lista_efemerides = calcular_visibilidade(
            lat=req.lat,
            lon=req.lon,
            elevacao_m=req.elevacao_m,
            ano=ano,
            mes=mes,
            dia=dia,
            dias_simulacao=req.dias_simulacao,
            passo_horas=passo_efetivo
        )
        dados_vetorizados = _normalizar_efemerides(lista_efemerides, passo_efetivo)

        # Passo B: Gera horizonte 360° (com relevo real/sintético OU plano 0° se desativado)
        if req.usar_topografia:
            perfil_horizonte = gerar_perfil_horizonte_360(req.lat, req.lon, req.elevacao_m)
        else:
            perfil_horizonte = {
                "modo_terreno": "Esfera Lunar Ideal (Sem Obstrução Topográfica)",
                "site_id_detectado": None,
                "azimutes_graus": list(range(360)),
                "elevacao_horizonte_graus": [0.0] * 360,
                "obstaculos_principais": []
            }

        # Sempre roda aplicar_obstrucao_terreno para manter todas as 6 chaves de series_temporais no JSON
        dados_processados = aplicar_obstrucao_terreno(dados_vetorizados, perfil_horizonte)

        # Passo C: Calcula KPIs executivos e engenharia de potência
        metricas = analisar_metricas(dados_processados)

        return {
            "local": nome_final,
            "coordenadas": {
                "lat": req.lat,
                "lon": req.lon,
                "elevacao_m": req.elevacao_m
            },
            "configuracao": {
                "data_inicio": f"{ano:04d}-{mes:02d}-{dia:02d}",
                "dias_simulacao": req.dias_simulacao,
                "passo_horas": passo_efetivo,
                "topografia_ativa": req.usar_topografia
            },
            "metricas_resumo": metricas,
            "perfil_horizonte_360": perfil_horizonte,
            "series_temporais": dados_processados
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=f"Parâmetro inválido: {str(ve)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 6. Rota POST: Compara cenários lado a lado (suporta cenario_a/cenario_b OU lista cenarios)
@app.post("/api/compare")
def comparar_cenarios(req: ComparacaoRequest):
    if req.cenarios:
        return {
            "total_cenarios": len(req.cenarios),
            "resultados": [simular_local(c) for c in req.cenarios]
        }
    if req.cenario_a and req.cenario_b:
        res_a = simular_local(req.cenario_a)
        res_b = simular_local(req.cenario_b)
        return {
            "cenario_a": res_a,
            "cenario_b": res_b,
            "resultados": [res_a, res_b]
        }
    raise HTTPException(
        status_code=422,
        detail="Informe 'cenario_a' e 'cenario_b' ou uma lista em 'cenarios'."
    )

# 6b. Adaptador para o frontend (contrato do frontend/js/api.js)
class PousoRequest(BaseModel):
    site_id: str | None = None
    site_name: str | None = None
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-360.0, le=360.0)
    start_date: str = Field(default="2027-03-01")
    days: int = Field(default=30, ge=1, le=90)
    step_min: int = Field(default=60, ge=5, le=360)


def _normalizar_lon(lon: float) -> float:
    return ((lon + 180.0) % 360.0) - 180.0


def _declividade_conhecida(site_id: str | None) -> float | None:
    if not site_id:
        return None
    alias = {"im1_nova_c": "im1_malapert_a"}  # ids diferentes entre catálogo e JSON
    alvo = alias.get(site_id, site_id)
    for item in get_sites_catalog():
        if item.get("id") == alvo:
            return item.get("declividade_graus")
    return None


@app.post("/simular-pouso")
def simular_pouso(req: PousoRequest):
    lon = _normalizar_lon(req.lon)
    site_id = identificar_site_conhecido(req.lat, lon)
    site = get_site_by_id(site_id) if site_id else None
    nome = (req.site_name or "").strip() or (site["name"] if site else NOME_PADRAO)

    passo_horas = max(1, min(24, round(req.step_min / 60)))
    res = simular_local(SimulacaoRequest(
        nome=nome,
        lat=req.lat,
        lon=lon,
        elevacao_m=site["elevation_m"] if site else 0.0,
        data_inicio=req.start_date,
        dias_simulacao=req.days,
        passo_horas=passo_horas,
        usar_topografia=True,
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
    slope = _declividade_conhecida(site_id)
    seguranca = None if slope is None else slope <= 15.0
    iluminacao = sun_pct >= 50.0
    comunicacao = earth_pct >= 50.0
    go = iluminacao and comunicacao and seguranca is not False

    return {
        "site_id": site_id,
        "site_name": nome,
        "lat": req.lat,
        "lon": req.lon,
        "start_date": res["configuracao"]["data_inicio"],
        "days": req.days,
        "step_min": passo_h * 60,
        "slope_deg": slope,                 # None = sem dado
        "sunset_duration_min": None,        # ainda não calculado pelo backend
        "sun_fraction_pct": sun_pct,
        "earth_fraction_pct": earth_pct,
        "max_continuous_night_hours": m["maior_noite_continua_horas"],
        "horizon_profile": horizon_profile,
        "criterios": {
            "seguranca_topografica": seguranca,
            "iluminacao_solar": iluminacao,
            "comunicacao_direta": comunicacao,
        },
        "go_nogo": "GO" if go else "NO-GO",
        "veredito_backend": m["veredito"],
        "assumptions": [
            f"Efemérides lunares e orientação da Lua: NASA/JPL SPICE (DE421), passo de {passo_h} h.",
            f"Horizonte 360°: {perfil['modo_terreno']}.",
            "Disco solar com semidiâmetro de 0,265°, sem refração atmosférica.",
            "Critério GO: iluminação ≥ 50%, visada da Terra ≥ 50% e declividade ≤ 15° (quando houver dado).",
            m["contexto_educacional"],
        ],
        "timeline": timeline,
    }


# 7. Serve o Frontend (HTML/CSS/JS) na rota raiz "/" com caminho absoluto seguro
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")