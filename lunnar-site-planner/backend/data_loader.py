# backend/data_loader.py
from pathlib import Path
from functools import lru_cache
from skyfield.api import Loader, PlanetaryConstants

# Resolve os caminhos de forma absoluta (funciona em Windows e Linux)
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
KERNELS_DIR = DATA_DIR / "kernels"
LOLA_DIR = DATA_DIR / "lola_dem"

# Garante que as pastas existam
KERNELS_DIR.mkdir(parents=True, exist_ok=True)
LOLA_DIR.mkdir(parents=True, exist_ok=True)

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
        "moon_frame": moon_frame,
    }