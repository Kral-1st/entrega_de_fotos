#!/usr/bin/env python3
"""
watermark.py — Firma invisible en fotos usando dwtDct
Llamado desde Node.js con argumentos:
  python3 watermark.py <input_path> <output_path>

Exit codes:
  0 — OK, firma verificada
  1 — Error fatal (no se pudo procesar)
  2 — Firma aplicada pero verificacion dudosa (Node reintentara)
"""

import sys
import subprocess
import cv2
from pathlib import Path
from imwatermark import WatermarkEncoder, WatermarkDecoder

FIRMA     = "Carlos_Acosta_Carvajal"
ALGORITMO = "dwtDct"

FIRMA_BYTES = FIRMA.encode("utf-8")
BITS        = len(FIRMA_BYTES) * 8


def copiar_exif(origen: Path, destino: Path):
    try:
        subprocess.run(
            ["exiftool", "-TagsFromFile", str(origen), "-all:all", "-overwrite_original", str(destino)],
            capture_output=True,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        print(f"[WARN] exiftool: {e.stderr.decode().strip()}", file=sys.stderr)
    except FileNotFoundError:
        print("[WARN] exiftool no encontrado, EXIF no copiado", file=sys.stderr)


def main():
    if len(sys.argv) != 3:
        print("Uso: watermark.py <input_path> <output_path>", file=sys.stderr)
        sys.exit(1)

    input_path  = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    if not input_path.exists():
        print(f"[ERROR] No existe: {input_path}", file=sys.stderr)
        sys.exit(1)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    img = cv2.imread(str(input_path))
    if img is None:
        print(f"[ERROR] No se pudo leer la imagen: {input_path.name}", file=sys.stderr)
        sys.exit(1)

    h, w = img.shape[:2]
    if h < 256 or w < 256:
        print(f"[ERROR] Imagen muy pequena ({w}x{h}): {input_path.name}", file=sys.stderr)
        sys.exit(1)

    encoder = WatermarkEncoder()
    encoder.set_watermark("bytes", FIRMA_BYTES)
    firmada = encoder.encode(img, ALGORITMO)

    ok = cv2.imwrite(str(output_path), firmada)
    if not ok:
        print(f"[ERROR] cv2.imwrite fallo para: {output_path}", file=sys.stderr)
        sys.exit(1)

    copiar_exif(input_path, output_path)

    # Verificar
    decoder = WatermarkDecoder("bytes", BITS)
    resultado = decoder.decode(firmada, ALGORITMO)
    try:
        leido = resultado.decode("utf-8", errors="replace")
        if FIRMA in leido:
            print(f"[OK] Firma verificada: '{leido}'")
            print(str(output_path))
            sys.exit(0)
        else:
            print(f"[WARN] Verificacion dudosa: '{leido}'", file=sys.stderr)
            print(str(output_path))
            sys.exit(2)  # Node reintentara
    except Exception:
        print("[WARN] No se pudo verificar el watermark", file=sys.stderr)
        print(str(output_path))
        sys.exit(2)


if __name__ == "__main__":
    main()
