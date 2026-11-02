import os
import sys

# Tests run without a real secret or last30days checkout.
os.environ.setdefault("TREND_WORKER_SECRET", "test-secret")
os.environ.pop("REDDIT_CLIENT_ID", None)
os.environ.pop("REDDIT_CLIENT_SECRET", None)
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
