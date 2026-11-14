# backend/main.py
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from sites_catalog import SITES_CATALOG
from ephemeris_engine import calcular_visibilidade
from terrain_engine import gerar_perfil_horizonte_360, aplicar_obstrucao_terreno
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


# 3. Contratos de Entrada (Pydantic Models)
class SimulacaoRequest(BaseModel):
    nome_local: str = Field(default="Ponto Customizado")
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
        # Passo A: Efemérides via Skyfield + normalização para vetores
        lista_efemerides = calcular_visibilidade(
            lat=req.lat,
            lon=req.lon,
            elevacao_m=req.elevacao_m,
            ano=req.ano,
            mes=req.mes,
            dia=req.dia,
            dias_simulacao=req.dias_simulacao,
            passo_horas=passo_efetivo
        )
        dados_vetorizados = _normalizar_efemerides(lista_efemerides, passo_efetivo)

        # Passo B: Gera horizonte topográfico 360° e aplica obstrução das crateras/montanhas
        perfil_horizonte = gerar_perfil_horizonte_360(req.lat, req.lon, req.elevacao_m)
        if req.usar_topografia:
            dados_processados = aplicar_obstrucao_terreno(dados_vetorizados, perfil_horizonte)
        else:
            dados_processados = dados_vetorizados

        # Passo C: Calcula KPIs executivos e engenharia de potência
        metricas = analisar_metricas(dados_processados)

        return {
            "local": req.nome_local,
            "coordenadas": {
                "lat": req.lat,
                "lon": req.lon,
                "elevacao_m": req.elevacao_m
            },
            "configuracao": {
                "data_inicio": f"{req.ano:04d}-{req.mes:02d}-{req.dia:02d}",
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
@app.post("/api/simulate")
def simular_local(req: SimulacaoRequest):
    passo_efetivo = 3 if (req.dias_simulacao > 30 and req.passo_horas == 1) else req.passo_horas
    try:
        # Resolve nome caso o payload envie "nome" em vez de "nome_local"
        nome_final = req.nome.strip() if (req.nome and req.nome.strip()) else req.nome_local

        # Resolve data caso o payload envie "data_inicio": "YYYY-MM-DD"
        ano, mes, dia = req.ano, req.mes, req.dia
        if req.data_inicio:
            partes = req.data_inicio.strip().split("-")
            if len(partes) == 3:
                ano, mes, dia = int(partes[0]), int(partes[1]), int(partes[2])

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


# 7. Serve o Frontend (HTML/CSS/JS) na rota raiz "/" com caminho absoluto seguro
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")