"""CLI-level tests for scripts/validate_export.py."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from earthpulse.export import EXPORT_SCHEMA_VERSION, WEB_DATA_DIR

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "validate_export.py"
EXPORT_SCRIPT = ROOT / "scripts" / "p_export.py"


def _run(folder: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(folder), *extra],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_cli_fails_for_missing_folder(tmp_path: Path) -> None:
    result = _run(tmp_path / "does_not_exist")
    assert result.returncode == 1
    assert "VALIDATION FAILED" in result.stdout
    assert "folder does not exist" in result.stdout


def test_cli_reports_contract_key_errors(tmp_path: Path) -> None:
    folder = tmp_path / "broken"
    folder.mkdir()
    (folder / "index.json").write_text("{}", encoding="utf-8")

    result = _run(folder)
    assert result.returncode == 1
    assert "index.json: missing keys" in result.stdout
    assert "Files:" in result.stdout


def test_cli_release_reports_synthetic_flag(tmp_path: Path) -> None:
    folder = tmp_path / "synthetic"
    folder.mkdir()
    (folder / "index.json").write_text(
        json.dumps({"synthetic": True}), encoding="utf-8"
    )

    result = _run(folder, "--release")
    assert result.returncode == 1
    assert "release check failed" in result.stdout
    assert "Synthetic flag present: yes" in result.stdout


def test_cli_publish_only_fails_for_missing_export(tmp_path: Path) -> None:
    result = subprocess.run(
        [
            sys.executable,
            str(EXPORT_SCRIPT),
            "--publish-only",
            "--out",
            str(tmp_path / "missing"),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 1
    assert "PUBLISH FAILED" in result.stderr


@pytest.mark.skipif(
    not (WEB_DATA_DIR / "index.json").is_file(),
    reason="web/public/data mock folder is not present",
)
def test_cli_on_current_mock_folder() -> None:
    """The current published folder must validate for the current schema."""
    index = json.loads((WEB_DATA_DIR / "index.json").read_text(encoding="utf-8"))
    if index.get("schema_version") != EXPORT_SCHEMA_VERSION:
        pytest.skip(
            "published folder is still "
            f"{index.get('schema_version')!r}; P14 T3 publishes {EXPORT_SCHEMA_VERSION!r}"
        )

    result = _run(WEB_DATA_DIR)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "VALIDATION PASSED" in result.stdout
    assert "Files:" in result.stdout

    release = _run(WEB_DATA_DIR, "--release")
    if index.get("synthetic") is True:
        assert release.returncode == 1
        assert "release check failed" in release.stdout
    else:
        assert release.returncode == 0
