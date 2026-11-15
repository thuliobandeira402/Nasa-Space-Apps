# backend/lola_horizon.py
import numpy as np
from scipy.ndimage import map_coordinates

R_LUA_M = 1_737_400.0  # raio de referência do datum LOLA


def latlon_para_xy_polar_sul(lat: float, lon: float) -> tuple[float, float]:
    """lat/lon (graus) -> X/Y (m) em estereográfica polar sul, escala verdadeira no polo."""
    rho = 2.0 * R_LUA_M * np.tan(np.pi / 4.0 + np.radians(lat) / 2.0)
    lam = np.radians(lon)
    return float(rho * np.sin(lam)), float(rho * np.cos(lam))


def horizonte_360_de_dem(z, col0_x, row0_y, pixel_m, x_site, y_site, lon_deg,
                         altura_obs_m=2.0, raio_m=40_000.0) -> list[float]:
    """Elevação máxima do terreno (graus) em cada azimute 0..359 (0 = Norte, 90 = Leste)."""

    def amostrar(x, y):
        rows = (row0_y - y) / pixel_m
        cols = (x - col0_x) / pixel_m
        return map_coordinates(z, [rows, cols], order=1, mode="constant", cval=np.nan)

    z0 = amostrar(np.array([x_site]), np.array([y_site]))[0]
    if np.isnan(z0):
        raise ValueError("Ponto fora da cobertura do DEM")

    dist = np.arange(pixel_m, raio_m + pixel_m, pixel_m)
    ang = np.radians(np.arange(360) + lon_deg)
    X = x_site + np.outer(np.sin(ang), dist)
    Y = y_site + np.outer(np.cos(ang), dist)
    Z = amostrar(X.ravel(), Y.ravel()).reshape(X.shape)

    queda_curvatura = dist ** 2 / (2.0 * R_LUA_M)
    elev = np.degrees(np.arctan2(Z - (z0 + altura_obs_m) - queda_curvatura, dist))
    elev = np.where(np.isnan(elev), -90.0, elev)
    h = elev.max(axis=1)
    h[h <= -89.9] = 0.0
    return np.round(h, 2).tolist()


def horizonte_lola(lat: float, lon: float, dem_path: str,
                   altura_obs_m: float = 2.0, raio_m: float = 40_000.0) -> list[float]:
    """Lê só uma janela do GeoTIFF ao redor do ponto (não carrega o arquivo inteiro)."""
    import rasterio
    from rasterio.windows import from_bounds

    x, y = latlon_para_xy_polar_sul(lat, lon)
    with rasterio.open(dem_path) as src:
        pixel_m = float(src.res[0])
        margem = raio_m + 2 * pixel_m
        win = from_bounds(x - margem, y - margem, x + margem, y + margem, transform=src.transform)
        win = win.round_offsets().round_lengths()
        z = src.read(1, window=win, boundless=True, fill_value=np.nan).astype("float64")
        if src.nodata is not None:
            z[z == src.nodata] = np.nan
        scale = float(src.scales[0]) if src.scales else 1.0
        offset = float(src.offsets[0]) if src.offsets else 0.0
        z = z * scale + offset
        t = src.window_transform(win)
    col0_x = t.c + 0.5 * t.a
    row0_y = t.f + 0.5 * t.e
    return horizonte_360_de_dem(z, col0_x, row0_y, pixel_m, x, y, lon, altura_obs_m, raio_m)


