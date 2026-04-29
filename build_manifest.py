"""
Автогенерация models/manifest.json по содержимому папок.

Запускать перед стартом локального сервера и перед деплоем на Netlify.
Сканирует подпапки в models/, ищет .obj, .mtl, base*.png, normal.png, spec.png.
Если в папке есть meta.json — берёт year/client/purpose оттуда.

Чтобы добавить новую модель: создай папку в models/, положи туда файлы,
запусти этот скрипт (или просто start.bat — он его сам вызовет).
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

MODELS_DIR = Path(__file__).parent / "models"
MANIFEST_PATH = MODELS_DIR / "manifest.json"

BASE_REGEX = re.compile(r"^base(\d*)\.(png|jpg|jpeg|webp)$", re.IGNORECASE)


def scan_folder(folder: Path):
    files = [f.name for f in folder.iterdir() if f.is_file()]

    obj_file = next((f for f in files if f.lower().endswith(".obj")), None)
    if not obj_file:
        return None

    mtl_file = next((f for f in files if f.lower().endswith(".mtl")), None)

    base_maps = sorted(
        [f for f in files if BASE_REGEX.match(f)],
        key=lambda f: int(BASE_REGEX.match(f).group(1) or "0"),
    )

    textures = {}
    if base_maps:
        textures["maps"] = base_maps
    if "normal.png" in files:
        textures["normalMap"] = "normal.png"
    if "spec.png" in files:
        textures["specMap"] = "spec.png"

    meta = {}
    meta_path = folder / "meta.json"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  [warn] {folder.name}/meta.json: {e}")

    entry = {
        "id": folder.name,
        "year": meta.get("year", datetime.now().year),
        "client": meta.get("client", "—"),
        "purpose": meta.get("purpose", "Game-ready asset"),
        "obj": obj_file,
    }
    if mtl_file:
        entry["mtl"] = mtl_file
    if textures:
        entry["textures"] = textures

    # Готовое превью (грузится мгновенно вместо рендера 3D на лету).
    # Если есть preview.jpg/png/webp — указываем его в манифесте.
    for name in ("preview.jpg", "preview.jpeg", "preview.png", "preview.webp"):
        if (folder / name).exists():
            entry["preview"] = name
            break

    return entry


def main():
    if not MODELS_DIR.exists():
        print(f"[error] папка {MODELS_DIR} не найдена")
        return

    folders = sorted(p for p in MODELS_DIR.iterdir() if p.is_dir())
    manifest = []

    print(f"Сканирую {MODELS_DIR}...")
    for folder in folders:
        entry = scan_folder(folder)
        if entry is None:
            print(f"  [skip] {folder.name} — нет .obj")
            continue
        print(f"  [ok]   {folder.name} — {entry['obj']}, текстур: {len(entry.get('textures', {}).get('maps', []))}")
        manifest.append(entry)

    MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\n-> {MANIFEST_PATH} ({len(manifest)} моделей)")


if __name__ == "__main__":
    main()
