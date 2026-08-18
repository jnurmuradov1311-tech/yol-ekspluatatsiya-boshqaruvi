#!/usr/bin/env python3
"""Offline IQN 03 PDF layout capture for review staging.

This utility has no application-runtime role. Run it in an isolated analyst
environment with ``pdfplumber`` installed, inspect the JSON/rendered PDF, and
then pass the JSON to ``roadops:iqn03-layout-stage``. It captures layout; it
does not infer or approve operational norms.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import Any

try:
    import pdfplumber
except ImportError as exc:  # pragma: no cover - depends on analyst workstation
    raise SystemExit(
        "pdfplumber is required only for this offline extraction step; "
        "install it in an isolated analyst environment."
    ) from exc


APPROVED_SOURCE_SHA256 = (
    "f2c40f1d7365139ece6618be4f767dba546aab7685439d9f524e1a2cb3ae3b1e"
)
APPROVED_PAGE_COUNT = 51
SCHEMA_VERSION = "iqn03-layout-json-v1"
COORDINATE_SYSTEM = "pdfplumber-top-origin-points"


def number(value: float | int) -> float | int:
    """Round detector noise while retaining integer coordinates as integers."""
    rounded = round(float(value), 6)
    return int(rounded) if rounded.is_integer() else rounded


def box(value: Iterable[float | int]) -> list[float | int]:
    return [number(coordinate) for coordinate in value]


def area(value: Iterable[float | int]) -> float:
    x0, top, x1, bottom = [float(coordinate) for coordinate in value]
    return max(0.0, x1 - x0) * max(0.0, bottom - top)


def contains(value: Iterable[float | int], x: float, y: float) -> bool:
    x0, top, x1, bottom = [float(coordinate) for coordinate in value]
    return x0 - 0.01 <= x <= x1 + 0.01 and top - 0.01 <= y <= bottom + 0.01


def overlaps(left: Iterable[float | int], right: Iterable[float | int]) -> bool:
    lx0, ltop, lx1, lbottom = [float(coordinate) for coordinate in left]
    rx0, rtop, rx1, rbottom = [float(coordinate) for coordinate in right]
    return min(lx1, rx1) > max(lx0, rx0) and min(lbottom, rbottom) > max(ltop, rtop)


def union_box(values: Iterable[Iterable[float | int]]) -> list[float | int] | None:
    boxes = [[float(coordinate) for coordinate in value] for value in values]
    if not boxes:
        return None
    return box(
        [
            min(value[0] for value in boxes),
            min(value[1] for value in boxes),
            max(value[2] for value in boxes),
            max(value[3] for value in boxes),
        ]
    )


def display_text(words: list[dict[str, Any]], line_tolerance: float) -> str:
    """Render a deterministic text view without changing the captured words."""
    if not words:
        return ""
    ordered = sorted(words, key=lambda word: (float(word["bbox"][1]), float(word["bbox"][0])))
    lines: list[list[dict[str, Any]]] = []
    for word in ordered:
        top = float(word["bbox"][1])
        if not lines:
            lines.append([word])
            continue
        line_top = sum(float(item["bbox"][1]) for item in lines[-1]) / len(lines[-1])
        if abs(top - line_top) <= line_tolerance:
            lines[-1].append(word)
        else:
            lines.append([word])
    return "\n".join(
        " ".join(str(word["text"]) for word in sorted(line, key=lambda item: float(item["bbox"][0])))
        for line in lines
    )


def captured_word(raw: dict[str, Any], sequence: int) -> dict[str, Any]:
    return {
        "word_sequence": sequence,
        "text": str(raw.get("text", "")),
        "bbox": box([raw["x0"], raw["top"], raw["x1"], raw["bottom"]]),
        "doctop": number(raw.get("doctop", raw["top"])),
        "upright": bool(raw.get("upright", True)),
        "direction": raw.get("direction") if isinstance(raw.get("direction"), str) else None,
    }


def group_text_lines(
    words: list[dict[str, Any]],
    line_tolerance: float,
) -> list[dict[str, Any]]:
    ordered = sorted(words, key=lambda word: (float(word["bbox"][1]), float(word["bbox"][0])))
    lines: list[list[dict[str, Any]]] = []
    for word in ordered:
        top = float(word["bbox"][1])
        if not lines:
            lines.append([word])
            continue
        line_top = sum(float(item["bbox"][1]) for item in lines[-1]) / len(lines[-1])
        if abs(top - line_top) <= line_tolerance:
            lines[-1].append(word)
        else:
            lines.append([word])

    blocks = []
    for line in lines:
        line.sort(key=lambda word: float(word["bbox"][0]))
        blocks.append(
            {
                "block_kind": "text",
                "bbox": union_box(word["bbox"] for word in line),
                "raw_text": " ".join(str(word["text"]) for word in line),
                "words": line,
                "ambiguity_flags": [],
            }
        )
    return blocks


def table_block(
    table: Any,
    table_index: int,
    assigned_words: list[dict[str, Any]],
    line_tolerance: float,
    overlapping: bool,
) -> dict[str, Any]:
    row_cells = [list(row.cells) for row in table.rows]
    destinations: list[tuple[float, int, int, list[float | int]]] = []
    for row_index, cells in enumerate(row_cells):
        for column_index, cell_bbox in enumerate(cells):
            if cell_bbox is not None:
                captured_bbox = box(cell_bbox)
                destinations.append((area(captured_bbox), row_index, column_index, captured_bbox))

    words_by_cell: dict[tuple[int, int], list[dict[str, Any]]] = {}
    orphan_words: list[dict[str, Any]] = []
    for word in assigned_words:
        x0, top, x1, bottom = [float(value) for value in word["bbox"]]
        center_x = (x0 + x1) / 2
        center_y = (top + bottom) / 2
        candidates = [candidate for candidate in destinations if contains(candidate[3], center_x, center_y)]
        if not candidates:
            orphan_words.append(word)
            continue
        _, row_index, column_index, _ = min(candidates, key=lambda candidate: candidate[0])
        words_by_cell.setdefault((row_index, column_index), []).append(word)

    rows: list[dict[str, Any]] = []
    for row_offset, cells in enumerate(row_cells):
        output_cells: list[dict[str, Any]] = []
        row_flags: set[str] = set()
        for column_offset, cell_bbox in enumerate(cells):
            if cell_bbox is None:
                flags = ["PDF_MERGED_CELL_PLACEHOLDER"]
                row_flags.update(flags)
                output_cells.append(
                    {
                        "column_index": column_offset + 1,
                        "is_placeholder": True,
                        "bbox": None,
                        "raw_text": None,
                        "words": [],
                        "ambiguity_flags": flags,
                    }
                )
                continue
            words = words_by_cell.get((row_offset, column_offset), [])
            words.sort(key=lambda word: (float(word["bbox"][1]), float(word["bbox"][0])))
            output_cells.append(
                {
                    "column_index": column_offset + 1,
                    "is_placeholder": False,
                    "bbox": box(cell_bbox),
                    "raw_text": display_text(words, line_tolerance),
                    "words": words,
                    "ambiguity_flags": [],
                }
            )
        rows.append(
            {
                "row_index": row_offset + 1,
                "bbox": union_box(cell["bbox"] for cell in output_cells if cell["bbox"] is not None),
                "cells": output_cells,
                "ambiguity_flags": sorted(row_flags),
            }
        )

    block_flags: set[str] = set()
    if overlapping:
        block_flags.add("OVERLAPPING_TABLE_REGION")
    if orphan_words:
        block_flags.add("ORPHAN_TABLE_WORDS")
    raw_rows = []
    for row in rows:
        raw_rows.append("\t".join(cell["raw_text"] or "" for cell in row["cells"]))
    return {
        "block_kind": "table",
        "table_index": table_index,
        "bbox": box(table.bbox),
        "raw_text": "\n".join(raw_rows),
        "orphan_words": orphan_words,
        "rows": rows,
        "ambiguity_flags": sorted(block_flags),
    }


def extract(pdf_path: Path, line_tolerance: float) -> dict[str, Any]:
    source_bytes = pdf_path.read_bytes()
    source_sha256 = hashlib.sha256(source_bytes).hexdigest()
    if source_sha256 != APPROVED_SOURCE_SHA256:
        raise ValueError(
            "Refusing extraction: source SHA-256 is not the approved IQN 03-24 file "
            f"({source_sha256})."
        )
    version_match = re.match(br"%PDF-([0-9.]+)", source_bytes)
    if version_match is None:
        raise ValueError("Source does not have a valid PDF version envelope.")

    output_pages: list[dict[str, Any]] = []
    block_sequence = 0
    table_index = 0
    word_sequence = 0
    all_word_sequences: set[int] = set()

    with pdfplumber.open(pdf_path) as document:
        if len(document.pages) != APPROVED_PAGE_COUNT:
            raise ValueError(
                f"Approved IQN 03 source must have {APPROVED_PAGE_COUNT} pages; "
                f"pdfplumber found {len(document.pages)}."
            )
        for page_number, page in enumerate(document.pages, start=1):
            raw_words = page.extract_words(
                x_tolerance=3,
                y_tolerance=3,
                keep_blank_chars=False,
                use_text_flow=True,
            )
            page_words: list[dict[str, Any]] = []
            for raw_word in raw_words:
                word_sequence += 1
                page_words.append(captured_word(raw_word, word_sequence))
                all_word_sequences.add(word_sequence)

            tables = sorted(page.find_tables(), key=lambda table: (float(table.bbox[1]), float(table.bbox[0])))
            table_bboxes = [box(table.bbox) for table in tables]
            words_by_table: dict[int, list[dict[str, Any]]] = {index: [] for index in range(len(tables))}
            outside_words: list[dict[str, Any]] = []
            for word in page_words:
                x0, top, x1, bottom = [float(value) for value in word["bbox"]]
                center_x = (x0 + x1) / 2
                center_y = (top + bottom) / 2
                candidates = [
                    (area(table_bbox), index)
                    for index, table_bbox in enumerate(table_bboxes)
                    if contains(table_bbox, center_x, center_y)
                ]
                if not candidates:
                    outside_words.append(word)
                    continue
                _, selected = min(candidates)
                words_by_table[selected].append(word)

            page_blocks: list[dict[str, Any]] = group_text_lines(outside_words, line_tolerance)
            for local_index, table in enumerate(tables):
                table_index += 1
                overlapping = any(
                    local_index != other_index and overlaps(table_bboxes[local_index], other_bbox)
                    for other_index, other_bbox in enumerate(table_bboxes)
                )
                page_blocks.append(
                    table_block(
                        table,
                        table_index,
                        words_by_table[local_index],
                        line_tolerance,
                        overlapping,
                    )
                )
            page_blocks.sort(key=lambda block: (float(block["bbox"][1]), float(block["bbox"][0])))
            for block in page_blocks:
                block_sequence += 1
                block["block_sequence"] = block_sequence

            output_pages.append(
                {
                    "page_number": page_number,
                    "width": number(page.width),
                    "height": number(page.height),
                    "rotation": int(page.rotation or 0) % 360,
                    "blocks": page_blocks,
                }
            )

    staged_sequences: list[int] = []
    table_row_count = 0
    table_cell_slot_count = 0
    non_placeholder_cell_count = 0
    text_block_count = 0
    table_count = 0
    for page in output_pages:
        for block in page["blocks"]:
            if block["block_kind"] == "text":
                text_block_count += 1
                staged_sequences.extend(word["word_sequence"] for word in block["words"])
                continue
            table_count += 1
            staged_sequences.extend(word["word_sequence"] for word in block["orphan_words"])
            for row in block["rows"]:
                table_row_count += 1
                table_cell_slot_count += len(row["cells"])
                for cell in row["cells"]:
                    if not cell["is_placeholder"]:
                        non_placeholder_cell_count += 1
                    staged_sequences.extend(word["word_sequence"] for word in cell["words"])
    if sorted(staged_sequences) != sorted(all_word_sequences):
        raise RuntimeError("Internal extraction error: a PDF word was duplicated or omitted.")

    return {
        "schema_version": SCHEMA_VERSION,
        "document_kind": "iqn_03",
        "coordinate_system": COORDINATE_SYSTEM,
        "source": {
            "filename": pdf_path.name,
            "media_type": "application/pdf",
            "sha256": source_sha256,
            "page_count": APPROVED_PAGE_COUNT,
            "pdf_version": version_match.group(1).decode("ascii"),
        },
        "extractor": {
            "name": "roadops-pdfplumber-layout",
            "version": f"1.0.0+pdfplumber-{pdfplumber.__version__}",
        },
        "approval": {
            "layout_contract": "approved",
            "norm_interpretation": "expert_review_required",
        },
        "counts": {
            "page_count": APPROVED_PAGE_COUNT,
            "block_count": block_sequence,
            "text_block_count": text_block_count,
            "table_count": table_count,
            "table_row_count": table_row_count,
            "table_cell_slot_count": table_cell_slot_count,
            "non_placeholder_cell_count": non_placeholder_cell_count,
            "word_count": word_sequence,
        },
        "pages": output_pages,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path, help="approved IQN 03-24 PDF")
    parser.add_argument("output", type=Path, help="destination layout JSON")
    parser.add_argument(
        "--line-tolerance",
        type=float,
        default=3.0,
        help="top-coordinate tolerance in PDF points for grouping words (default: 3.0)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.line_tolerance <= 0:
        raise SystemExit("--line-tolerance must be positive")
    try:
        payload = extract(args.pdf, args.line_tolerance)
    except (OSError, ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(payload["counts"], ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
