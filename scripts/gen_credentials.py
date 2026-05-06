#!/usr/bin/env python3
"""Generate a credentials INI file with an HMAC-SHA256 hashed password.

The Go binary (my-git-tool, see app/auth.go) uses the SAME SECRET_KEY
constant, so anything generated here can be verified by:

    my-git-tool verify-cred -file auth.ini -username U -password P

INI format produced:

    [auth]
    username = <plain>
    salt = <32 hex chars = 16 random bytes>
    password_hash = <64 hex chars = HMAC-SHA256>
    algorithm = hmac-sha256-v1

Hash recipe (must match ComputeHash in app/auth.go byte-for-byte):

    HMAC-SHA256(
        key = SECRET_KEY,
        msg = salt || 0x00 || username || 0x00 || password,   # all UTF-8
    )

The 0x00 separators prevent ambiguity between e.g.
("ab","c") and ("a","bc") collapsing to the same input.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import hmac
import os
import secrets
import sys

# --------------------------------------------------------------------------
# IMPORTANT: must match the SECRET_KEY constant in app/auth.go byte-for-byte.
# Rotate by updating BOTH sides simultaneously and re-issuing every INI file.
# --------------------------------------------------------------------------
SECRET_KEY: bytes = b"go-git-tool-shared-secret-2026-do-not-leak-this-32B"

ALGORITHM = "hmac-sha256-v1"


def compute_hash(salt: str, username: str, password: str) -> str:
    """Return hex(HMAC-SHA256(SECRET_KEY, salt || 0 || user || 0 || pwd))."""
    msg = (
        salt.encode("utf-8")
        + b"\x00"
        + username.encode("utf-8")
        + b"\x00"
        + password.encode("utf-8")
    )
    return hmac.new(SECRET_KEY, msg, hashlib.sha256).hexdigest()


def make_ini(username: str, password: str, salt: str | None = None) -> str:
    if salt is None:
        salt = secrets.token_hex(16)  # 32 hex chars
    h = compute_hash(salt, username, password)
    return (
        "[auth]\n"
        f"username = {username}\n"
        f"salt = {salt}\n"
        f"password_hash = {h}\n"
        f"algorithm = {ALGORITHM}\n"
    )


def write_secure(path: str, content: str) -> None:
    """Write content with 0600 permission where the OS supports it."""
    if path == "-":
        sys.stdout.write(content)
        return
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    try:
        fd = os.open(path, flags, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
    except OSError:
        # Windows doesn't honour POSIX modes; fall back to plain write.
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Generate an auth INI file readable by my-git-tool.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python gen_credentials.py -u admin -p secret -o auth.ini\n"
            "  python gen_credentials.py -u admin -o auth.ini   # prompts for pwd\n"
            "  python gen_credentials.py -u admin -p secret -o -  # stdout\n"
            "\n"
            "Multi-user web login (one INI per account, same SECRET_KEY as Go):\n"
            "  mkdir -p credentials\n"
            "  python gen_credentials.py -u alice -p 'pw1' -o credentials/alice.ini\n"
            "  python gen_credentials.py -u bob   -p 'pw2' -o credentials/bob.ini\n"
            "  # then: my-git-tool serve -auth-dir ./credentials ...\n"
        ),
    )
    p.add_argument("-u", "--username", required=True, help="account name")
    p.add_argument(
        "-p",
        "--password",
        default=None,
        help="plaintext password (omit to be prompted, never echoed)",
    )
    p.add_argument(
        "-o",
        "--out",
        default="auth.ini",
        help='output INI path (default: auth.ini; use "-" for stdout)',
    )
    p.add_argument(
        "--salt",
        default=None,
        help="override salt as hex (default: 16 random bytes; "
        "use only for reproducible tests)",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()

    password = args.password
    if password is None:
        password = getpass.getpass("Password: ")
        confirm = getpass.getpass("Confirm:  ")
        if password != confirm:
            print("error: passwords do not match", file=sys.stderr)
            return 2
    if not password:
        print("error: empty password", file=sys.stderr)
        return 2

    content = make_ini(args.username, password, args.salt)
    write_secure(args.out, content)

    if args.out != "-":
        print(f"wrote {args.out} (algorithm={ALGORITHM})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
