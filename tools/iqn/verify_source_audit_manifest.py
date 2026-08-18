#!/usr/bin/env python3
"""Verify the tracked IQN source-audit manifest and review artifacts."""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = REPOSITORY_ROOT / "docs/iqn/source-audit-manifest.json"
IQN02_ARTIFACT_DIRECTORY = (
    REPOSITORY_ROOT / "docs/iqn/extracted/iqn02-review-candidates"
)
EXPECTED_ARTIFACTS = {
    "REPORT.md",
    "recurrence.csv",
    "resource-norms.json",
    "resource-requirements.csv",
    "standard-machinery.json",
    "summary.json",
    "time-norms.csv",
    "work-topics.json",
}
EXPECTED_IQN02_SOURCE_SHA256 = (
    "443c90d65d7c1ab1f08e0365360e3547295ca6a967d57ef51df6e6af04dc8177"
)
EXPECTED_IQN03_SOURCE_SHA256 = (
    "f2c40f1d7365139ece6618be4f767dba546aab7685439d9f524e1a2cb3ae3b1e"
)
EXPECTED_IQN03_LAYOUT_SHA256 = (
    "a7fa302a96be2e507a0a3e24d0658b52aaed1f2afa769e72573878edb51cb07a"
)
EXPECTED_IQN03_COUNTS = {
    "pages": 51,
    "blocks": 1218,
    "text_blocks": 1178,
    "tables": 40,
    "table_rows": 573,
    "table_cell_slots": 4444,
    "non_placeholder_cells": 2916,
    "words": 13376,
}
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
EMPTY_SOURCE_VALUES = {"", "-", "—"}


