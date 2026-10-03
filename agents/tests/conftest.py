# Testler agents/ içindeki modülleri import edebilsin diye yol ayarı.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
