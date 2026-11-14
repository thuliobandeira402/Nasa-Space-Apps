# backend/sites_catalog.py
from pydantic import BaseModel, Field


class LunarSite(BaseModel):
    id: str = Field(..., description="Identificador único do local")
    name: str = Field(..., description="Nome oficial do local lunar")
    region: str = Field(..., description="Região selenográfica")
    lat: float = Field(..., ge=-90.0, le=90.0, description="Latitude selenográfica em graus")
    lon: float = Field(..., ge=-180.0, le=180.0, description="Longitude selenográfica em graus")
    elevation_m: float = Field(..., description="Elevação média relativa ao datum LOLA (m)")
    mission_context: str = Field(..., description="Missão ou programa NASA associado")
    scientific_highlight: str = Field(..., description="Relevância científica e de iluminação/comunicação")
    expected_sunlight_pct: float = Field(..., description="Estimativa média de iluminação solar anual (%)")
    earth_visibility_note: str = Field(..., description="Condição de visada direta (Line-of-Sight) com a Terra")


CURATED_LUNAR_SITES: list[LunarSite] = [
    LunarSite(
        id="shackleton_rim",
        name="Shackleton Crater Rim (Peak of Eternal Light)",
        region="Polo Sul Lunar",
        lat=-89.90,
        lon=0.00,
        elevation_m=1500.0,
        mission_context="Artemis III — Região Candidata de Pouso",
        scientific_highlight="Borda elevada com quase iluminação solar contínua (~85-90%) adjacente a PSRs ricos em gelo de água no interior da cratera.",
        expected_sunlight_pct=86.5,
        earth_visibility_note="Visibilidade intermitente da Terra conforme a libração lunar (~50% do ciclo).",
    ),
    LunarSite(
        id="connecting_ridge",
        name="Connecting Ridge (Shackleton–de Gerlache)",
        region="Polo Sul Lunar",
        lat=-89.45,
        lon=-137.50,
        elevation_m=1850.0,
        mission_context="Artemis III — Zona Prioritária de Energia Solar",
        scientific_highlight="Crista topográfica que conecta as crateras Shackleton e de Gerlache; um dos pontos mais iluminados de toda a Lua.",
        expected_sunlight_pct=89.0,
        earth_visibility_note="Excelente linha de visada direta para comunicações Terra-Lua durante longos períodos.",
    ),
    LunarSite(
        id="malapert_massif",
        name="Malapert Massif",
        region="Polo Sul Lunar (86°S)",
        lat=-86.04,
        lon=-2.70,
        elevation_m=4700.0,
        mission_context="Artemis III / Estação de Retransmissão Lunar",
        scientific_highlight="Maciço montanhoso de quase 5 km de altitude acima do datum LOLA, ideal para torres de relé de comunicação e painéis solares.",
        expected_sunlight_pct=78.0,
        earth_visibility_note="Visada quase permanente da Terra devido à altitude elevada e latitude de 86°S.",
    ),
    LunarSite(
        id="cabeus_crater",
        name="Cabeus Crater (Floor / PSR)",
        region="Polo Sul Lunar (85°S)",
        lat=-84.90,
        lon=-35.50,
        elevation_m=-2100.0,
        mission_context="NASA LCROSS Impact Site (2009)",
        scientific_highlight="Região Permanentemente Sombreada (PSR) onde a sonda LCROSS confirmou depósitos significativos de gelo de água e voláteis.",
        expected_sunlight_pct=0.0,
        earth_visibility_note="Sombra permanente; exige satélite de retransmissão orbital para comunicação direta.",
    ),
    LunarSite(
        id="im1_nova_c",
        name="Malapert A (Pouso IM-1 Odysseus / Nova-C)",
        region="Polo Sul Lunar (80°S)",
        lat=-80.13,
        lon=1.44,
        elevation_m=-650.0,
        mission_context="NASA CLPS / Intuitive Machines IM-1 (2024)",
        scientific_highlight="Primeiro pouso comercial e da era Artemis próximo ao Polo Sul lunar, validando navegação em terreno acidentado de baixa elevação solar.",
        expected_sunlight_pct=52.0,
        earth_visibility_note="Visada direta constante com estações terrestres na faixa de 80°S.",
    ),
    LunarSite(
        id="nobile_rim",
        name="Nobile Crater Rim",
        region="Polo Sul Lunar (85°S)",
        lat=-85.20,
        lon=53.50,
        elevation_m=1200.0,
        mission_context="NASA VIPER / Artemis Candidate Region",
        scientific_highlight="Borda da cratera Nobile com terreno acessível para rovers explorarem áreas sombreadas vizinhas em busca de hidrogênio.",
        expected_sunlight_pct=71.0,
        earth_visibility_note="Comunicação direta estável com a Terra na maior parte do mês sinódico.",
    ),
    LunarSite(
        id="apollo_11",
        name="Mare Tranquillitatis (Tranquility Base)",
        region="Equatorial Lunar (Referência Histórica)",
        lat=0.6741,
        lon=23.4730,
        elevation_m=-1850.0,
        mission_context="NASA Apollo 11 (1969)",
        scientific_highlight="Ponto de referência equatorial para comparação: ciclo rígido de ~14 dias terrestres de luz seguidos de ~14 dias de noite lunar.",
        expected_sunlight_pct=50.0,
        earth_visibility_note="Terra fixa próxima ao zênite local 100% do tempo (face visível).",
    ),
]

# Exporta como lista de dicts pronto para serialização JSON direta no FastAPI
SITES_CATALOG: list[dict] = [site.model_dump() for site in CURATED_LUNAR_SITES]


def get_site_by_id(site_id: str) -> dict | None:
    """Busca um local curado pelo seu identificador."""
    for site in SITES_CATALOG:
        if site["id"] == site_id:
            return site
    return None