class VerificationError(RuntimeError):
    """Raised when a tracked source-audit invariant is broken."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise VerificationError(message)


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exception:
        raise VerificationError(f"Cannot read valid JSON from {path}: {exception}") from exception


def read_csv(path: Path) -> list[dict[str, str]]:
    try:
        with path.open(encoding="utf-8-sig", newline="") as stream:
            return list(csv.DictReader(stream))
    except (OSError, UnicodeError, csv.Error) as exception:
        raise VerificationError(f"Cannot read valid CSV from {path}: {exception}") from exception


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exception:
        raise VerificationError(f"Cannot hash {path}: {exception}") from exception
    return digest.hexdigest()


def verify_artifact_hashes(iqn02: dict[str, Any]) -> None:
    candidate_artifacts = iqn02["candidate_artifacts"]
    require(
        candidate_artifacts["status"] == "review_candidates_not_approved_norms",
        "IQN 02 artifacts must remain explicitly non-operational review candidates.",
    )
    entries = candidate_artifacts["files"]
    require(isinstance(entries, list), "IQN 02 artifact manifest must contain a files list.")

    names: list[str] = []
    for entry in entries:
        require(isinstance(entry, dict), "Every IQN 02 artifact entry must be an object.")
        name = entry.get("path")
        expected_hash = entry.get("sha256")
        require(isinstance(name, str), "Every IQN 02 artifact must have a string path.")
        relative_path = PurePosixPath(name)
        require(
            not relative_path.is_absolute()
            and ".." not in relative_path.parts
            and len(relative_path.parts) == 1,
            f"Unsafe IQN 02 artifact path: {name!r}.",
        )
        require(
            isinstance(expected_hash, str) and SHA256_PATTERN.fullmatch(expected_hash) is not None,
            f"Invalid SHA-256 in the manifest for {name}.",
        )
        artifact_path = IQN02_ARTIFACT_DIRECTORY / name
        require(artifact_path.is_file(), f"Manifest artifact is missing: {artifact_path}.")
        require(
            sha256(artifact_path) == expected_hash,
            f"SHA-256 mismatch for {artifact_path}.",
        )
        names.append(name)

    require(len(names) == len(set(names)), "IQN 02 artifact manifest contains duplicate paths.")
    require(
        set(names) == EXPECTED_ARTIFACTS,
        "IQN 02 artifact manifest must list the complete expected review-artifact set.",
    )


def verify_iqn02_counts(iqn02: dict[str, Any]) -> None:
    coverage = iqn02["review_candidate_coverage"]
    summary = read_json(IQN02_ARTIFACT_DIRECTORY / "summary.json")
    topics_document = read_json(IQN02_ARTIFACT_DIRECTORY / "work-topics.json")
    time_rows = read_csv(IQN02_ARTIFACT_DIRECTORY / "time-norms.csv")
    recurrence_rows = read_csv(IQN02_ARTIFACT_DIRECTORY / "recurrence.csv")
    requirement_rows = read_csv(IQN02_ARTIFACT_DIRECTORY / "resource-requirements.csv")
    machinery = read_json(IQN02_ARTIFACT_DIRECTORY / "standard-machinery.json")
    resource_norms = read_json(IQN02_ARTIFACT_DIRECTORY / "resource-norms.json")

    require(isinstance(summary, dict), "IQN 02 summary must be a JSON object.")
    require(isinstance(topics_document, dict), "IQN 02 work topics must be a JSON object.")
    require(isinstance(machinery, list), "IQN 02 standard machinery must be a JSON list.")
    require(isinstance(resource_norms, list), "IQN 02 resource norms must be a JSON list.")

    time_catalog = summary["time_norm_catalog"]
    appendices = summary["appendices"]
    resource_catalog = summary["resource_estimate_catalog"]
    topics = topics_document["topics"]
    summary_topics = summary["time_norm_tables"]

    require(iqn02["approved_source_sha256"] == EXPECTED_IQN02_SOURCE_SHA256, "Unexpected IQN 02 source hash.")
    require(topics_document["source_sha256"] == EXPECTED_IQN02_SOURCE_SHA256, "IQN 02 topic source hash mismatch.")
    require(topics_document["status"] == "expert_review_candidates_not_approved", "IQN 02 topic candidates lost their review-only status.")
    require(topics_document["expected_topic_count"] == 29, "IQN 02 expected topic count must be 29.")
    require(isinstance(topics, list) and len(topics) == 29, "IQN 02 must contain exactly 29 work-topic candidates.")
    require(isinstance(summary_topics, list) and len(summary_topics) == 29, "IQN 02 summary must contain exactly 29 time-norm tables.")
    require([topic["topic_number"] for topic in topics] == list(range(1, 30)), "IQN 02 topic numbers must be exactly 1 through 29 in order.")

    for topic, summary_topic in zip(topics, summary_topics, strict=True):
        require(topic["catalog_role"] == "manual_inspection_topic", f"Topic {topic['topic_number']} has an invalid catalog role.")
        require(topic["review_state"] == "pending", f"Topic {topic['topic_number']} must remain pending expert review.")
        require(
            (
                topic["topic_number"],
                topic["raw_title"],
                topic["source_table_index"],
                topic["rendered_pdf_page"],
                topic["rows_including_headers"],
                topic["candidate_value_rows"],
            )
            == (
                summary_topic["table_no"],
                summary_topic["title"],
                summary_topic["source_table_index"],
                summary_topic["pdf_page"],
                summary_topic["rows_including_headers"],
                summary_topic["value_rows"],
            ),
            f"Topic {topic['topic_number']} does not match the IQN 02 structural summary.",
        )

    time_rows_with_value = sum(
        bool(row["time_norm_raw_person_hours"].strip()) for row in time_rows
    )
    explicit_time_codes = {
        row["explicit_code"].strip() for row in time_rows if row["explicit_code"].strip()
    }
    require(len(time_rows) == coverage["time_norm_rows_preserved"] == time_catalog["rows_preserved"], "IQN 02 preserved time-row count mismatch.")
    require(time_rows_with_value == coverage["time_norm_rows_with_value"] == time_catalog["rows_with_time_value"], "IQN 02 valued time-row count mismatch.")
    require(len(explicit_time_codes) == coverage["distinct_explicit_time_norm_codes"] == time_catalog["distinct_explicit_codes"], "IQN 02 explicit time-code count mismatch.")
    require(len(summary_topics) == coverage["time_norm_source_tables"], "IQN 02 source table count mismatch.")

    recurrence_groups = list(dict.fromkeys(row["group"] for row in recurrence_rows))
    require(len(recurrence_rows) == coverage["recurrence_work_rows"] == appendices["recurrence_work_rows"], "IQN 02 recurrence row count mismatch.")
    require(recurrence_groups == appendices["recurrence_groups"], "IQN 02 recurrence groups do not match the summary.")
    require(len(machinery) == coverage["standard_machinery_rows"] == appendices["standard_machinery_rows"], "IQN 02 machinery row count mismatch.")

    summary_norm_codes = resource_catalog["norm_codes"]
    artifact_norm_codes = {
        code for norm in resource_norms for code in norm["norm_codes_canonical"]
    }
    require(len(resource_norms) == coverage["resource_source_tables"] == resource_catalog["source_tables"], "IQN 02 resource table count mismatch.")
    require(len(summary_norm_codes) == len(set(summary_norm_codes)), "IQN 02 summary contains duplicate canonical norm codes.")
    require(set(summary_norm_codes) == artifact_norm_codes, "IQN 02 canonical resource norm codes disagree across artifacts.")
    require(len(artifact_norm_codes) == coverage["distinct_resource_norm_variants"] == resource_catalog["distinct_norm_variants"], "IQN 02 resource norm variant count mismatch.")
    require(len(requirement_rows) == coverage["resource_requirement_records"] == resource_catalog["requirement_records"], "IQN 02 resource requirement count mismatch.")

    requirement_fields = (
        "source_table_index",
        "source_row",
        "norm_code",
        "resource_category",
        "resource_code",
        "resource_name",
        "unit_raw",
        "quantity_per_work_unit_raw",
    )

    def requirement_signature(row: dict[str, Any]) -> tuple[str, ...]:
        return tuple(str(row[field]) for field in requirement_fields)

    json_requirement_rows = [
        requirement
        for norm in resource_norms
        for requirement in norm["requirements"]
    ]
    csv_requirement_signatures = [requirement_signature(row) for row in requirement_rows]
    json_requirement_signatures = [
        requirement_signature(row) for row in json_requirement_rows
    ]
    require(
        json_requirement_signatures == csv_requirement_signatures,
        "IQN 02 JSON and CSV resource requirements must match exactly and in source order.",
    )
    require(
        len(csv_requirement_signatures) == len(set(csv_requirement_signatures)),
        "IQN 02 resource requirements contain duplicate source-line records.",
    )

    empty_payload_fields = (
        "resource_code",
        "resource_name",
        "unit_raw",
        "quantity_per_work_unit_raw",
    )
    require(
        not any(
            all(row[field].strip() == "" for field in empty_payload_fields)
            for row in requirement_rows
        ),
        "IQN 02 derived resource views must not manufacture requirements from entirely empty source rows.",
    )

    expected_43796_requirements = {
        (
            "43", "4", "27-14-021-01", "material", "43796",
            "Тоғ жинсларини майдалашдаги чиқинди материаллар", "м3", "0,204",
        ),
        (
            "44", "6", "27-14-022-01", "material", "43796",
            "Тоғ жинсларини майдалашдаги чиқинди материаллар", "М3", "20,4",
        ),
        (
            "47", "11", "27-14-025-01", "material", "43796",
            "Тоғ жинсларини майдалашдаги чиқинди материаллар", "М3", "1,3",
        ),
        (
            "47", "11", "27-14-025-02", "material", "43796",
            "Тоғ жинсларини майдалашдаги чиқинди материаллар", "М3", "1,3",
        ),
    }
    actual_43796_requirements = {
        requirement_signature(row)
        for row in requirement_rows
        if row["resource_code"] == "43796"
    }
    require(
        actual_43796_requirements == expected_43796_requirements,
        "IQN 02 resource 43796 must preserve all four source requirements.",
    )

    nonblank_by_category: dict[str, int] = {}
    for row in requirement_rows:
        category = row["resource_category"]
        if row["quantity_per_work_unit_raw"].strip() not in EMPTY_SOURCE_VALUES:
            nonblank_by_category[category] = nonblank_by_category.get(category, 0) + 1
    require(nonblank_by_category == resource_catalog["nonblank_quantity_records_by_category"], "IQN 02 nonblank resource quantities do not match the summary.")

    distinct_resource_codes: dict[str, int] = {}
    for category in ("machine", "material"):
        codes = {
            row["resource_code"].strip()
            for row in requirement_rows
            if row["resource_category"] == category
            and row["resource_code"].strip() not in EMPTY_SOURCE_VALUES
        }
        distinct_resource_codes[category] = len(codes)
    require(distinct_resource_codes == resource_catalog["distinct_resource_codes_by_category"], "IQN 02 resource-code counts do not match the summary.")
    require(distinct_resource_codes["machine"] == coverage["distinct_machine_resource_codes"], "IQN 02 machine-code count mismatch.")
    require(distinct_resource_codes["material"] == coverage["distinct_material_resource_codes"], "IQN 02 material-code count mismatch.")
    require(len(summary["source_anomalies"]) == coverage["documented_source_anomalies"], "IQN 02 source-anomaly count mismatch.")


def verify_iqn03(iqn03: dict[str, Any]) -> None:
    require(iqn03["approved_source_sha256"] == EXPECTED_IQN03_SOURCE_SHA256, "Unexpected IQN 03 source hash.")
    layout_contract = iqn03["approved_layout_contract"]
    schema_path = REPOSITORY_ROOT / layout_contract["schema"]
    require(schema_path.is_file(), f"IQN 03 layout schema is missing: {schema_path}.")
    require(isinstance(read_json(schema_path), dict), "IQN 03 layout schema must be a JSON object.")

    extraction = iqn03["reference_extraction"]
    require(extraction["layout_json_sha256"] == EXPECTED_IQN03_LAYOUT_SHA256, "Unexpected IQN 03 reference layout hash.")
    require(extraction["layout_json_tracked"] is False, "IQN 03 review layout must not be represented as a tracked approved norm.")
    for key, expected in EXPECTED_IQN03_COUNTS.items():
        require(extraction[key] == expected, f"IQN 03 reference count mismatch for {key}.")
    require(extraction["blocks"] == extraction["text_blocks"] + extraction["tables"], "IQN 03 block totals are inconsistent.")
    require(extraction["non_placeholder_cells"] <= extraction["table_cell_slots"], "IQN 03 populated cell count exceeds all cell slots.")
    require(iqn03["pdf_metadata"]["pages"] == extraction["pages"], "IQN 03 PDF and layout page counts disagree.")


def main() -> int:
    try:
        manifest = read_json(MANIFEST_PATH)
        require(isinstance(manifest, dict), "Source-audit manifest must be a JSON object.")
        require(manifest["schema_version"] == "roadops-iqn-source-audit-v1", "Unexpected source-audit manifest schema version.")
        policy = manifest["policy"]
        require(policy["operational_use"] == "expert_approval_required", "Source-audit policy must require expert approval.")
        sources = manifest["sources"]
        iqn02 = sources["iqn_02_24"]
        iqn03 = sources["iqn_03_24"]
        verify_artifact_hashes(iqn02)
        verify_iqn02_counts(iqn02)
        verify_iqn03(iqn03)
    except (KeyError, TypeError, VerificationError) as exception:
        print(f"IQN source-audit verification failed: {exception}", file=sys.stderr)
        return 1

    print(
        "IQN source-audit verified: 8 artifacts, 29 topics, "
        f"667 time rows, {iqn02['review_candidate_coverage']['resource_requirement_records']} "
        "resource records, 51 IQN 03 pages."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
