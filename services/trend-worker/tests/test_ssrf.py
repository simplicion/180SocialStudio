import pytest

from app.ssrf import UnsafeUrl, is_public_ip, validate_public_url

PUBLIC = lambda host: ["93.184.216.34"]  # noqa: E731


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/", "http://localhost/admin", "http://10.0.0.5/", "http://192.168.1.1/", "http://172.16.0.1/",
    "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://[fd00::1]/", "http://0.0.0.0/",
    "http://[::ffff:127.0.0.1]/", "http://100.64.0.1/", "file:///etc/passwd", "gopher://example.com/", "ftp://example.com/",
    "http://user:pass@example.com/", "http://example.com:8080/", "http://db.internal/", "http://printer.local/", "http://intranet/",
])
def test_blocks_unsafe_urls(url):
    with pytest.raises(UnsafeUrl):
        validate_public_url(url, PUBLIC)


def test_blocks_public_name_that_resolves_private():
    with pytest.raises(UnsafeUrl):
        validate_public_url("https://rebind.example.com/", lambda h: ["93.184.216.34", "10.1.2.3"])


def test_blocks_unresolvable_host():
    def boom(_):
        raise OSError("nxdomain")
    with pytest.raises(UnsafeUrl):
        validate_public_url("https://nope.example.com/", boom)


def test_allows_public_urls():
    assert validate_public_url("https://example.com/article?id=1", PUBLIC) == "https://example.com/article?id=1"
    assert validate_public_url("http://example.com:80/x", PUBLIC)
    assert validate_public_url("https://93.184.216.34/", PUBLIC)


def test_public_ip_classification():
    assert is_public_ip("8.8.8.8")
    assert not is_public_ip("127.0.0.1")
    assert not is_public_ip("::ffff:10.0.0.1")
    assert not is_public_ip("224.0.0.1")


def test_embedded_ipv4_is_judged_not_the_wrapper():
    # NAT64 (DNS64 networks) of a public host: github.com resolved like this in development.
    assert is_public_ip("64:ff9b::14cf:4952")
    assert not is_public_ip("64:ff9b::7f00:1")  # NAT64 of 127.0.0.1
    assert not is_public_ip("2002:7f00:0001::1")  # 6to4 wrapping 127.0.0.1
    assert not is_public_ip("2002:a9fe:a9fe::1")  # 6to4 wrapping 169.254.169.254
    validate_public_url("https://github.com/x", lambda h: ["20.207.73.82", "64:ff9b::14cf:4952"])
