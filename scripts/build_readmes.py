#!/usr/bin/env python3
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"
OUT_DIR = ROOT / "user-docs" / "readme"

# code -> native name, in display order. en first.
LANGS = [
    ("en", "English"),
    ("es", "Español"),
    ("fr", "Français"),
    ("de", "Deutsch"),
    ("zh", "中文"),
    ("ja", "日本語"),
    ("id", "Bahasa Indonesia"),
    ("ms", "Bahasa Melayu"),
    ("vi", "Tiếng Việt"),
    ("th", "ไทย"),
    ("fil", "Filipino"),
    ("my", "မြန်မာ"),
    ("km", "ភាសាខ្មែរ"),
    ("lo", "ລາວ"),
]

# Full language names for the translation instruction.
TRANSLATE_TARGET = {
    "es": "Spanish (Español)",
    "fr": "French (Français)",
    "de": "German (Deutsch)",
    "zh": "Simplified Chinese (简体中文)",
    "ja": "Japanese (日本語)",
    "id": "Indonesian (Bahasa Indonesia)",
    "ms": "Malay (Bahasa Melayu)",
    "vi": "Vietnamese (Tiếng Việt)",
    "th": "Thai (ไทย)",
    "fil": "Filipino",
    "my": "Burmese (မြန်မာ)",
    "km": "Khmer (ភាសាខ្មែរ)",
    "lo": "Lao (ລາວ)",
}


def extract_body(text: str) -> str:
    marker = "> [!NOTE]"
    idx = text.index(marker)
    return text[idx:]


def rewrite_paths(body: str) -> str:
    body = body.replace(
        "(user-docs/en/cloudflare-access.md)", "(../en/cloudflare-access.md)"
    )
    return body


def nav_line(current: str) -> str:
    parts = []
    for code, name in LANGS:
        if code == current:
            parts.append(f"**{name}**")
        elif code == "en":
            parts.append(f"[{name}](../../README.md)")
        else:
            parts.append(f"[{name}](README.{code}.md)")
    return " · ".join(parts)


def header(current: str) -> str:
    return f"""<h1 align="center">pi-web</h1>

<p align="center">
<a href="https://github.com/tajquitgenius/pi-web/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/tajquitgenius/pi-web/actions/workflows/ci.yml/badge.svg"></a>
<a href="../../LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-0f766e"></a>
</p>

<div align="center">

{nav_line(current)}

</div>

"""


PROMPT = """You are translating a software project's README from English into {target}.

Rules:
- Output ONLY the translated Markdown. No preamble, no code fences around the whole thing, no commentary.
- Preserve all Markdown structure exactly: headings (##), tables, blockquotes, line breaks, HTML tags (<div>, <img>, <em>, <br />).
- Do NOT translate or alter: code blocks (the ``` fenced ASCII diagram and bash commands), URLs, file paths, link targets in parentheses, image src attributes, HTML attribute values.
- Translate the visible link text and table cell text.
- Keep these terms in English / as-is: pi, pi-web, Pi, Cloudflare, Cloudflare Access, Cloudflare Tunnel, PWA, SSE, JSONL, launchd, systemd, macOS, Linux, Windows, Git, GitHub, HTTPS, Host, Origin, QR, RPC, beta.
- Keep the GitHub alert keywords literally as `> [!WARNING]` and `> [!TIP]` (do not translate WARNING/TIP), but translate the alert body text.

Here is the Markdown to translate:

---
{body}
"""


def translate(body: str, code: str) -> str:
    prompt = PROMPT.format(target=TRANSLATE_TARGET[code], body=body)
    result = subprocess.run(
        ["pi", "-p", "--model", "opencode-go/deepseek-v4-pro", "--no-session", prompt],
        capture_output=True,
        text=True,
        timeout=600,
    )
    if result.returncode != 0:
        raise RuntimeError(f"pi failed for {code}: {result.stderr}")
    out = result.stdout.strip()
    # Strip an accidental wrapping code fence if present.
    if out.startswith("```"):
        out = re.sub(r"^```[a-zA-Z]*\n", "", out)
        out = re.sub(r"\n```$", "", out)
    return out.strip()


def main():
    only = sys.argv[1:]  # optional list of codes to (re)build
    text = README.read_text()
    body = rewrite_paths(extract_body(text))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for code, name in LANGS:
        if code == "en":
            continue
        if only and code not in only:
            continue
        print(f"[{code}] translating…", flush=True)
        translated = translate(body, code)
        content = header(code) + translated + "\n"
        (OUT_DIR / f"README.{code}.md").write_text(content)
        print(f"[{code}] wrote README.{code}.md ({len(content)} bytes)", flush=True)


if __name__ == "__main__":
    main()
