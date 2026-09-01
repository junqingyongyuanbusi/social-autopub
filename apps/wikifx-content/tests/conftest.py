from __future__ import annotations

import sys
from pathlib import Path

# Running pytest from the service directory already provides this path, but
# keeping it explicit makes IDE and repository-root invocations deterministic.
SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))
