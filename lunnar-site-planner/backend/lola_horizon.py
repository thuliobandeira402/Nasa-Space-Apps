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