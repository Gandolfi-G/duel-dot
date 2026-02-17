#!/usr/bin/env python3
"""Generate a simple PDF from a markdown file without external dependencies."""

from __future__ import annotations

import re
import sys
import textwrap
from pathlib import Path

PAGE_WIDTH = 595
PAGE_HEIGHT = 842
MARGIN_LEFT = 50
MARGIN_TOP = 50
MARGIN_BOTTOM = 50
FONT_SIZE = 10
LINE_HEIGHT = 14
MAX_CHARS_PER_LINE = 94
LINES_PER_PAGE = (PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM) // LINE_HEIGHT


def to_latin1(value: str) -> str:
    return value.encode("latin-1", errors="replace").decode("latin-1")


def pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def wrap_text(text: str, width: int) -> list[str]:
    wrapped = textwrap.wrap(
        text,
        width=width,
        break_long_words=True,
        break_on_hyphens=False,
        replace_whitespace=False,
        drop_whitespace=True,
    )
    return wrapped if wrapped else [""]


def markdown_to_lines(markdown: str) -> list[str]:
    lines: list[str] = []
    in_code_block = False

    for raw in markdown.splitlines():
        line = raw.rstrip()
        stripped = line.strip()

        if stripped.startswith("```"):
            in_code_block = not in_code_block
            lines.append("")
            continue

        if in_code_block:
            code_line = line if line else ""
            for wrapped in wrap_text(code_line, MAX_CHARS_PER_LINE - 4):
                lines.append(f"    {wrapped}" if wrapped else "")
            continue

        if not stripped:
            lines.append("")
            continue

        heading = re.match(r"^(#{1,6})\s+(.*)$", line)
        if heading:
            title = heading.group(2).strip().upper()
            if lines and lines[-1] != "":
                lines.append("")
            lines.extend(wrap_text(title, MAX_CHARS_PER_LINE))
            lines.append("")
            continue

        bullet = re.match(r"^(\s*[-*])\s+(.*)$", line)
        if bullet:
            body = bullet.group(2).strip()
            prefix = "- "
            body_lines = wrap_text(body, MAX_CHARS_PER_LINE - len(prefix))
            for index, chunk in enumerate(body_lines):
                lines.append((prefix if index == 0 else " " * len(prefix)) + chunk)
            continue

        numbered = re.match(r"^(\s*\d+\.)\s+(.*)$", line)
        if numbered:
            prefix = f"{numbered.group(1)} "
            body = numbered.group(2).strip()
            body_lines = wrap_text(body, MAX_CHARS_PER_LINE - len(prefix))
            for index, chunk in enumerate(body_lines):
                lines.append((prefix if index == 0 else " " * len(prefix)) + chunk)
            continue

        lines.extend(wrap_text(stripped, MAX_CHARS_PER_LINE))

    while lines and lines[-1] == "":
        lines.pop()

    return lines


def paginate(lines: list[str], lines_per_page: int) -> list[list[str]]:
    if not lines:
        return [[""]]
    return [lines[index : index + lines_per_page] for index in range(0, len(lines), lines_per_page)]


def build_page_stream(page_lines: list[str]) -> bytes:
    commands = [
        "BT",
        f"/F1 {FONT_SIZE} Tf",
        f"1 0 0 1 {MARGIN_LEFT} {PAGE_HEIGHT - MARGIN_TOP} Tm",
        f"{LINE_HEIGHT} TL",
    ]

    for line in page_lines:
        safe = pdf_escape(to_latin1(line))
        commands.append(f"({safe}) Tj")
        commands.append("T*")

    commands.append("ET")
    return ("\n".join(commands) + "\n").encode("latin-1")


def generate_pdf(pages: list[list[str]], output_path: Path) -> None:
    objects: dict[int, bytes] = {}

    objects[3] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

    page_ids: list[int] = []
    max_object_id = 3

    for page in pages:
        page_id = max_object_id + 1
        content_id = max_object_id + 2

        stream = build_page_stream(page)
        objects[content_id] = (
            f"<< /Length {len(stream)} >>\nstream\n".encode("latin-1")
            + stream
            + b"endstream"
        )
        objects[page_id] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>"
        ).encode("latin-1")

        page_ids.append(page_id)
        max_object_id = content_id

    kids = " ".join(f"{page_id} 0 R" for page_id in page_ids)
    objects[2] = f"<< /Type /Pages /Kids [ {kids} ] /Count {len(page_ids)} >>".encode("latin-1")
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"

    output = bytearray()
    output.extend(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")

    offsets = [0] * (max_object_id + 1)
    for object_id in range(1, max_object_id + 1):
        offsets[object_id] = len(output)
        output.extend(f"{object_id} 0 obj\n".encode("latin-1"))
        output.extend(objects[object_id])
        output.extend(b"\nendobj\n")

    xref_offset = len(output)
    output.extend(f"xref\n0 {max_object_id + 1}\n".encode("latin-1"))
    output.extend(b"0000000000 65535 f \n")

    for object_id in range(1, max_object_id + 1):
        output.extend(f"{offsets[object_id]:010d} 00000 n \n".encode("latin-1"))

    output.extend(
        (
            f"trailer\n<< /Size {max_object_id + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        ).encode("latin-1")
    )

    output_path.write_bytes(output)


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: python3 scripts/generate_deployment_pdf.py <input.md> <output.pdf>")
        return 1

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    if not input_path.exists():
        print(f"Input file not found: {input_path}")
        return 1

    markdown = input_path.read_text(encoding="utf-8")
    lines = markdown_to_lines(markdown)
    pages = paginate(lines, int(LINES_PER_PAGE))
    generate_pdf(pages, output_path)

    print(f"PDF generated: {output_path} ({len(pages)} pages)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
