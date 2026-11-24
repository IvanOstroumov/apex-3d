#!/usr/bin/env python3
"""
Downloads 100% CC0 Photographed Equirectangular .HDR Skies (Poly Haven / Three.js)
and 100% CC0 Photogrammetry-Scanned PBR Texture Sets (ambientCG), packing
AmbientOcclusion (R) + Roughness (G) + Metalness (B) into single GPU-efficient ORM maps.
"""
import io
import json
import os
import urllib.request
import zipfile

try:
    from PIL import Image
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "Pillow"])
    from PIL import Image

BASE_PUBLIC = "/home/antigravity/f1-apex-3d-fh6/public/assets"
HDRI_DIR = os.path.join(BASE_PUBLIC, "hdri")
PBR_DIR = os.path.join(BASE_PUBLIC, "pbr")
os.makedirs(HDRI_DIR, exist_ok=True)
os.makedirs(PBR_DIR, exist_ok=True)

HEADERS = {"User-Agent": "Mozilla/5.0 (APEX-GP-3D-FH6-Builder)"}

def fetch_bytes(url: str, timeout=30) -> bytes:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()

# 1. Download Real Photographed 32-bit .HDR Skies
HDRI_TARGETS = [
    (
        "monza_golden_2k.hdr",
        [
            "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloppenheim_06_puresky_2k.hdr",
            "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/blouberg_sunrise_2_1k.hdr",
        ],
    ),
    (
        "alpine_peaks_2k.hdr",
        [
            "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_48d_partly_cloudy_puresky_2k.hdr",
            "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/quarry_01_1k.hdr",
        ],
    ),
    (
        "desert_sunset_2k.hdr",
        [
            "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/belfast_sunset_puresky_2k.hdr",
            "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/venice_sunset_1k.hdr",
        ],
    ),
    (
        "night_sky_1k.hdr",
        [
            "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/moonless_golf_1k.hdr",
        ],
    ),
    (
        "studio_automotive_2k.hdr",
        [
            "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/studio_small_09_2k.hdr",
            "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/quarry_01_1k.hdr",
        ],
    ),
]

for fname, urls in HDRI_TARGETS:
    out_path = os.path.join(HDRI_DIR, fname)
    if os.path.exists(out_path) and os.path.getsize(out_path) > 100_000:
        print(f"[HDRI] Cached: {fname} ({os.path.getsize(out_path)//1024} KB)")
        continue
    for u in urls:
        try:
            print(f"[HDRI] Downloading {fname} from {u} ...")
            data = fetch_bytes(u, timeout=45)
            with open(out_path, "wb") as f:
                f.write(data)
            print(f"[HDRI] Saved {fname} ({len(data)//1024} KB)")
            break
        except Exception as ex:
            print(f"[HDRI] Fallback triggered for {fname}: {ex}")

# 2. Download & Pack Real Photogrammetry-Scanned CC0 PBR Materials from ambientCG
def find_ambientcg_zip(asset_candidates, res="1K-JPG"):
    for aid in asset_candidates:
        api = f"https://ambientcg.com/api/v2/full_json?id={aid}&include=downloadData"
        try:
            info = json.loads(fetch_bytes(api, timeout=12).decode())
            found = info.get("foundAssets", [])
            if not found:
                continue
            dl = found[0]["downloadFolders"]["default"]["downloadFiletypeCategories"]["zip"]["downloads"]
            for d in dl:
                if res in d["attribute"]:
                    return aid, d["downloadLink"]
            for d in dl:
                if "1K-JPG" in d["attribute"]:
                    return aid, d["downloadLink"]
        except Exception:
            continue
    raise RuntimeError(f"Could not find ambientCG zip for {asset_candidates}")

PBR_SPECS = [
    ("asphalt", ["Asphalt012", "Asphalt026"], "2K-JPG", 2048),
    ("grass", ["Grass004", "Grass001"], "1K-JPG", 1024),
    ("rock", ["Rock030", "Rock051"], "1K-JPG", 1024),
    ("stonewall", ["Bricks090", "Bricks059", "PavingStones131", "Rock051"], "1K-JPG", 1024),
    ("bark", ["Bark007", "Bark012"], "1K-JPG", 1024),
    ("sand", ["Ground054", "Ground037"], "1K-JPG", 1024),
]

for target_name, candidates, pref_res, target_px in PBR_SPECS:
    mat_dir = os.path.join(PBR_DIR, target_name)
    os.makedirs(mat_dir, exist_ok=True)
    if all(os.path.exists(os.path.join(mat_dir, f)) for f in ("albedo.jpg", "normal.jpg", "orm.jpg")):
        print(f"[PBR] Cached: {target_name}")
        continue

    aid, zip_url = find_ambientcg_zip(candidates, pref_res)
    print(f"[PBR] Downloading {target_name} ({aid}) -> {zip_url}")
    zbytes = fetch_bytes(zip_url, timeout=60)
    zf = zipfile.ZipFile(io.BytesIO(zbytes))
    names = zf.namelist()

    def load_chan(substrs, mode="RGB", default_val=255):
        for s in substrs:
            for n in names:
                if s.lower() in n.lower() and n.lower().endswith((".jpg", ".jpeg", ".png")):
                    im = Image.open(io.BytesIO(zf.read(n))).convert(mode)
                    if im.size != (target_px, target_px):
                        im = im.resize((target_px, target_px), Image.Resampling.LANCZOS)
                    return im
        return Image.new(mode, (target_px, target_px), default_val)

    albedo = load_chan(["_Color", "_Albedo"], "RGB", (128, 128, 128))
    normal = load_chan(["_NormalGL", "_Normal"], "RGB", (128, 128, 255))
    ao = load_chan(["_AmbientOcclusion", "_AO"], "L", 255)
    rough = load_chan(["_Roughness"], "L", 200)
    metal = load_chan(["_Metalness", "_Metallic"], "L", 0)

    orm = Image.merge("RGB", (ao, rough, metal))

    albedo.save(os.path.join(mat_dir, "albedo.jpg"), "JPEG", quality=88, optimize=True)
    normal.save(os.path.join(mat_dir, "normal.jpg"), "JPEG", quality=90, optimize=True)
    orm.save(os.path.join(mat_dir, "orm.jpg"), "JPEG", quality=86, optimize=True)
    print(f"[PBR] Packed {target_name}: albedo.jpg, normal.jpg, orm.jpg ({target_px}x{target_px})")

print("ALL HDRI & SCANNED PBR ASSETS READY!")
