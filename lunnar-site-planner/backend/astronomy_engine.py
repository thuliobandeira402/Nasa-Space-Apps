from datetime import UTC, datetime, timedelta

import numpy as np
from skyfield import almanac
from skyfield.api import load

# Carrega efemérides oficiais da NASA JPL (baixa automaticamente na 1ª execução)
ts = load.timescale()
eph = load("de421.bsp")

SUN = eph["sun"]
EARTH = eph["earth"]
MOON = eph["moon"]

# Raio angular médio do Sol visto da Lua (em graus)
SOLAR_SEMIDIAMETER_DEG = 0.265


def _lunar_topocentric_alt_az(
    t, lat_deg: float, lon_deg: float, target_body
) -> tuple[float, float]:
    """Calcula elevação e azimute aparentes do Sol ou da Terra vistos de um ponto na Lua."""
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    moon_radius_km = 1737.4

    # Libração lunar (latitude e longitude sub-terrestre na Lua)
    sub_earth_lat_ang, sub_earth_lon_ang, _ = almanac.libration(eph, t)
    sub_earth_lat = sub_earth_lat_ang.radians
    sub_earth_lon = sub_earth_lon_ang.radians

    obs_vec = np.array([
        np.cos(lat) * np.cos(lon),
        np.cos(lat) * np.sin(lon),
        np.sin(lat),
    ])

    moon_pos = MOON.at(t).position.km
    target_pos = target_body.at(t).position.km
    rel_vec = target_pos - (moon_pos + obs_vec * moon_radius_km)

    earth_dir_seleno = np.array([
        np.cos(sub_earth_lat) * np.cos(sub_earth_lon),
        np.cos(sub_earth_lat) * np.sin(sub_earth_lon),
        np.sin(sub_earth_lat),
    ])

    if target_body == EARTH:
        target_dir_seleno = earth_dir_seleno
    else:
        earth_vec_icrf = EARTH.at(t).position.km - moon_pos
        earth_unit_icrf = earth_vec_icrf / np.linalg.norm(earth_vec_icrf)
        sun_unit_icrf = rel_vec / np.linalg.norm(rel_vec)

        cos_elong = np.clip(np.dot(earth_unit_icrf, sun_unit_icrf), -1.0, 1.0)
        phase_angle = np.arccos(cos_elong)
        cross_z = np.cross(earth_unit_icrf, sun_unit_icrf)[2]
        sun_lon = sub_earth_lon + (phase_angle if cross_z >= 0 else -phase_angle)
        sun_lat = np.arcsin(np.clip(sun_unit_icrf[2], -1.0, 1.0))

        target_dir_seleno = np.array([
            np.cos(sun_lat) * np.cos(sun_lon),
            np.cos(sun_lat) * np.sin(sun_lon),
            np.sin(sun_lat),
        ])

    zenith = obs_vec
    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.cross(zenith, east)

    z_comp = np.dot(target_dir_seleno, zenith)
    e_comp = np.dot(target_dir_seleno, east)
    n_comp = np.dot(target_dir_seleno, north)

    elevation_deg = float(np.degrees(np.arcsin(np.clip(z_comp, -1.0, 1.0))))
    azimuth_deg = float((np.degrees(np.arctan2(e_comp, n_comp)) + 360.0) % 360.0)

    return round(elevation_deg, 3), round(azimuth_deg, 3)


def simulate_site_window(
    lat: float,
    lon: float,
    start_iso: str,
    duration_hours: int = 168,
    step_hours: float = 1.0,
    horizon_profile_360: list[float] | None = None,
) -> dict:
    """Simula iluminação solar, duração do pôr do sol e visibilidade direta da Terra."""
    if horizon_profile_360 is None or len(horizon_profile_360) != 360:
        horizon_profile_360 = [0.0] * 360

    start_dt = datetime.fromisoformat(start_iso)
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=UTC)

    steps = int(duration_hours / step_hours)
    timeline = []
    sun_visible_steps = 0
    earth_visible_steps = 0
    sunset_durations_min = []
    in_sunset_start = None

    for i in range(steps + 1):
        current_dt = start_dt + timedelta(hours=i * step_hours)
        t = ts.from_datetime(current_dt)

        sun_el, sun_az = _lunar_topocentric_alt_az(t, lat, lon, SUN)
        earth_el, earth_az = _lunar_topocentric_alt_az(t, lat, lon, EARTH)

        local_horizon_sun = horizon_profile_360[int(sun_az) % 360]
        local_horizon_earth = horizon_profile_360[int(earth_az) % 360]

        sun_above_terrain = sun_el - local_horizon_sun
        earth_visible = bool(earth_el > local_horizon_earth)
        sun_visible = bool(sun_above_terrain > -SOLAR_SEMIDIAMETER_DEG)

        if sun_visible:
            sun_visible_steps += 1
        if earth_visible:
            earth_visible_steps += 1

        if -SOLAR_SEMIDIAMETER_DEG <= sun_above_terrain <= SOLAR_SEMIDIAMETER_DEG:
            if in_sunset_start is None:
                in_sunset_start = current_dt
        elif in_sunset_start is not None:
            elapsed_min = (current_dt - in_sunset_start).total_seconds() / 60.0
            sunset_durations_min.append(round(elapsed_min, 1))
            in_sunset_start = None

        phase_fraction = float(almanac.fraction_illuminated(eph, "moon", t))

        timeline.append({
            "timestamp": current_dt.isoformat(),
            "sun_elevation_deg": sun_el,
            "sun_azimuth_deg": sun_az,
            "sun_visible": sun_visible,
            "earth_elevation_deg": earth_el,
            "earth_azimuth_deg": earth_az,
            "earth_visible": earth_visible,
            "moon_illumination_pct": round(phase_fraction * 100, 1),
        })

    total_points = len(timeline)
    sun_pct = round((sun_visible_steps / total_points) * 100, 1)
    earth_pct = round((earth_visible_steps / total_points) * 100, 1)

    return {
        "summary": {
            "sunlight_coverage_pct": sun_pct,
            "earth_comms_coverage_pct": earth_pct,
            "avg_sunset_duration_minutes": (
                round(float(np.mean(sunset_durations_min)), 1)
                if sunset_durations_min
                else None
            ),
            "status": "GO" if (sun_pct >= 50.0 and earth_pct >= 50.0) else "NO-GO",
        },
        "timeline": timeline,
    }