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
        t = src.window_transform(win)
    col0_x = t.c + 0.5 * t.a
    row0_y = t.f + 0.5 * t.e
    return horizonte_360_de_dem(z, col0_x, row0_y, pixel_m, x, y, lon, altura_obs_m, raio_m)


def extrair_malha_terreno_lola(lat: float, lon: float, dem_path: str, grid_size: int = 64) -> dict:
    """
    Extrai uma grade local (grid_size x grid_size) do GeoTIFF LOLA ao redor do pouso
    para renderização 3D no Three.js e cálculo real da declividade (slope_deg) no centro.
    """
    import rasterio
    from rasterio.windows import from_bounds

    x, y = latlon_para_xy_polar_sul(lat, lon)
    with rasterio.open(dem_path) as src:
        pixel_m = float(src.res[0])
        half_span = (grid_size / 2.0) * pixel_m
        win = from_bounds(x - half_span, y - half_span, x + half_span, y + half_span, transform=src.transform)
        win = win.round_offsets().round_lengths()
        z = src.read(1, window=win, boundless=True, fill_value=np.nan).astype("float64")
        if src.nodata is not None:
            z[z == src.nodata] = np.nan

    if np.all(np.isnan(z)):
        raise ValueError("Janela sem dados válidos no DEM LOLA.")

    media_z = float(np.nanmean(z))
    z = np.where(np.isnan(z), media_z, z)

    # Reamostra exatamente para (grid_size, grid_size) compatível com PlaneGeometry(segments = grid_size - 1)
    rows = np.linspace(0, z.shape[0] - 1, grid_size)
    cols = np.linspace(0, z.shape[1] - 1, grid_size)
    rr, cc = np.meshgrid(rows, cols, indexing="ij")
    z_grid = map_coordinates(z, [rr, cc], order=1, mode="nearest")

    # Calcula declividade real (slope em graus) via gradiente na janela central (5x5 pixels)
    dy, dx = np.gradient(z_grid, pixel_m)
    slope_matrix = np.degrees(np.arctan(np.hypot(dx, dy)))
    c = grid_size // 2
    slope_deg = float(np.round(np.mean(slope_matrix[max(0, c - 2):c + 3, max(0, c - 2):c + 3]), 2))

    min_elev = float(np.min(z_grid))
    max_elev = float(np.max(z_grid))
    span = max(1.0, max_elev - min_elev)
    # Normaliza alturas entre -0.5 e +0.5 para o app.js escalar proporcionalmente ao relevo real
    heights_norm = ((z_grid - np.mean(z_grid)) / span).ravel()

    return {
        "size": grid_size,
        "pixel_m": round(pixel_m, 1),
        "min_elevation_m": round(min_elev, 1),
        "max_elevation_m": round(max_elev, 1),
        "center_elevation_m": round(float(z_grid[c, c]), 1),
        "slope_deg": slope_deg,
        "heights": np.round(heights_norm, 4).tolist(),
    }