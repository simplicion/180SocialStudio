"""SSRF guard for user- or model-supplied URLs.

Every URL is checked before it is fetched: http(s) only, default ports only, no credentials in the URL, no
internal-looking host names, and EVERY address the host resolves to must be a public unicast address. Redirects are
followed by Scrapling in "safe" mode, which re-applies a private-IP check on each hop.
"""
from __future__ import annotations

import ipaddress
import socket
from typing import Callable
from urllib.parse import urlsplit

BLOCKED_SUFFIXES = (".local", ".localhost", ".internal", ".intranet", ".lan", ".home", ".corp", ".svc", ".cluster.local")
ALLOWED_PORTS = {None, 80, 443}

Resolver = Callable[[str], list[str]]


class UnsafeUrl(ValueError):
    pass


def _resolve(host: str) -> list[str]:
    infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    return sorted({info[4][0] for info in infos})


NAT64_WELL_KNOWN = ipaddress.ip_network("64:ff9b::/96")


def _embedded_ipv4(ip: ipaddress.IPv6Address) -> ipaddress.IPv4Address | None:
    """IPv4 carried inside an IPv6 address (mapped, NAT64 well-known prefix, 6to4, Teredo client)."""
    if ip.ipv4_mapped:
        return ip.ipv4_mapped
    if ip in NAT64_WELL_KNOWN:
        return ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
    if ip.sixtofour:
        return ip.sixtofour
    if ip.teredo:
        return ip.teredo[1]
    return None


def is_public_ip(raw: str) -> bool:
    ip = ipaddress.ip_address(raw.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address):
        # Judge the IPv4 that actually gets reached: NAT64 of a public host is fine; 6to4/Teredo of 127.0.0.1 is not.
        v4 = _embedded_ipv4(ip)
        if v4 is not None:
            ip = v4
    return ip.is_global and not ip.is_multicast and not ip.is_reserved


def validate_public_url(url: str, resolver: Resolver = _resolve) -> str:
    """Returns the normalised URL or raises UnsafeUrl."""
    if not isinstance(url, str) or len(url) > 2048:
        raise UnsafeUrl("url must be a string of at most 2048 characters")
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https"):
        raise UnsafeUrl("only http and https URLs are allowed")
    if parts.username or parts.password:
        raise UnsafeUrl("credentials in URLs are not allowed")
    host = (parts.hostname or "").rstrip(".").lower()
    if not host:
        raise UnsafeUrl("url has no host")
    try:
        port = parts.port
    except ValueError as exc:
        raise UnsafeUrl("invalid port") from exc
    if port not in ALLOWED_PORTS:
        raise UnsafeUrl("only the default http/https ports are allowed")
    if host == "localhost" or host.endswith(BLOCKED_SUFFIXES) or "." not in host.strip("[]"):
        raise UnsafeUrl("internal host names are not allowed")
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = None
    if literal is not None:
        if not is_public_ip(str(literal)):
            raise UnsafeUrl("private, loopback, link-local and reserved addresses are not allowed")
        return parts.geturl()
    try:
        addrs = resolver(host)
    except OSError as exc:
        raise UnsafeUrl(f"host does not resolve: {host}") from exc
    if not addrs:
        raise UnsafeUrl(f"host does not resolve: {host}")
    bad = [a for a in addrs if not is_public_ip(a)]
    if bad:
        raise UnsafeUrl("host resolves to a private or reserved address")
    return parts.geturl()
