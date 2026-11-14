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




LOLA_DEM_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_40MPP_ADJ.TIF"

# Detecta se já existe como .TIF ou .TIFF para evitar download duplicado
_tif_curto = LOLA_DIR / "LDEM_80S_40MPP_ADJ.TIF"
_tif_longo = LOLA_DIR / "LDEM_80S_40MPP_ADJ.TIFF"
LOLA_DEM_PATH = _tif_curto if _tif_curto.exists() else (_tif_longo if _tif_longo.exists() else _tif_curto)

def download_lola_dem(
    url: str = LOLA_DEM_URL,
    destination: Path = LOLA_DEM_PATH,
    chunk_size: int = 1024 * 1024,
    timeout: int = 60,
) -> Path:
    """Baixa o LOLA DEM em blocos, se ele ainda não existir localmente.

    Retorna o caminho do GeoTIFF. O arquivo temporário só é renomeado
    após o download terminar e a assinatura TIFF ser validada.
    """
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)

    def is_valid_tiff(file_path: Path) -> bool:
        if not file_path.is_file() or file_path.stat().st_size < 8:
            return False
        with file_path.open("rb") as file:
            header = file.read(4)
        return header in (b"II*\x00", b"MM\x00*")

    if is_valid_tiff(destination):
        return destination

    temporary_path = destination.with_name(destination.name + ".part")
    request = Request(url, headers={"User-Agent": "LunarLandingResearchProject/1.0"})

    try:
        print(f"Baixando LOLA DEM da NASA: {url}")
        with urlopen(request, timeout=timeout) as response:
            status = getattr(response, "status", 200)
            if status != 200:
                raise RuntimeError(f"Falha no download do LOLA DEM: HTTP {status}")

            total_bytes = int(response.headers.get("Content-Length", 0))
            baixados = 0
            ultimo_mb_log = 0

            with temporary_path.open("wb") as output:
                while True:
                    chunk = response.read(chunk_size)
                    if not chunk:
                        break
                    output.write(chunk)
                    baixados += len(chunk)
                    mb_atual = baixados // (1024 * 1024)
                    if mb_atual >= ultimo_mb_log + 10:
                        ultimo_mb_log = mb_atual
                        if total_bytes > 0:
                            pct = (baixados / total_bytes) * 100
                            print(f"  [LOLA DEM] {mb_atual} MB / {total_bytes // (1024*1024)} MB ({pct:.1f}%)")
                        else:
                            print(f"  [LOLA DEM] {mb_atual} MB baixados...")
                            
        if not is_valid_tiff(temporary_path):
            raise RuntimeError(
                "O download terminou, mas o arquivo recebido não parece ser um TIFF válido."
            )

        temporary_path.replace(destination)
        size_mb = destination.stat().st_size / (1024 ** 2)
        print(f"LOLA DEM salvo em {destination} ({size_mb:.1f} MB).")
        return destination

    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise

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