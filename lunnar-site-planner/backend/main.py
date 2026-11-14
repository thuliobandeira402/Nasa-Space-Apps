from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Importando os seus próprios módulos (que ficarão na mesma pasta backend/)
from sites_catalog import SITES_CATALOG
from ephemeris_engine import calcular_visibilidade
from metrics_analyzer import analisar_metricas

# 1. Inicializa a aplicação FastAPI
app = FastAPI(
    title="NASA Lunar Landing Site Planner API",
    description="Motor de cálculo de efemérides e visibilidade lunar",
    version="1.0.0"
)

# 2. Libera o CORS (Evita erro de bloqueio no navegador durante testes)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. Contratos de Entrada (Pydantic Models)
class SimulacaoRequest(BaseModel):
    nome_local: str = Field(default="Ponto Customizado")
    lat: float = Field(..., ge=-90.0, le=90.0, description="Latitude lunar (-90 a 90)")
    lon: float = Field(..., ge=-180.0, le=180.0, description="Longitude lunar (-180 a 180)")
    elevacao_m: float = Field(default=0.0, description="Altitude do terreno em metros")
    ano: int = Field(default=2026)
    mes: int = Field(default=11)
    dia: int = Field(default=15)
    dias_simulacao: int = Field(default=30, ge=1, le=90)

class ComparacaoRequest(BaseModel):
    cenario_a: SimulacaoRequest
    cenario_b: SimulacaoRequest

# 4. Rota GET: Lista os locais famosos (Shackleton, Apollo 11, etc.)
@app.get("/api/sites")
def listar_locais_predefinidos():
    return {"sites": SITES_CATALOG}

# 5. Rota POST: Simula 1 único local de pouso
@app.post("/api/simulate")
def simular_local(req: SimulacaoRequest):
    try:
        # Passo A: Chama o Skyfield para pegar os ângulos do Sol e da Terra
        dados_brutos = calcular_visibilidade(
            lat=req.lat,
            lon=req.lon,
            elevacao_m=req.elevacao_m,
            ano=req.ano,
            mes=req.mes,
            dia=req.dia,
            dias_simulacao=req.dias_simulacao
        )
        
        # Passo B: Calcula KPIs (tempo até o pôr do sol, % de luz, viabilidade)
        metricas = analisar_metricas(dados_brutos)
        
        # Passo C: Retorna um dicionário Python (o FastAPI converte para JSON sozinho)
        return {
            "local": req.nome_local,
            "coordenadas": {"lat": req.lat, "lon": req.lon, "elevacao_m": req.elevacao_m},
            "metricas_resumo": metricas,
            "series_temporais": dados_brutos
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 6. Rota POST: Compara 2 cenários lado a lado (Locais diferentes ou Datas diferentes)
@app.post("/api/compare")
def comparar_cenarios(req: ComparacaoRequest):
    resultado_a = simular_local(req.cenario_a)
    resultado_b = simular_local(req.cenario_b)
    return {
        "cenario_a": resultado_a,
        "cenario_b": resultado_b
    }

# 7. Serve o Frontend (HTML/CSS/JS) na rota raiz "/"
# IMPORTANTE: Esta linha deve ficar SEMPRE no final do arquivo!
app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")