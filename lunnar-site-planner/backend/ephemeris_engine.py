# backend/ephemeris_engine.py
from datetime import UTC, datetime, timedelta

from data_loader import get_planetary_context  # type: ignore[import-not-found]
from skyfield import almanac
from skyfield.toposlib import Geoid

# Raio médio da Lua em metros (referência IAU / LOLA) e raio angular do Sol
MOON_MEAN_RADIUS_M = 1_737_400.0
SOLAR_SEMIDIAMETER_DEG = 0.265
MOON_GEOID = Geoid("MOON", radius_m=MOON_MEAN_RADIUS_M, inverse_flattening=1e16)


def _build_lunar_observer(moon, moon_frame, lat: float, lon: float, elevacao_m: float):
    """Cria o ponto topográfico na superfície da Lua usando o frame MOON_ME_DE421."""
    surface_point = MOON_GEOID.latlon(lat, lon, elevation_m=elevacao_m)
    surface_point.frame = moon_frame
    surface_point.center = 301
    return moon + surface_point

def calcular_visibilidade(
    lat: float,
    lon: float,
    elevacao_m: float = 0.0,
    ano: int = 2026,
    mes: int = 11,
    dia: int = 15,
    dias_simulacao: int = 30,
    passo_horas: int = 1,
) -> list[dict]:
    """
    Calcula a série temporal de elevação/azimute do Sol e da Terra vistos de um
    ponto na superfície lunar, usando os kernels SPICE carregados pelo data_loader.
    """
    ctx = get_planetary_context()
    ts = ctx["ts"]
    eph = ctx["eph"]
    moon = ctx["moon"]
    earth = ctx["earth"]
    sun = ctx["sun"]
    moon_frame = ctx["moon_frame"]

    observer = _build_lunar_observer(moon, moon_frame, lat, lon, elevacao_m)

    start_dt = datetime(ano, mes, dia, 0, 0, 0, tzinfo=UTC)
    total_hours = dias_simulacao * 24
    steps = range(0, total_hours + 1, passo_horas)

    datetimes = [start_dt + timedelta(hours=h) for h in steps]
    t_array = ts.from_datetimes(datetimes)

    # Cálculo vetorizado (muito mais rápido que loop ponto a ponto no Skyfield)
    sun_app = observer.at(t_array).observe(sun).apparent()
    sun_alt, sun_az, _ = sun_app.altaz()

    earth_app = observer.at(t_array).observe(earth).apparent()
    earth_alt, earth_az, earth_dist = earth_app.altaz()
    moon_illumination = almanac.fraction_illuminated(eph, "moon", t_array)

    series_temporais = []
    for i, dt in enumerate(datetimes):
        s_el = round(float(sun_alt.degrees[i]), 3)
        s_az = round(float(sun_az.degrees[i]), 3)
        e_el = round(float(earth_alt.degrees[i]), 3)
        e_az = round(float(earth_az.degrees[i]), 3)
        e_dist_km = round(float(earth_dist.km[i]), 1)
        illum_pct = round(float(moon_illumination[i]) * 100.0, 1)

        # Sol visível se o disco superior estiver acima do horizonte (0° - 0.265°)
        sol_visivel = bool(s_el > -SOLAR_SEMIDIAMETER_DEG)
        # Terra visível se estiver acima do horizonte local (0°)
        terra_visivel = bool(e_el > 0.0)

        series_temporais.append({
            "timestamp": dt.isoformat(),
            "hora_indice": i * passo_horas,
            "sun_elevation_deg": s_el,
            "sun_azimuth_deg": s_az,
            "sun_visible": sol_visivel,
            "earth_elevation_deg": e_el,
            "earth_azimuth_deg": e_az,
            "earth_visible": terra_visivel,
            "earth_distance_km": e_dist_km,
            "moon_illumination_pct": illum_pct,
        })

    return series_temporais