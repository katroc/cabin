
import sys
from pathlib import Path

# Add src to python path so we can import cabin_backend
current_dir = Path(__file__).resolve().parent
src_dir = current_dir.parent
sys.path.append(str(src_dir))

from cabin_backend.config import settings, PROJECT_ROOT

print(f"PROJECT_ROOT: {PROJECT_ROOT}")
print(f"Expected .env path: {PROJECT_ROOT / '.env'}")
print(f"Actual .env exists: {(PROJECT_ROOT / '.env').exists()}")

print(f"Loaded allowed_origins: {settings.allowed_origins}")
print(f"Environment variable CABIN_ALLOWED_ORIGINS: {settings.allowed_origins}")

# Try to manually read .env to see if we can parse it
env_path = PROJECT_ROOT / ".env"
if env_path.exists():
    print("\nContent of .env (grep CABIN_ALLOWED_ORIGINS):")
    with open(env_path, "r") as f:
        for line in f:
            if "CABIN_ALLOWED_ORIGINS" in line:
                print(line.strip())
