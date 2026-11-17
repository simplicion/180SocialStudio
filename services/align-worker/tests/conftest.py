import os
import sys

# Tests run without a model download or a real secret.
os.environ.setdefault("ALIGN_WORKER_SECRET", "test-secret")
os.environ["ALIGN_SKIP_MODEL_LOAD"] = "1"
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def pytest_configure(config):
    config.addinivalue_line("markers", "model: downloads and runs a real wav2vec2 model (ALIGN_RUN_MODEL_TESTS=1)")
