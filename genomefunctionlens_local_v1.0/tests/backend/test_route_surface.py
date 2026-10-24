def test_auth_and_chat_routes_are_not_mounted() -> None:
    from app.main import app

    paths = set(app.openapi()["paths"])
    assert "/health" in paths
    assert "/api/datasets" in paths
    assert "/api/download/sequences" in paths
    assert "/api/saved-queries" in paths
    assert not any(path.startswith("/api/auth") for path in paths)
    assert not any(path.startswith("/api/chat") for path in paths)
    assert "/api/feedback" not in paths


