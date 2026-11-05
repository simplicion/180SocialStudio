import os
import sys

# Tests run without the model, a Hugging Face token or a real secret.
os.environ.setdefault("DIARIZE_WORKER_SECRET", "test-secret")
os.environ["DIARIZE_SKIP_MODEL_LOAD"] = "1"
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
