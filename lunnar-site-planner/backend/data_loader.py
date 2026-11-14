# backend/data_loader.py
import json
from pathlib import Path
from functools import lru_cache
from urllib.request import Request, urlopen
from skyfield.api import Loader, PlanetaryConstants

# Resolve os caminhos de forma absoluta (funciona em Windows e Linux)
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
KERNELS_DIR = DATA_DIR / "kernels"
LOLA_DIR = DATA_DIR / "lola_dem"

# Garante que as pastas existam
KERNELS_DIR.mkdir(parents=True, exist_ok=True)
LOLA_DIR.mkdir(parents=True, exist_ok=True)




LOLA_DEM_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_240MPP_COMPACT.TIF"

# Detecta se já existe como .TIF ou .TIFF para evitar download duplicado
_tif_curto = LOLA_DIR / "LDEM_80S_240MPP_COMPACT.TIF"
_tif_longo = LOLA_DIR / "LDEM_80S_240MPP_COMPACT.TIFF"
LOLA_DEM_PATH = _tif_curto if _tif_curto.exists() else (_tif_longo if _tif_longo.exists() else _tif_curto)

# Loader do Skyfield apontando exclusivamente para data/kernels/
skyfield_load = Loader(str(KERNELS_DIR))


@lru_cache(maxsize=1)
def get_planetary_context() -> dict:
    """
    Carrega os kernels SPICE da NASA na memória RAM apenas 1 vez.
    Retorna todos os objetos necessários para cálculos astronômicos.
    """
    ts = skyfield_load.timescale()
    eph = skyfield_load('de421.bsp')

    pc = PlanetaryConstants()
    pc.read_text(skyfield_load('moon_080317.tf'))
    pc.read_text(skyfield_load('pck00008.tpc'))
    pc.read_binary(skyfield_load('moon_pa_de421_1900-2050.bpc'))
    moon_frame = pc.build_frame_named('MOON_ME_DE421')

    return {
        "ts": ts,
        "eph": eph,
        "earth": eph['earth'],
        "moon": eph['moon'],
        "sun": eph['sun'],
        "pc": pc,
        "moon_frame": moon_frame
    }


@lru_cache(maxsize=1)
def get_sites_catalog() -> list[dict]:
    """Lê o catálogo de locais de pouso do arquivo JSON em data/."""
    sites_path = DATA_DIR / "sites_metadata.json"
    if not sites_path.exists():
        return []
    with open(sites_path, "r", encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=1)
def get_horizon_profiles() -> dict:
    """Lê os perfis de obstrução topográfica do arquivo JSON em data/."""
    profiles_path = DATA_DIR / "horizon_profiles.json"
    if not profiles_path.exists():
        return {}
    with open(profiles_path, "r", encoding="utf-8") as f:
        return json.load(f)