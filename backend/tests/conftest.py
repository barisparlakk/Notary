"""pytest konfigürasyonu – backend paketinin sys.path'e eklenmesi."""
import sys
import os

# backend/ dizinini PYTHONPATH'e ekle (app.* importları çalışsın)
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
