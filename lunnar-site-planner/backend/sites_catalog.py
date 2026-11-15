# backend/sites_catalog.py
from pydantic import BaseModel, Field


class LunarSite(BaseModel):
    id: str = Field(..., description="Unique landing site identifier")
    name: str = Field(..., description="Official lunar site name")
    region: str = Field(..., description="Selenographic region")
    lat: float = Field(..., ge=-90.0, le=90.0, description="Selenographic latitude in degrees")
    lon: float = Field(..., ge=-180.0, le=180.0, description="Selenographic longitude in degrees")
    elevation_m: float = Field(..., description="Mean elevation relative to LOLA datum (m)")
    mission_context: str = Field(..., description="Associated NASA mission or program")
    scientific_highlight: str = Field(..., description="Scientific, illumination, and communications significance")
    expected_sunlight_pct: float = Field(..., description="Estimated mean annual solar illumination (%)")
    earth_visibility_note: str = Field(..., description="Direct-to-Earth (Line-of-Sight) visibility condition")


CURATED_LUNAR_SITES: list[LunarSite] = [
    LunarSite(
        id="shackleton_rim",
        name="Shackleton Crater Rim (Peak of Eternal Light)",
        region="Lunar South Pole",
        lat=-89.90,
        lon=0.00,
        elevation_m=1500.0,
        mission_context="Artemis III — Candidate Landing Region",
        scientific_highlight="Elevated crater rim with near-continuous solar illumination (~85–90%) adjacent to water-ice-bearing PSRs inside the crater.",
        expected_sunlight_pct=86.5,
        earth_visibility_note="Intermittent Earth visibility driven by lunar libration (~50% of the synodic cycle).",
    ),
    LunarSite(
        id="connecting_ridge",
        name="Connecting Ridge (Shackleton–de Gerlache)",
        region="Lunar South Pole",
        lat=-89.45,
        lon=-137.50,
        elevation_m=1850.0,
        mission_context="Artemis III — High-Priority Solar Power Zone",
        scientific_highlight="Topographic ridge linking Shackleton and de Gerlache craters; one of the most persistently sunlit locations on the Moon.",
        expected_sunlight_pct=89.0,
        earth_visibility_note="Strong direct line-of-sight for Earth–Moon communications over extended windows.",
    ),
    LunarSite(
        id="malapert_massif",
        name="Malapert Massif",
        region="Lunar South Pole (86°S)",
        lat=-86.04,
        lon=-2.70,
        elevation_m=4700.0,
        mission_context="Artemis III / Lunar Communications Relay Station",
        scientific_highlight="Mountain massif rising nearly 5 km above the LOLA datum, ideal for lunar relay towers and solar power arrays.",
        expected_sunlight_pct=78.0,
        earth_visibility_note="Near-permanent direct Earth visibility due to high altitude and 86°S latitude.",
    ),
    LunarSite(
        id="cabeus_crater",
        name="Cabeus Crater (Floor / PSR)",
        region="Lunar South Pole (85°S)",
        lat=-84.90,
        lon=-35.50,
        elevation_m=-2100.0,
        mission_context="NASA LCROSS Impact Site (2009)",
        scientific_highlight="Permanently Shadowed Region (PSR) where the LCROSS mission confirmed significant deposits of water ice and volatiles.",
        expected_sunlight_pct=0.0,
        earth_visibility_note="Permanent shadow; requires an orbital relay satellite for communications.",
    ),
    LunarSite(
        id="im1_nova_c",
        name="Malapert A (IM-1 Odysseus / Nova-C Landing)",
        region="Lunar South Pole (80°S)",
        lat=-80.13,
        lon=1.44,
        elevation_m=-650.0,
        mission_context="NASA CLPS / Intuitive Machines IM-1 (2024)",
        scientific_highlight="First commercial and Artemis-era touchdown near the lunar south pole, validating precision landing under low-angle solar illumination.",
        expected_sunlight_pct=52.0,
        earth_visibility_note="Continuous direct line-of-sight to Earth ground stations at 80°S latitude.",
    ),
    LunarSite(
        id="nobile_rim",
        name="Nobile Crater Rim",
        region="Lunar South Pole (85°S)",
        lat=-85.20,
        lon=53.50,
        elevation_m=1200.0,
        mission_context="NASA VIPER / Artemis Candidate Region",
        scientific_highlight="Nobile crater rim featuring rover-traversable slopes with access to neighboring shadowed zones for hydrogen prospecting.",
        expected_sunlight_pct=71.0,
        earth_visibility_note="Stable Direct-to-Earth communications across most of the synodic month.",
    ),
    LunarSite(
        id="apollo_11",
        name="Mare Tranquillitatis (Tranquility Base)",
        region="Lunar Equatorial (Historical Baseline)",
        lat=0.6741,
        lon=23.4730,
        elevation_m=-1850.0,
        mission_context="NASA Apollo 11 (1969)",
        scientific_highlight="Equatorial baseline for comparison: rigid ~14-Earth-day sunlit period followed by ~14 Earth days of lunar night.",
        expected_sunlight_pct=50.0,
        earth_visibility_note="Earth remains fixed near local zenith 100% of the time (lunar nearside).",
    ),
]

SITES_CATALOG: list[dict] = [site.model_dump() for site in CURATED_LUNAR_SITES]


def get_site_by_id(site_id: str) -> dict | None:
    """Retrieves a curated lunar landing site by its identifier."""
    for site in SITES_CATALOG:
        if site["id"] == site_id:
            return site
    return None