def extrair_malha_terreno_lola(
    lat: float,
    lon: float,
    dem_path: str,
    grid_size: int = 128,
    span_km: float = 36.0,
) -> dict:
    """
    Extrai uma malha regional de alta densidade (128x128 cobrindo 36 km x 36 km)
    orientada pelo Norte local (lon) diretamente do GeoTIFF LOLA.
    Captura crateras inteiras (como Shackleton, 21 km) e calcula a declividade
    real (slope_deg) ponto a ponto para renderização fiel no Three.js.
    """
    import rasterio
    from rasterio.windows import from_bounds

    x_site, y_site = latlon_para_xy_polar_sul(lat, lon)
    half_span_m = (span_km * 1000.0) / 2.0

    with rasterio.open(dem_path) as src:
        pixel_m = float(src.res[0])
        margem = half_span_m * 1.45 + 2 * pixel_m
        win = from_bounds(
            x_site - margem,
            y_site - margem,
            x_site + margem,
            y_site + margem,
            transform=src.transform,
        )
        win = win.round_offsets().round_lengths()
        z = src.read(1, window=win, boundless=True, fill_value=np.nan).astype("float64")
        if src.nodata is not None:
            z[z == src.nodata] = np.nan
        scale = float(src.scales[0]) if src.scales else 1.0
        offset = float(src.offsets[0]) if src.offsets else 0.0
        z = z * scale + offset
        t = src.window_transform(win)

    if np.all(np.isnan(z)):
        raise ValueError("Janela sem dados válidos no DEM LOLA.")

    media_z = float(np.nanmean(z))
    z = np.where(np.isnan(z), media_z, z)

    col0_x = t.c + 0.5 * t.a
    row0_y = t.f + 0.5 * t.e

    # Coordenadas locais alinhadas ao meridiano local (Norte = -Y da grade -> row=0, Leste = +X -> col=grid_size-1)
    lin = np.linspace(-half_span_m, half_span_m, grid_size)
    # No PlaneGeometry após rotation.x = -pi/2: row 0 fica em Z = -half (Norte) e col 0 fica em X = -half (Oeste)
    north_m, east_m = np.meshgrid(lin[::-1], lin, indexing="ij")

    # Rotaciona a grade pelo meridiano local (lon) para alinhar com os azimutes 0..359 de horizonte_360_de_dem
    lam = np.radians(lon)
    sin_l, cos_l = np.sin(lam), np.cos(lam)
    # Vetor Norte local em estereográfica polar sul = (sin(lon), cos(lon))
    # Vetor Leste local = (cos(lon), -sin(lon))
    X = x_site + north_m * sin_l + east_m * cos_l
    Y = y_site + north_m * cos_l - east_m * sin_l

    rows = (row0_y - Y) / pixel_m
    cols = (X - col0_x) / pixel_m
    z_grid = map_coordinates(z, [rows.ravel(), cols.ravel()], order=1, mode="nearest").reshape((grid_size, grid_size))

    step_grid_m = (2.0 * half_span_m) / max(1, grid_size - 1)
    dy, dx = np.gradient(z_grid, step_grid_m)
    slope_matrix = np.degrees(np.arctan(np.hypot(dx, dy)))

    c = grid_size // 2
    slope_deg = float(np.round(np.mean(slope_matrix[max(0, c - 1):c + 2, max(0, c - 1):c + 2]), 2))

    min_elev = float(np.min(z_grid))
    max_elev = float(np.max(z_grid))
    center_elev = float(0.25 * (z_grid[c - 1, c - 1] + z_grid[c - 1, c] + z_grid[c, c - 1] + z_grid[c, c]))
    span = max(1.0, max_elev - min_elev)

    # Alturas relativas ao centro (0,0) normalizadas pela largura física da malha (span_m)
    # Assim, no Three.js: height_3d = heights_rel[i] * planeWidth * verticalExaggeration (escala 1:1 exata!)
    span_m = span_km * 1000.0
    heights_rel = ((z_grid - center_elev) / span_m).ravel()
    heights_norm = ((z_grid - np.mean(z_grid)) / span).ravel()

    return {
        "size": grid_size,
        "span_km": round(span_km, 1),
        "pixel_m": round(pixel_m, 1),
        "grid_step_m": round(step_grid_m, 1),
        "min_elevation_m": round(min_elev, 1),
        "max_elevation_m": round(max_elev, 1),
        "center_elevation_m": round(center_elev, 1),
        "slope_deg": slope_deg,
        "heights": np.round(heights_norm, 4).tolist(),
        "heights_rel": np.round(heights_rel, 5).tolist(),
        "slopes": np.round(slope_matrix.ravel(), 1).tolist(),
    }