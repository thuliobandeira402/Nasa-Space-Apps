# backend_loader.py
import os
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"
DATA_DIR = ROOT_DIR / "data"
KERNELS_DIR = DATA_DIR / "kernels"
LOLA_DIR = DATA_DIR / "lola_dem"
VENV_DIR = ROOT_DIR / ".venv"
REQ_FILE = ROOT_DIR / "requirements.txt"

SPICE_KERNELS = {
    "de421.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/a_old_versions/de421.bsp",
    "moon_080317.tf": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_080317.tf",
    "pck00008.tpc": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/a_old_versions/pck00008.tpc",
    "moon_pa_de421_1900-2050.bpc": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de421_1900-2050.bpc",
}

LOLA_DEM_NAME = "LDEM_80S_240MPP_COMPACT.TIF"
LOLA_DEM_URL = f"https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/SOUTH_POLE/{LOLA_DEM_NAME}"


def _venv_python() -> Path:
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def ensure_venv_and_deps() -> Path:
    vpy = _venv_python()
    if not vpy.exists():
        print("[1/4] Creating virtual environment (.venv)...")
        subprocess.check_call([sys.executable, "-m", "venv", str(VENV_DIR)])

    print("[2/4] Verifying Python dependencies...")
    subprocess.check_call([str(vpy), "-m", "pip", "install", "--upgrade", "pip", "-q"])
    if REQ_FILE.exists():
        subprocess.check_call([str(vpy), "-m", "pip", "install", "-r", str(REQ_FILE), "-q"])
    else:
        subprocess.check_call([
            str(vpy), "-m", "pip", "install",
            "fastapi>=0.100.0", "uvicorn>=0.20.0", "numpy>=1.22.0",
            "scipy>=1.8.0", "skyfield>=1.45", "rasterio>=1.3.0", "pydantic>=2.0.0", "-q"
        ])
    return vpy


def _download_if_missing(dest: Path, url: str) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    print(f"      Baixando {dest.name} ...")
    tmp = dest.with_suffix(dest.suffix + ".part")
    urllib.request.urlretrieve(url, tmp)
    tmp.replace(dest)


def ensure_nasa_datasets() -> None:
    print("[3/4] Verifying SPICE and DEM LRO/LOL...")
    KERNELS_DIR.mkdir(parents=True, exist_ok=True)
    LOLA_DIR.mkdir(parents=True, exist_ok=True)

    for fname, url in SPICE_KERNELS.items():
        _download_if_missing(KERNELS_DIR / fname, url)

    tif_short = LOLA_DIR / "LDEM_80S_240MPP_COMPACT.TIF"
    tif_long = LOLA_DIR / "LDEM_80S_240MPP_COMPACT.TIFF"
    if not tif_short.exists() and not tif_long.exists():
        _download_if_missing(tif_short, LOLA_DEM_URL)


def find_free_port(preferred: int = 8000) -> int:
    for port in range(preferred, preferred + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return preferred


def main() -> None:
    if not BACKEND_DIR.exists():
        raise FileNotFoundError(f"File called backend not found in {ROOT_DIR}")

    vpy = ensure_venv_and_deps()
    ensure_nasa_datasets()

    port = find_free_port(8000)
    url = f"http://127.0.0.1:{port}"
    print(f"[4/4] Starting Lunar Site Planner at {url} (Ctrl+C to stop)...")

    proc = subprocess.Popen(
        [
            str(vpy), "-m", "uvicorn", "main:app",
            "--app-dir", str(BACKEND_DIR),
            "--host", "127.0.0.1",
            "--port", str(port),
            "--workers", "1",
        ],
        cwd=str(BACKEND_DIR),
    )

    time.sleep(2.0)
    webbrowser.open(url)

    try:
        proc.wait()
    except KeyboardInterrupt:
        print("\nShutting down servidor...")
        proc.terminate()
        proc.wait()


if __name__ == "__main__":
    main()
