#!/usr/bin/env python3
import os
import sys
import subprocess
import cv2
from pathlib import Path
from imwatermark import WatermarkEncoder, WatermarkDecoder

# ── Configuración desde entorno ──────────────────────────────────────────────

FIRMA     = os.environ.get("WM_FIRMA", "").strip()
ALGORITMO = os.environ.get("WM_ALGORITMO", "dwtDctSvd").strip()

ALGORITMOS_VALIDOS = {"dwtDct", "dwtDctSvd", "rivaGan"}

def validar_config():
    errores = []
    if not FIRMA:
        errores.append("WM_FIRMA no definida o vacía")
    if ALGORITMO not in ALGORITMOS_VALIDOS:
        errores.append(f"WM_ALGORITMO inválido: '{ALGORITMO}' — válidos: {ALGORITMOS_VALIDOS}")
    if errores:
        for e in errores:
            print(f"[ERROR] {e}", file=sys.stderr)
        sys.exit(1)

# ── EXIF ─────────────────────────────────────────────────────────────────────

def copiar_exif(origen: Path, destino: Path):
    try:
        subprocess.run(
            [
                "exiftool",
                "-TagsFromFile", str(origen),
                "-all:all",
                "-overwrite_original",
                str(destino),
            ],
            capture_output=True,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        print(f"[WARN] exiftool: {e.stderr.decode().strip()}", file=sys.stderr)
    except FileNotFoundError:
        print("[WARN] exiftool no encontrado, EXIF no copiado", file=sys.stderr)

# ── Verificación robusta ──────────────────────────────────────────────────────

def calcular_similitud_bits(original: bytes, leido: bytes) -> float:
    """
    Compara bit a bit dos secuencias de bytes y devuelve
    el porcentaje de bits correctos (0.0 - 1.0).
    Util para tolerar pequeños errores de bit que introduce
    dwtDctSvd al sobrevivir compresion JPEG o resize.
    """
    total = 0
    correctos = 0
    for b_orig, b_leido in zip(original, leido):
        for bit in range(8):
            total += 1
            if ((b_orig >> bit) & 1) == ((b_leido >> bit) & 1):
                correctos += 1
    return correctos / total if total > 0 else 0.0

UMBRAL_SIMILITUD = 0.90  # 90% de bits correctos = firma válida

def verificar_firma(firmada, firma_bytes: bytes) -> tuple[bool, str, float]:
    """
    Devuelve (es_valida, texto_leido, similitud_porcentual)
    """
    bits = len(firma_bytes) * 8
    decoder = WatermarkDecoder("bytes", bits)
    try:
        resultado = decoder.decode(firmada, ALGORITMO)
        similitud = calcular_similitud_bits(firma_bytes, resultado)
        texto = resultado.decode("utf-8", errors="replace")
        return similitud >= UMBRAL_SIMILITUD, texto, similitud
    except Exception as ex:
        print(f"[WARN] Excepción en verificación: {ex}", file=sys.stderr)
        return False, "", 0.0

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    validar_config()

    if len(sys.argv) != 3:
        print("Uso: watermark.py <input_path> <output_path>", file=sys.stderr)
        sys.exit(1)

    input_path  = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    # Validar entrada
    if not input_path.exists():
        print(f"[ERROR] No existe: {input_path}", file=sys.stderr)
        sys.exit(1)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Leer imagen
    img = cv2.imread(str(input_path))
    if img is None:
        print(f"[ERROR] No se pudo leer la imagen: {input_path.name}", file=sys.stderr)
        sys.exit(1)

    h, w = img.shape[:2]
    if h < 256 or w < 256:
        print(f"[ERROR] Imagen muy pequeña ({w}x{h}): {input_path.name}", file=sys.stderr)
        sys.exit(1)

    # Aplicar watermark
    firma_bytes = FIRMA.encode("utf-8")
    encoder = WatermarkEncoder()
    encoder.set_watermark("bytes", firma_bytes)

    try:
        firmada = encoder.encode(img, ALGORITMO)
    except Exception as ex:
        print(f"[ERROR] Encoder falló ({ALGORITMO}): {ex}", file=sys.stderr)
        sys.exit(1)

    # Guardar
    ok = cv2.imwrite(str(output_path), firmada)
    if not ok:
        print(f"[ERROR] cv2.imwrite falló para: {output_path}", file=sys.stderr)
        sys.exit(1)

    # Preservar EXIF
    copiar_exif(input_path, output_path)

    # Verificar
    es_valida, texto_leido, similitud = verificar_firma(firmada, firma_bytes)
    pct = f"{similitud * 100:.1f}%"

    if es_valida:
        print(f"[OK] Firma verificada ({pct} similitud): '{texto_leido}'")
        print(str(output_path))
        sys.exit(0)
    else:
        print(f"[WARN] Verificación dudosa ({pct} similitud): '{texto_leido}'", file=sys.stderr)
        print(str(output_path))
        sys.exit(2)

if __name__ == "__main__":
    main()
