#!/bin/bash
# setup_venv.sh — Crea la venv para el módulo de watermark
# Correr una sola vez desde la raíz del proyecto:
#   bash watermark/setup_venv.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"

echo "[INFO] Creando venv en $VENV_DIR ..."
python3 -m venv "$VENV_DIR"

echo "[INFO] Instalando dependencias..."
"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install -r "$SCRIPT_DIR/requirements.txt"

echo ""
echo "[OK] venv lista en: $VENV_DIR"
echo "[OK] Intérprete: $VENV_DIR/bin/python3"
echo ""
echo "Asegúrate de tener exiftool instalado:"
echo "  sudo apt install libimage-exiftool-perl"
