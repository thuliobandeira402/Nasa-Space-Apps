# backend/lola_horizon.py
import numpy as np
from scipy.ndimage import map_coordinates, distance_transform_edt

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


def _preencher_nan_vizinho(z: np.ndarray) -> np.ndarray:
    """Preenche NaN com o valor válido mais próximo (evita 'penhascos' nas bordas da cobertura)."""
    mask = np.isnan(z)
    if not mask.any():
        return z
    if mask.all():
        raise ValueError("Janela sem dados válidos no DEM LOLA.")
    idx = distance_transform_edt(mask, return_distances=False, return_indices=True)
    return z[tuple(idx)]


def _amostrar_grade_local(z, col0_x, row0_y, pixel_m, x, y, lon_deg, span_m, n, order):
    """
    Amostra uma grade n x n de lado span_m no referencial LOCAL do pouso:
    linhas vão de Norte -> Sul e colunas de Oeste -> Leste.
    (O raster está em X/Y polar; o 'norte' local aponta para (sin lon, cos lon), então
    sem essa rotação o relevo ficaria girado em 'lon' graus em relação ao Sol/horizonte.)
    """
    lam = np.radians(lon_deg)
    off = np.linspace(-span_m / 2.0, span_m / 2.0, n)
    leste, norte = np.meshgrid(off, off[::-1])
    X = x + leste * np.cos(lam) + norte * np.sin(lam)
    Y = y - leste * np.sin(lam) + norte * np.cos(lam)
    rows = (row0_y - Y) / pixel_m
    cols = (X - col0_x) / pixel_m
    return map_coordinates(z, [rows, cols], order=order, mode="nearest")


def extrair_malha_terreno_lola(lat: float, lon: float, dem_path: str, grid_size: int = 128,
                               span_m: float = 15_360.0, far_size: int = 96,
                               far_span_m: float = 80_000.0) -> dict:
    """
    Extrai duas grades do GeoTIFF LOLA para o Three.js (uma única leitura do raster):
      - malha próxima: grid_size x grid_size cobrindo span_m (mesma área de antes: ~15,4 km),
        reamostrada com spline cúbica (superfície suave, sem custo extra de leitura);
      - malha distante: far_size x far_size cobrindo far_span_m (~80 km), baixa resolução.
    Alturas em METROS relativas ao ponto de pouso (heights_m). Orientação: linha 0 = Norte, coluna 0 = Oeste.
    """
    import rasterio
    from rasterio.windows import from_bounds

    x, y = latlon_para_xy_polar_sul(lat, lon)
    with rasterio.open(dem_path) as src:
        pixel_m = float(src.res[0])
        # raio que contém o quadrado distante mesmo após a rotação por 'lon'
        half = far_span_m / 2.0 * np.sqrt(2.0) + 3 * pixel_m
        win = from_bounds(x - half, y - half, x + half, y + half, transform=src.transform)
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
    z = _preencher_nan_vizinho(z)

    col0_x = t.c + 0.5 * t.a
    row0_y = t.f + 0.5 * t.e

    z0 = float(map_coordinates(
        z, [[(row0_y - y) / pixel_m], [(x - col0_x) / pixel_m]], order=1, mode="nearest")[0])

    z_near = _amostrar_grade_local(z, col0_x, row0_y, pixel_m, x, y, lon, span_m, grid_size, order=3)
    z_far = _amostrar_grade_local(z, col0_x, row0_y, pixel_m, x, y, lon, far_span_m, far_size, order=1)

    # Declividade real (graus) no centro, via gradiente em metros
    cell_m = span_m / (grid_size - 1)
    dy, dx = np.gradient(z_near, cell_m)
    slope_matrix = np.degrees(np.arctan(np.hypot(dx, dy)))
    c = grid_size // 2
    k = max(2, grid_size // 32)
    slope_deg = float(np.round(np.mean(slope_matrix[c - k:c + k + 1, c - k:c + k + 1]), 2))

    return {
        "size": grid_size,
        "pixel_m": round(pixel_m, 1),          # resolução nativa do DEM
        "cell_m": round(cell_m, 1),            # espaçamento da malha enviada
        "extent_m": round(span_m, 1),          # lado da malha em metros
        "min_elevation_m": round(float(np.min(z_near)), 1),
        "max_elevation_m": round(float(np.max(z_near)), 1),
        "center_elevation_m": round(z0, 1),
        "slope_deg": slope_deg,
        "heights_m": np.round(z_near - z0, 1).ravel().tolist(),
        "far_grid": {
            "size": far_size,
            "cell_m": round(far_span_m / (far_size - 1), 1),
            "extent_m": round(far_span_m, 1),
            "min_elevation_m": round(float(np.min(z_far)), 1),
            "max_elevation_m": round(float(np.max(z_far)), 1),
            "heights_m": np.round(z_far - z0, 1).ravel().tolist(),
        },
    }
