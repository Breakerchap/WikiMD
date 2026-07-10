#!/usr/bin/env python3
"""
md_to_wmd_converter.py

Converts Google-Docs-exported Markdown into WMD.

This is not just syntax swapping. It uses common Google Docs export patterns:
- emoji H1 headings become WMD tabs
- repeated "emoji heading -> plain heading" duplicates are collapsed
- Google Docs/heading links become WMD wiki links where possible
- escaped Google Docs punctuation is normalised
- runs of "**Field:** value" lines become clean 2-column tables
- obvious broken headings and empty headings are removed or repaired
- 2-column "option tables" missing headers get "Name / Effect" headers

Usage:
  python md_to_wmd_converter.py input.md output.wmd
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import argparse
import re
import unicodedata
from typing import Iterable


DEFAULT_CONFIG = """@config
font: Arial, sans-serif
monoFont: Consolas, monospace
baseSize: 16px
titleSize: 3rem
h1Size: 2rem
h2Size: 1.5rem
h3Size: 1.25rem
lineHeight: 1.6
contentWidth: 900px
@endconfig
"""


KNOWN_SECTION_LABELS = {
  "Stats",
  "Skills",
  "Mastery",
  "Masteries",
  "Equipment",
  "Ability",
  "Abilities",
  "Actions",
  "Responses",
  "Subpaths",
  "Commands",
  "Features",
}

KNOWN_REAL_HEADERS = {
  "stat", "value", "cost", "level", "features", "name", "effect", "range",
  "attack score", "damage", "attribute", "attributes", "type", "energy cost",
  "act type", "trigger", "item", "required break", "required resources",
  "alteration", "allowed weapons", "weapon", "reach", "weight",
  "defence", "protection", "fatigue", "movement penalty", "category",
  "damage die", "property", "requirement", "skill", "margin cost",
  "momentum", "shadow form", "until the start of your next turn",
}


@dataclass
class Tab:
  raw_title: str
  title: str
  content: list[str] = field(default_factory=list)


def is_real_emoji(ch: str) -> bool:
  cp = ord(ch)
  # Exclude U+FFFC object replacement char; Google sometimes leaks it before text.
  if cp == 0xFFFC:
    return False

  return (
    0x1F000 <= cp <= 0x1FAFF or
    0x2600 <= cp <= 0x27BF or
    cp in (0xFE0F, 0x200D)
  )


def has_real_emoji(text: str) -> bool:
  return any(is_real_emoji(ch) for ch in text)


def strip_emoji_and_objects(text: str) -> str:
  out = []
  for ch in text:
    if ord(ch) == 0xFFFC:
      continue
    if is_real_emoji(ch):
      continue
    out.append(ch)
  return " ".join("".join(out).split()).strip()


def clean_heading_text(text: str) -> str:
  text = text.replace("\uFFFC", "")
  text = re.sub(r"\s*\{#[^}]+\}\s*$", "", text)
  text = text.strip()
  # Strip markdown emphasis that was only used inside exported heading titles.
  text = re.sub(r"^\*+|\*+$", "", text).strip()
  text = re.sub(r"^_+|_+$", "", text).strip()
  return text


def plain_text(text: str) -> str:
  text = text.replace("\uFFFC", "")
  text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
  text = re.sub(r"[*_`]", "", text)
  text = re.sub(r"\{#[^}]+\}", "", text)
  text = unescape_google_punctuation(text)
  return " ".join(text.split()).strip()


def slug(text: str) -> str:
  text = plain_text(text).lower()
  text = text.replace("&", "and")
  text = re.sub(r"[^a-z0-9]+", "-", text)
  return text.strip("-")


def normal_key(text: str) -> str:
  return slug(text)


def heading_match(line: str):
  return re.match(r"^(#{1,6})\s*(.*?)\s*$", line)


def heading_level_and_text(line: str):
  m = heading_match(line)
  if not m:
    return None
  return len(m.group(1)), clean_heading_text(m.group(2))


def unescape_google_punctuation(text: str) -> str:
  # Google Docs exports a lot of ordinary punctuation escaped as Markdown.
  replacements = {
    r"\+": "+",
    r"\-": "-",
    r"\=": "=",
    r"\.": ".",
    r"\,": ",",
    r"\(": "(",
    r"\)": ")",
    r"\[": "[",
    r"\]": "]",
    r"\{": "{",
    r"\}": "}",
    r"\#": "#",
    r"\!": "!",
    r"\?": "?",
    r"\~": "~",
  }
  for old, new in replacements.items():
    text = text.replace(old, new)
  return text


def read_source(path: Path) -> str:
  return path.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")


def find_next_nonblank(lines: list[str], start: int, limit: int = 3):
  end = min(len(lines), start + limit + 1)
  for j in range(start, end):
    if lines[j].strip():
      return j, lines[j]
  return None, None


def split_tabs(text: str) -> list[Tab]:
  lines = text.split("\n")
  tabs: list[Tab] = []
  current: Tab | None = None
  i = 0

  while i < len(lines):
    line = lines[i]
    ht = heading_level_and_text(line)

    if ht and ht[0] == 1 and has_real_emoji(ht[1]):
      raw = ht[1]
      title_from_emoji = strip_emoji_and_objects(raw) or plain_text(raw) or "Untitled"

      # Google Docs often exports:
      #   # 🧍 Character Creation
      #
      #   # Character Creation
      # Prefer the plain duplicate as the tab title, because it often fixes typos in the emoji line.
      next_idx, next_line = find_next_nonblank(lines, i + 1, limit=4)
      title = title_from_emoji
      skip_to = i + 1

      if next_line:
        next_ht = heading_level_and_text(next_line)
        if next_ht and next_ht[0] == 1 and not has_real_emoji(next_ht[1]):
          candidate = strip_emoji_and_objects(next_ht[1]) or plain_text(next_ht[1])
          if candidate:
            title = candidate
            skip_to = next_idx + 1

      current = Tab(raw_title=raw, title=title, content=[])
      tabs.append(current)
      i = skip_to
      continue

    if current is None:
      current = Tab(raw_title="Home", title="Home", content=[])
      tabs.append(current)

    # Remove duplicate plain H1 title immediately after a tab break.
    if ht and ht[0] == 1 and normal_key(ht[1]) == normal_key(current.title):
      # Only skip if this is still near the top of the tab.
      nonblank_so_far = [x for x in current.content if x.strip()]
      if len(nonblank_so_far) <= 1:
        i += 1
        continue

    current.content.append(line)
    i += 1

  return tabs


def build_heading_index(tabs: list[Tab]):
  title_to_dests: dict[str, list[tuple[str, str]]] = {}
  id_to_dest: dict[str, tuple[str, str]] = {}
  tab_to_title: dict[str, str] = {}

  for tab in tabs:
    tab_to_title[normal_key(tab.title)] = tab.title
    title_to_dests.setdefault(normal_key(tab.title), []).append((tab.title, ""))

    for line in tab.content:
      m = re.match(r"^(#{1,6})\s*(.*?)(?:\s*\{#([^}]+)\})?\s*$", line)
      if not m:
        continue
      raw_title = clean_heading_text(m.group(2))
      if not raw_title or set(raw_title) <= {"-", "—", "–"}:
        continue
      heading = strip_emoji_and_objects(raw_title) if has_real_emoji(raw_title) else raw_title
      heading = plain_text(heading)
      if not heading:
        continue
      title_to_dests.setdefault(normal_key(heading), []).append((tab.title, heading))
      id_to_dest[slug(heading)] = (tab.title, heading)
      if m.group(3):
        id_to_dest[m.group(3).strip().lower()] = (tab.title, heading)

  return title_to_dests, id_to_dest, tab_to_title


def clean_link_label(label: str) -> str:
  label = label.replace("\uFFFC", "")
  label = re.sub(r"^\*+", "", label)
  label = re.sub(r"\*+$", "", label)
  label = re.sub(r"^_+", "", label)
  label = re.sub(r"_+$", "", label)
  label = re.sub(r"`", "", label)
  return plain_text(label)


def make_wiki_link(tab: str, heading: str, label: str | None = None) -> str:
  if heading:
    target = f"{tab}#{heading}" if tab else heading
  else:
    target = tab
  if label and normal_key(label) != normal_key(heading or tab):
    return f"[[{target}|{label}]]"
  return f"[[{target}]]"


def resolve_md_link(label: str, url: str, current_tab: str, title_to_dests, id_to_dest, tab_to_title) -> str:
  label_clean = clean_link_label(label)
  if not label_clean:
    label_clean = "link"

  url = unescape_google_punctuation(url.strip())

  # Direct internal anchor: #skills, #base-stats, #heading=h.whatever, etc.
  anchor = ""
  if "#" in url:
    anchor = url.rsplit("#", 1)[1]
  elif url.startswith("#"):
    anchor = url[1:]

  anchor = anchor.strip()
  if anchor.startswith("heading="):
    anchor = anchor.split("=", 1)[1]

  # Empty Google Docs links often came from intra-doc links whose URL was lost.
  candidates = []

  if anchor:
    key = anchor.lower()
    if key in id_to_dest:
      candidates.append(id_to_dest[key])
    if slug(anchor) in id_to_dest:
      candidates.append(id_to_dest[slug(anchor)])

  label_key = normal_key(label_clean)
  if label_key in tab_to_title:
    candidates.append((tab_to_title[label_key], ""))
  if label_key in title_to_dests:
    candidates.extend(title_to_dests[label_key])

  # If the label is plural/singular different from a heading, try a soft match.
  if not candidates:
    singular = label_clean[:-1] if label_clean.lower().endswith("s") else label_clean + "s"
    if normal_key(singular) in title_to_dests:
      candidates.extend(title_to_dests[normal_key(singular)])

  # Prefer same-tab links, then unique-ish first match.
  chosen = None
  if candidates:
    for tab, heading in candidates:
      if tab == current_tab:
        chosen = (tab, heading)
        break
    if chosen is None:
      chosen = candidates[0]

  if chosen:
    tab, heading = chosen
    return make_wiki_link(tab, heading, label_clean)

  # External link: keep it as Markdown if it was a real external URL.
  if re.match(r"^[a-z]+://", url) and "docs.google.com" not in url:
    return f"[{label_clean}]({url})"

  # Fallback for unresolved Google Docs/internal links.
  return f"[[{label_clean}]]"


def convert_links(line: str, current_tab: str, title_to_dests, id_to_dest, tab_to_title) -> str:
  pattern = re.compile(r"\[([^\]]+)\]\(([^)]*)\)")

  def repl(m):
    return resolve_md_link(m.group(1), m.group(2), current_tab, title_to_dests, id_to_dest, tab_to_title)

  return pattern.sub(repl, line)


def convert_emphasis(line: str) -> str:
  # Protect inline code.
  protected: list[str] = []

  def protect(m):
    protected.append(m.group(0))
    return f"\uE100{len(protected) - 1}\uE101"

  line = re.sub(r"`[^`]*`", protect, line)

  bolds: list[str] = []

  def bold_repl(m):
    inner = m.group(1).strip()
    bolds.append(f"*{inner}*")
    return f"\uE200{len(bolds) - 1}\uE201"

  # WMD example uses *bold*, while Google Markdown uses **bold**.
  line = re.sub(r"\*\*([^*\n]+?)\*\*", bold_repl, line)

  # Convert Markdown italic *text* to WMD _text_. Avoid bullets and bold placeholders.
  line = re.sub(r"(?<![\w*])\*([^*\n]+?)\*(?![\w*])", lambda m: f"_{m.group(1).strip()}_", line)

  def restore_bold(m):
    return bolds[int(m.group(1))]

  line = re.sub(r"\uE200(\d+)\uE201", restore_bold, line)

  def restore_code(m):
    return protected[int(m.group(1))]

  line = re.sub(r"\uE100(\d+)\uE101", restore_code, line)
  return line


FIELD_LINE_RE = re.compile(r"^\s*\*\*([^:\n]{1,60}):\*\*\s*(.*?)\s*$")


def is_field_line(line: str) -> bool:
  return bool(FIELD_LINE_RE.match(line.strip()))


def field_line_to_row(line: str) -> tuple[str, str]:
  m = FIELD_LINE_RE.match(line.strip())
  assert m
  return m.group(1).strip(), m.group(2).strip()


def convert_field_blocks(lines: list[str]) -> list[str]:
  out: list[str] = []
  i = 0
  while i < len(lines):
    if not is_field_line(lines[i]):
      out.append(lines[i])
      i += 1
      continue

    rows = []
    start = i
    while i < len(lines) and is_field_line(lines[i]):
      rows.append(field_line_to_row(lines[i]))
      i += 1

    if len(rows) >= 2:
      out.append("| Field | Value |")
      out.append("| :---- | :---- |")
      for key, val in rows:
        out.append(f"| {key} | {val} |")
    else:
      out.extend(lines[start:i])

  return out


def table_cells(line: str) -> list[str]:
  stripped = line.strip()
  if not (stripped.startswith("|") and stripped.endswith("|")):
    return []
  return [cell.strip() for cell in stripped.strip("|").split("|")]


def is_align_row(line: str) -> bool:
  cells = table_cells(line)
  return bool(cells) and all(re.fullmatch(r":?-{3,}:?", c.strip()) for c in cells)


def is_missing_header_option_table(header_line: str, align_line: str) -> bool:
  if not is_align_row(align_line):
    return False
  cells = table_cells(header_line)
  if len(cells) != 2:
    return False
  first = normal_key(cells[0])
  second = normal_key(cells[1])

  # Real headers should stay real headers.
  if first in KNOWN_REAL_HEADERS or second in KNOWN_REAL_HEADERS:
    return False

  # If the "header" second cell is sentence-like, this is almost certainly a data row.
  second_raw = plain_text(cells[1])
  if len(second_raw) > 35 or second_raw.endswith("."):
    return True

  return False


def repair_missing_table_headers(lines: list[str]) -> list[str]:
  out: list[str] = []
  i = 0
  while i < len(lines):
    if i + 1 < len(lines) and table_cells(lines[i]) and is_missing_header_option_table(lines[i], lines[i + 1]):
      first_row = lines[i]
      out.append("| Name | Effect |")
      out.append("| :---- | :---- |")
      out.append(first_row)
      i += 2
      continue
    out.append(lines[i])
    i += 1
  return out


def is_probable_plain_origin_title(lines: list[str], i: int) -> bool:
  line = lines[i].strip()
  if not line or line.startswith(("#", "-", "|", "@", "!", ">", "`")):
    return False
  if len(line) > 50:
    return False
  if re.search(r"[.!?]$", line):
    return False
  # "Herbalist" style: standalone title followed by a Stats section.
  j = i + 1
  while j < len(lines) and not lines[j].strip():
    j += 1
  return j < len(lines) and re.match(r"^###\s+Stats\b", lines[j].strip()) is not None


def is_probable_level_ability(line: str) -> bool:
  s = line.strip()
  if len(s) > 80 or not s:
    return False
  if s.startswith(("#", "-", "|", "@", "!", ">", "`", "*")):
    return False
  # AAA: 3, Perfect Angle: 3, Skylancer: 5, etc.
  return re.match(r"^[A-Z][A-Za-z0-9’' ?/&-]+:\s*\d+\??$", s) is not None


def clean_heading_line(line: str) -> str | None:
  ht = heading_level_and_text(line)
  if not ht:
    return line.replace("\uFFFC", "")
  level, title = ht
  title = clean_heading_text(title)

  # Remove empty or broken headings exported by Docs.
  if not title or set(title.strip()) <= {"-", "—", "–"}:
    return None

  # Remove explicit anchor fragments; WMD can derive headings.
  return f"{'#' * level} {title}"


def repair_structure_lines(lines: list[str]) -> list[str]:
  out: list[str] = []
  i = 0
  while i < len(lines):
    line = lines[i]

    # Pattern:
    #   ### ---
    #
    #   Actions
    # should become:
    #   ### Actions
    ht = heading_level_and_text(line)
    if ht and (not ht[1].strip() or set(ht[1].strip()) <= {"-", "—", "–"}):
      next_idx, next_line = find_next_nonblank(lines, i + 1, limit=3)
      if next_line and next_line.strip() in KNOWN_SECTION_LABELS:
        out.append(f"{'#' * ht[0]} {next_line.strip()}")
        i = next_idx + 1
        continue
      i += 1
      continue

    if is_probable_plain_origin_title(lines, i):
      out.append(f"## {line.strip()}")
      i += 1
      continue

    if is_probable_level_ability(line):
      out.append(f"### {line.strip()}")
      i += 1
      continue

    cleaned = clean_heading_line(line)
    if cleaned is not None:
      out.append(cleaned)

    i += 1

  return out



def clean_markup_artifacts(line: str) -> str:
  # Google Docs often exports punctuation as italic/bold when punctuation sits next to
  # an italicised link, e.g. [*Energy*](#x)*.* -> [[Energy]]. This removes that noise.
  line = re.sub(r"_\[\[([^\]]+)\]\]_", r"[[\1]]", line)
  line = re.sub(r"\*\[\[([^\]]+)\]\]\*", r"[[\1]]", line)

  line = re.sub(r"(\[\[[^\]]+\]\])_\s*([.,;:])\s*_", r"\1\2", line)
  line = re.sub(r"(\[\[[^\]]+\]\])\*\s*([.,;:])\s*\*", r"\1\2", line)

  line = re.sub(r"(?<=\w)_\s*([.,;:])\s*_", r"\1", line)
  line = re.sub(r"(?<=\w)\*\s*([.,;:])\s*\*", r"\1", line)
  return line


def inline_convert_lines(lines: list[str], current_tab: str, title_to_dests, id_to_dest, tab_to_title) -> list[str]:
  out: list[str] = []
  in_code = False

  for line in lines:
    if line.strip().startswith("```"):
      in_code = not in_code
      out.append(line)
      continue

    if in_code:
      out.append(line)
      continue

    line = line.replace("\uFFFC", "")
    line = convert_links(line, current_tab, title_to_dests, id_to_dest, tab_to_title)
    line = unescape_google_punctuation(line)
    line = convert_emphasis(line)
    line = clean_markup_artifacts(line)
    # Trim Google Docs hard-break spaces, but preserve ordinary Markdown table/list content.
    line = re.sub(r"[ \t]+$", "", line)
    out.append(line)

  return out


def count_headings(lines: list[str]) -> int:
  return sum(1 for l in lines if re.match(r"^#{1,6}\s+\S", l))


def collapse_blank_lines(lines: list[str], max_blank: int = 2) -> list[str]:
  out: list[str] = []
  blanks = 0
  for line in lines:
    if not line.strip():
      blanks += 1
      if blanks <= max_blank:
        out.append("")
    else:
      blanks = 0
      out.append(line)
  while out and not out[-1].strip():
    out.pop()
  return out


def convert_tab(tab: Tab, title_to_dests, id_to_dest, tab_to_title, toc_depth: int = 2) -> str:
  lines = tab.content[:]
  lines = repair_structure_lines(lines)
  lines = convert_field_blocks(lines)
  lines = repair_missing_table_headers(lines)
  lines = inline_convert_lines(lines, tab.title, title_to_dests, id_to_dest, tab_to_title)
  lines = collapse_blank_lines(lines)

  parts = [f"@tab {tab.title}", f"@title {tab.title}"]

  if count_headings(lines) >= 3:
    parts.append(f"@toc depth: {toc_depth}")

  parts.append("")
  parts.extend(lines)
  return "\n".join(parts).strip()


def convert(text: str, toc_depth: int = 2) -> tuple[str, dict]:
  tabs = split_tabs(text)
  title_to_dests, id_to_dest, tab_to_title = build_heading_index(tabs)

  converted_tabs = [
    convert_tab(tab, title_to_dests, id_to_dest, tab_to_title, toc_depth=toc_depth)
    for tab in tabs
    if tab.title.strip()
  ]

  output = DEFAULT_CONFIG.rstrip() + "\n\n" + "\n\n---\n\n".join(converted_tabs).strip() + "\n"

  report = {
    "tabs": [tab.title for tab in tabs],
    "tab_count": len(tabs),
    "heading_count": sum(count_headings(tab.content) for tab in tabs),
    "converted_link_targets": len(id_to_dest),
  }

  return output, report


def main() -> int:
  parser = argparse.ArgumentParser(description="Convert Google-Docs-exported Markdown to cleaner WMD.")
  parser.add_argument("input", type=Path)
  parser.add_argument("output", type=Path)
  parser.add_argument("--toc-depth", type=int, default=2)
  args = parser.parse_args()

  text = read_source(args.input)
  output, report = convert(text, toc_depth=args.toc_depth)
  args.output.write_text(output, encoding="utf-8")

  print(f"Wrote {args.output}")
  print(f"Tabs: {report['tab_count']}")
  print(", ".join(report["tabs"]))

  return 0


if __name__ == "__main__":
  raise SystemExit(main())
