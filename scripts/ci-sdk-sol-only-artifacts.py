#!/usr/bin/env python3
"""Fail if published SDK artifacts expose retired chain or token surfaces."""

from __future__ import annotations

import re
import tarfile
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TS_DIST = ROOT / "packages" / "hyperbet-sdk" / "dist"
PY_DIST = ROOT / "packages" / "hyperbet-sdk-py" / "dist"
FORBIDDEN = re.compile(
    rb"\b(?:evm|bsc|avax|avalanche|ethers)\b"
    rb"|DuelOutcomeOracle|GoldClob"
    rb"|gold[_-]?(?:token|mint|clob|perps|amm)",
    re.IGNORECASE,
)


def assert_clean(name: str, payload: bytes) -> None:
    match = FORBIDDEN.search(name.encode("utf-8")) or FORBIDDEN.search(payload)
    if match:
        value = match.group(0).decode("utf-8", errors="replace")
        raise SystemExit(f"{name}: prohibited SDK artifact content {value!r}")


def scan_typescript() -> int:
    if not TS_DIST.is_dir():
        raise SystemExit(f"missing TypeScript SDK output: {TS_DIST}")
    files = [path for path in TS_DIST.rglob("*") if path.is_file()]
    if not files:
        raise SystemExit("TypeScript SDK output is empty")
    for path in files:
        assert_clean(str(path.relative_to(ROOT)), path.read_bytes())
    return len(files)


def scan_python() -> tuple[int, int]:
    wheels = sorted(PY_DIST.glob("hyperbet_sdk-*.whl"))
    source_archives = sorted(PY_DIST.glob("hyperbet_sdk-*.tar.gz"))
    if len(wheels) != 1 or len(source_archives) != 1:
        raise SystemExit(
            "Python SDK build must produce exactly one wheel and one source archive"
        )

    member_count = 0
    with zipfile.ZipFile(wheels[0]) as archive:
        members = archive.namelist()
        if not any(name.endswith("hyperbet_sdk/solana/client.py") for name in members):
            raise SystemExit("Python SDK wheel is missing the Solana client")
        for name in members:
            assert_clean(name, archive.read(name))
            member_count += 1

    with tarfile.open(source_archives[0]) as archive:
        members = [member for member in archive.getmembers() if member.isfile()]
        if not any(
            member.name.endswith("hyperbet_sdk/solana/client.py") for member in members
        ):
            raise SystemExit("Python SDK source archive is missing the Solana client")
        for member in members:
            extracted = archive.extractfile(member)
            if extracted is None:
                raise SystemExit(f"could not inspect {member.name}")
            assert_clean(member.name, extracted.read())
            member_count += 1
    return len(wheels) + len(source_archives), member_count


typescript_files = scan_typescript()
python_archives, python_members = scan_python()
print(
    "SOL-only SDK artifact gate passed: "
    f"{typescript_files} TypeScript files and {python_members} members "
    f"across {python_archives} Python archives."
)
