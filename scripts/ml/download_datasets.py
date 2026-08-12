#!/usr/bin/env python3
"""
Dataset acquisition for the custom crop-health model (TODO P0-4).

Downloads the approved source datasets, verifies integrity, extracts them
safely, and writes a reproducible manifest. Acquisition only: no class census,
no deduplication, no splitting, no training (those are P0-5 / P0-6 / Phase 4).

Design notes
------------
* Sources are declared in ``dataset-sources.json`` so provenance is reviewable
  data rather than buried logic.
* Third-party archives are untrusted input: extraction rejects absolute paths,
  parent-directory traversal (zip-slip) and symlinks. Nothing is executed.
* Idempotent: a dataset whose archive checksum already matches is not
  re-downloaded, and an already-extracted tree is not re-extracted.
* Failures are reported, never silently skipped. Exit code is non-zero if any
  required dataset failed.

Usage
-----
    python scripts/ml/download_datasets.py                # all sources
    python scripts/ml/download_datasets.py --only chilli_primary
    python scripts/ml/download_datasets.py --list         # show registry
    python scripts/ml/download_datasets.py --verify-only  # no network
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
import subprocess
import sys
import tarfile
import time
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
DATASETS_DIR = REPO_ROOT / "datasets"
RAW_DIR = DATASETS_DIR / "raw"
ARCHIVE_DIR = DATASETS_DIR / "_archives"
LICENSE_DIR = DATASETS_DIR / "licenses"
MANIFEST_PATH = DATASETS_DIR / "manifest-raw.json"
SOURCES_PATH = Path(__file__).resolve().parent / "dataset-sources.json"

CHUNK = 1 << 20  # 1 MiB
HTTP_TIMEOUT = 60
MAX_RETRIES = 3
MAX_ARCHIVE_BYTES = 12 * 1024**3  # refuse absurd downloads (disk-exhaustion guard)
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
SAMPLE_DECODE_COUNT = 40

USER_AGENT = "HIM-1096-dataset-acquisition/1.0 (hackathon research; contact via repo)"


# ───────────────────────────── result types ──────────────────────────────


@dataclass
class DatasetResult:
    key: str
    name: str
    status: str = "pending"  # ok | blocked | failed | skipped
    notes: list[str] = field(default_factory=list)
    archives: list[dict] = field(default_factory=list)
    extracted_files: int = 0
    image_files: int = 0
    sample_decoded: int = 0
    corrupt_files: list[str] = field(default_factory=list)
    renamed_files: int = 0
    nested_extracted: int = 0
    macos_stubs_ignored: int = 0
    top_level_dirs: list[str] = field(default_factory=list)
    bytes_on_disk: int = 0

    def note(self, message: str) -> None:
        self.notes.append(message)
        # flush: stdout is block-buffered when piped, which hides all progress
        # on multi-GB runs until the process exits.
        print(f"    · {message}", flush=True)


# ─────────────────────────────── helpers ─────────────────────────────────


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f}{unit}" if unit != "B" else f"{n}B"
        n /= 1024.0
    return f"{n:.1f}GB"


def require_https(url: str) -> None:
    if urlparse(url).scheme != "https":
        raise ValueError(f"refusing non-HTTPS URL: {url}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def http_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def download_with_curl(url: str, dest: Path) -> None:
    """
    Fetch via curl. Required for hosts behind a Cloudflare bot challenge:
    Mendeley Data returns a 403 'Just a moment...' interstitial to Python's TLS
    fingerprint whatever User-Agent is sent, while curl is served normally
    (verified during P0-4). curl also gives us resume and retry for free.
    """
    require_https(url)
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    command = [
        "curl",
        "--location",  # Mendeley 302s to S3
        "--fail",  # non-2xx becomes a non-zero exit
        "--silent",
        "--show-error",
        "--continue-at",
        "-",  # resume a partial file
        "--retry",
        str(MAX_RETRIES),
        "--retry-delay",
        "3",
        "--connect-timeout",
        "30",
        "--output",
        str(part),
        url,
    ]
    completed = subprocess.run(command, capture_output=True, text=True)  # noqa: S603 - fixed argv, no shell
    if completed.returncode != 0:
        raise RuntimeError(f"curl failed (exit {completed.returncode}): {completed.stderr.strip()[:200]}")
    part.replace(dest)


def download(session: requests.Session, url: str, dest: Path, expected_bytes: int | None) -> None:
    """Download with resume + retry. Leaves ``dest`` complete or raises."""
    require_https(url)
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")

    for attempt in range(1, MAX_RETRIES + 1):
        existing = part.stat().st_size if part.exists() else 0
        headers = {"Range": f"bytes={existing}-"} if existing else {}
        try:
            with session.get(url, stream=True, timeout=HTTP_TIMEOUT, headers=headers) as response:
                if existing and response.status_code == 200:
                    existing = 0  # server ignored Range; restart cleanly
                    part.unlink(missing_ok=True)
                elif existing and response.status_code == 416:
                    break  # already complete
                response.raise_for_status()

                declared = response.headers.get("Content-Length")
                total = int(declared) + existing if declared else expected_bytes
                if total and total > MAX_ARCHIVE_BYTES:
                    raise ValueError(f"archive exceeds size guard ({human(total)})")

                mode = "ab" if existing else "wb"
                done = existing
                last_report = time.monotonic()
                with part.open(mode) as handle:
                    for block in response.iter_content(CHUNK):
                        handle.write(block)
                        done += len(block)
                        if time.monotonic() - last_report > 5:
                            pct = f" ({done / total * 100:.0f}%)" if total else ""
                            print(f"      {human(done)}{pct}", flush=True)
                            last_report = time.monotonic()
            break
        except (requests.RequestException, ValueError) as exc:
            if attempt == MAX_RETRIES:
                raise
            backoff = 2**attempt + random.random()
            print(f"      retry {attempt}/{MAX_RETRIES} after {backoff:.1f}s ({exc})")
            time.sleep(backoff)

    part.replace(dest)


WINDOWS_ILLEGAL = '<>:"|?*'


def sanitize_component(part: str) -> str:
    """
    Make one path component valid on Windows without weakening the safety
    checks (those run first, on the original name).

    Real datasets contain names Windows rejects — PlantDoc ships
    'IMG_1629.JPG?1507122477.jpg', where '?' raises OSError 22. Renaming is
    recorded so the audit can trace any file back to its archive entry.
    """
    cleaned = "".join("_" if ch in WINDOWS_ILLEGAL or ord(ch) < 32 else ch for ch in part)
    cleaned = cleaned.rstrip(" .")  # Windows drops trailing dots/spaces
    return cleaned or "_"


def sanitize_relpath(name: str) -> tuple[str, bool]:
    parts = [sanitize_component(p) for p in Path(name).parts]
    safe = str(Path(*parts)) if parts else "_"
    return safe, safe != str(Path(name))


def is_within(base: Path, target: Path) -> bool:
    try:
        target.resolve().relative_to(base.resolve())
        return True
    except ValueError:
        return False


def safe_extract(archive: Path, dest: Path) -> tuple[int, int]:
    """
    Extract an untrusted archive, rejecting traversal and symlinks.

    Safety checks run against the ORIGINAL entry name; only afterwards is the
    name sanitised for the local filesystem. Returns (extracted, renamed).
    """
    dest.mkdir(parents=True, exist_ok=True)
    extracted = 0
    renamed = 0

    def prepare(name: str) -> Path:
        nonlocal renamed
        if Path(name).is_absolute() or ".." in Path(name).parts:
            raise ValueError(f"unsafe archive entry rejected: {name}")
        safe_name, was_renamed = sanitize_relpath(name)
        target = dest / safe_name
        if not is_within(dest, target):
            raise ValueError(f"archive entry escapes destination: {name}")
        if was_renamed:
            renamed += 1
        target.parent.mkdir(parents=True, exist_ok=True)
        return target

    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as zf:
            for info in zf.infolist():
                if info.filename.endswith("/"):
                    continue
                target = prepare(info.filename)
                with zf.open(info) as src, target.open("wb") as out:
                    shutil.copyfileobj(src, out)
                extracted += 1
        return extracted, renamed

    if tarfile.is_tarfile(archive):
        with tarfile.open(archive) as tf:
            for member in tf.getmembers():
                if member.issym() or member.islnk():
                    raise ValueError(f"symlink in archive rejected: {member.name}")
                if not member.isfile():
                    continue
                target = prepare(member.name)
                src = tf.extractfile(member)
                if src is None:
                    continue
                with src, target.open("wb") as out:
                    shutil.copyfileobj(src, out)
                extracted += 1
        return extracted, renamed

    if archive.suffix.lower() == ".7z":
        # Some publishers ship .7z (the Odisha rice set does). py7zr is an
        # acquisition-time dependency only — it is not part of the product.
        import py7zr

        with py7zr.SevenZipFile(archive, mode="r") as sz:
            names = sz.getnames()
            for name in names:
                if Path(name).is_absolute() or ".." in Path(name).parts:
                    raise ValueError(f"unsafe archive entry rejected: {name}")
            sz.extractall(path=dest)
        # Post-condition: nothing may have landed outside the destination.
        for path in dest.rglob("*"):
            if path.is_file() and not is_within(dest, path):
                raise ValueError(f"archive entry escaped destination: {path}")
        extracted = sum(1 for p in dest.rglob("*") if p.is_file())
        return extracted, renamed

    raise ValueError(f"unrecognised archive format: {archive.name}")


def extract_nested(root: Path, result: DatasetResult, max_depth: int = 3) -> None:
    """
    Unpack archives that are themselves inside an extracted dataset.

    Several publishers ship per-class ZIPs inside the dataset archive
    (chilli_primary nests four class ZIPs; SAR-CLD-2024 nests 'Original' and
    'Augmented'), so a single-level extraction leaves most images sealed and
    the inventory badly under-counts. Each nested archive is unpacked beside
    itself into a directory named after the file, using the same
    traversal/symlink-safe extractor. Idempotent via per-directory markers.
    """
    for _ in range(max_depth):
        pending = []
        for archive in sorted([*root.rglob("*.zip"), *root.rglob("*.7z")]):
            target = archive.with_suffix("")
            if not (target / ".extracted").exists():
                pending.append((archive, target))
        if not pending:
            return
        for archive, target in pending:
            try:
                count, renamed = safe_extract(archive, target)
                (target / ".extracted").write_text(
                    datetime.now(timezone.utc).isoformat(), encoding="utf-8"
                )
                result.renamed_files += renamed
                result.nested_extracted += 1
                result.note(f"nested archive {archive.name} -> {count} entries")
            except Exception as exc:  # noqa: BLE001 - report, keep going
                result.note(f"WARNING nested extraction failed for {archive.name}: {exc}")


def is_macos_metadata(path: Path) -> bool:
    """
    macOS zip tooling injects an AppleDouble stub for every file, under
    __MACOSX/ and named ._<original>. They carry image extensions but contain
    resource-fork data, not pixels. Counting them silently doubles the apparent
    image total (chilli_secondary: 3,030 apparent vs 1,515 real).
    """
    return "__MACOSX" in path.parts or path.name.startswith("._")


def inventory(root: Path, result: DatasetResult) -> None:
    """Count files, sample-decode images, record corrupt ones. No hiding."""
    all_files = [p for p in root.rglob("*") if p.is_file()]
    files = [p for p in all_files if not is_macos_metadata(p)]
    skipped = len(all_files) - len(files)
    if skipped:
        result.macos_stubs_ignored = skipped
        result.note(f"ignored {skipped} macOS AppleDouble stub(s) (__MACOSX/._*) — not real data")
    result.extracted_files = len(files)
    result.bytes_on_disk = sum(p.stat().st_size for p in files)
    images = [p for p in files if p.suffix.lower() in IMAGE_SUFFIXES]
    result.image_files = len(images)
    result.top_level_dirs = sorted(p.name for p in root.iterdir() if p.is_dir())[:25]

    if not images:
        result.note("no image files found — check archive structure")
        return

    rng = random.Random(42)  # deterministic sample
    sample = rng.sample(images, min(SAMPLE_DECODE_COUNT, len(images)))
    for path in sample:
        try:
            with Image.open(path) as img:
                img.verify()
            result.sample_decoded += 1
        except Exception as exc:  # noqa: BLE001 - report whatever Pillow raises
            result.corrupt_files.append(f"{path.relative_to(root)}: {type(exc).__name__}")
    result.note(
        f"{result.image_files} images; sample-decoded {result.sample_decoded}/{len(sample)}"
        + (f"; {len(result.corrupt_files)} corrupt" if result.corrupt_files else "")
    )


# ────────────────────────────── main flow ────────────────────────────────
#
# Every source declares its download URL explicitly in dataset-sources.json.
# Mendeley's `public-api/datasets/{id}/files` endpoint returns 403 to
# unauthenticated clients (verified during P0-4), so the working route is the
# publisher's `public-files/.../file_downloaded` direct link. Explicit URLs are
# also better for reproducibility: the registry records exactly what was
# fetched, and expected sizes/checksums are verified after download.


def acquire(source: dict, session: requests.Session, verify_only: bool) -> DatasetResult:
    result = DatasetResult(key=source["id"], name=source["name"])
    print(f"\n▶ {source['id']} — {source['name']}")

    if source.get("blocked"):
        result.status = "blocked"
        result.note(f"BLOCKED: {source['blocked']}")
        return result

    dest = RAW_DIR / source["id"]
    try:
        files = [
            {
                "filename": f["filename"],
                "url": f["url"],
                "size": f.get("expected_bytes"),
                "expected_sha256": f.get("expected_sha256"),
            }
            for f in source["files"]
        ]

        for entry in files:
            archive_path = ARCHIVE_DIR / source["id"] / entry["filename"]
            if archive_path.exists():
                result.note(f"archive present, skipping download: {entry['filename']}")
            elif verify_only:
                result.note(f"verify-only: would download {entry['filename']}")
                continue
            else:
                transport = "curl" if shutil.which("curl") else "requests"
                print(f"    ↓ {entry['filename']} (via {transport})", flush=True)
                if transport == "curl":
                    download_with_curl(entry["url"], archive_path)
                else:
                    download(session, entry["url"], archive_path, entry.get("size"))

            digest = sha256_file(archive_path)
            size = archive_path.stat().st_size

            # Integrity gates: a mismatch is reported loudly, never absorbed.
            expected_hash = entry.get("expected_sha256")
            if expected_hash and digest != expected_hash:
                raise ValueError(
                    f"checksum mismatch for {entry['filename']}: "
                    f"expected {expected_hash[:16]}… got {digest[:16]}…"
                )
            expected_size = entry.get("size")
            if expected_size and size != expected_size:
                result.note(
                    f"WARNING size differs from published: expected {human(expected_size)}, got {human(size)}"
                )
            if expected_hash:
                result.note("checksum matches published value")

            result.archives.append(
                {
                    "filename": entry["filename"],
                    "url": entry["url"],
                    "bytes": size,
                    "sha256": digest,
                    "downloaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                }
            )
            result.note(f"{entry['filename']}: {human(size)} sha256={digest[:16]}…")

            marker = dest / ".extracted"
            if marker.exists():
                result.note("already extracted, skipping")
            else:
                count, renamed = safe_extract(archive_path, dest)
                marker.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
                result.renamed_files += renamed
                result.note(
                    f"extracted {count} entries safely"
                    + (f"; {renamed} renamed for filesystem compatibility" if renamed else "")
                )

        if dest.exists():
            extract_nested(dest, result)
            inventory(dest, result)
            result.status = "ok"
        elif verify_only:
            result.status = "skipped"
        else:
            result.status = "failed"
            result.note("nothing extracted")

    except Exception as exc:  # noqa: BLE001 - acquisition must report, not crash the run
        result.status = "failed"
        result.note(f"ERROR: {type(exc).__name__}: {exc}")

    return result


def main() -> int:
    # Windows consoles default to cp1252 and would crash on the box-drawing and
    # arrow characters below; degrade gracefully rather than lose a long download.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass

    parser = argparse.ArgumentParser(description="Acquire crop-health source datasets (P0-4)")
    parser.add_argument("--only", action="append", help="limit to these source keys")
    parser.add_argument("--list", action="store_true", help="list the registry and exit")
    parser.add_argument("--verify-only", action="store_true", help="no downloads; inventory only")
    args = parser.parse_args()

    registry = json.loads(SOURCES_PATH.read_text(encoding="utf-8"))
    sources = registry["sources"]

    if args.list:
        for source in sources:
            state = "BLOCKED" if source.get("blocked") else f"{len(source.get('files', []))} file(s)"
            print(f"{source['id']:<22} {state:<12} {source['name']}")
        return 0

    if args.only:
        sources = [s for s in sources if s["id"] in args.only]
        if not sources:
            print("no matching source keys", file=sys.stderr)
            return 2

    for directory in (RAW_DIR, ARCHIVE_DIR, LICENSE_DIR):
        directory.mkdir(parents=True, exist_ok=True)

    session = http_session()
    results = [acquire(source, session, args.verify_only) for source in sources]

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generator": "scripts/ml/download_datasets.py",
        "registry_version": registry.get("version"),
        "datasets": [
            {
                "id": r.key,
                "name": r.name,
                "status": r.status,
                "archives": r.archives,
                "extracted_files": r.extracted_files,
                "image_files": r.image_files,
                "sample_decoded": r.sample_decoded,
                "corrupt_files": r.corrupt_files,
                "renamed_for_filesystem": r.renamed_files,
                "nested_archives_extracted": r.nested_extracted,
                "macos_stubs_ignored": r.macos_stubs_ignored,
                "top_level_dirs": r.top_level_dirs,
                "bytes_on_disk": r.bytes_on_disk,
                "notes": r.notes,
            }
            for r in results
        ],
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    print("\n" + "─" * 72)
    print(f"{'dataset':<22} {'status':<9} {'files':>8} {'images':>8} {'size':>10}")
    print("─" * 72)
    for r in results:
        print(
            f"{r.key:<22} {r.status:<9} {r.extracted_files:>8} {r.image_files:>8} {human(r.bytes_on_disk):>10}"
        )
    print("─" * 72)
    print(f"manifest → {MANIFEST_PATH.relative_to(REPO_ROOT)}")

    failed = [r.key for r in results if r.status == "failed"]
    blocked = [r.key for r in results if r.status == "blocked"]
    if blocked:
        print(f"BLOCKED (documented, not fatal): {', '.join(blocked)}")
    if failed:
        print(f"FAILED: {', '.join(failed)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
