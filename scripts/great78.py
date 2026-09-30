"""Builds the demo records from the Great 78 Project (Internet Archive).

    uv run --no-project --with pillow --with numpy python scripts/great78.py

Each album is a hand-picked set of 78 rpm sides recorded in 1925 or earlier
(public domain in the US). For every side it finds the Internet Archive item,
takes its MP3 (streamed from archive.org at play time) and length, and builds
a sleeve for the album from the photographed labels of its records. Writes
src/demo/great78.json and public/demo/<album>.webp.
"""

import io
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT_JSON = ROOT / "src" / "demo" / "great78.json"
OUT_IMG = ROOT / "public" / "demo"
UA = {"User-Agent": "vinyl-room-dev/1.0 (dsuarezfdez@gmail.com)"}

ALBUMS = [
    {
        "id": "g78-hot-jazz",
        "name": "Hot Jazz",
        "artist": "Varios · 1922–1924",
        "year": "1924",
        "colours": ("#1f3b4d", "#e8b04b", "#f3e7d3"),
        "sides": [
            ("Ory's Creole Trombone", "Kid Ory"),
            ("Society Blues", "Kid Ory"),
            ("Tears", "King Oliver"),
            ("Tin Root Blues", "New Orleans Rhythm Kings"),
            ("Da Da Strain", "New Orleans Rhythm Kings"),
            ("Riverboat Shuffle", "Wolverine Orchestra"),
            ("Copenhagen", "Wolverine Orchestra"),
            ("Bee's Knees", "Original Memphis Five"),
            ("Aunt Hager's Blues", "Original Memphis Five"),
            ("Shake Your Feet", "Original Memphis Five"),
        ],
    },
    {
        "id": "g78-harlem-blues",
        "name": "Harlem Blues",
        "artist": "Mamie Smith, Ethel Waters, Bessie Smith",
        "year": "1925",
        "colours": ("#6b1d1d", "#f0c987", "#1b120c"),
        "sides": [
            ("Fare Thee Honey Blues", "Mamie Smith"),
            ("The Road Is Rocky", "Mamie Smith"),
            ("If You Don't Want Me Blues", "Mamie Smith"),
            ("Down Home Blues", "Mamie Smith"),
            ("Arkansas Blues", "Mamie Smith"),
            ("The New York Glide", "Ethel Waters"),
            ("Jazzin' Babies Blues", "Ethel Waters"),
            ("Kind Lovin' Blues", "Ethel Waters"),
            ("Yellow Dog Blues", "Bessie Smith"),
            ("My Man Blues", "Bessie"),
        ],
    },
    {
        "id": "g78-ballroom",
        "name": "Salón de baile",
        "artist": "Orquestas de baile · 1920–1925",
        "year": "1925",
        "colours": ("#2f4f3a", "#e3c16f", "#f5ecd7"),
        "sides": [
            ("Whispering", "Paul Whiteman"),
            ("Ka-Lu-A", "Paul Whiteman"),
            ("Why did I kiss that girl", "Paul Whiteman"),
            ("Chicago", "Paul Whiteman"),
            ("It Had to Be You", "Marion Harris"),
            ("Shanghai Lullaby", "Broadway Dance Orchestra"),
            ("I'll See You in My Dreams", "Ace Brigode"),
            ("Yes! We Have No Bananas", "Golden Gate Orchestra"),
            ("Wonderful One", "Paul Whiteman"),
        ],
    },
    {
        "id": "g78-opera-violin",
        "name": "Ópera y violín",
        "artist": "Enrico Caruso, Fritz Kreisler",
        "year": "1925",
        "colours": ("#3b2a4a", "#d9b56b", "#f3e7d3"),
        "sides": [
            ("Recondita armonia", "Enrico Caruso"),
            ("La donna e mobile", "Enrico Caruso"),
            ("Di quella pira", "Enrico Caruso"),
            ("O soave fanciulla", "Caruso"),
            ("Because", "Enrico Caruso"),
            ("Songs My Mother Taught Me", "Fritz Kreisler"),
            ("Beautiful Ohio", "Fritz Kreisler"),
            ("Pale Moon", "Fritz Kreisler"),
            ("Song of the Volga Boatmen", "Fritz Kreisler"),
            ("Aloha Oe", "Fritz Kreisler"),
        ],
    },
]


def get(url, binary=False):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                data = r.read()
            return data if binary else json.loads(data)
        except Exception as e:  # archive.org is sometimes slow: retry
            if attempt == 3:
                raise
            print("  retry", e)
            time.sleep(3 * (attempt + 1))


def norm(s):
    return "".join(c for c in s.lower() if c.isalnum())


def find(title, artist):
    """Great 78 items with this title and artist, 1925 or earlier, most downloaded first."""
    q = f'collection:georgeblood AND date:[1900-01-01 TO 1925-12-31] AND title:("{title}") AND creator:({artist})'
    url = "https://archive.org/advancedsearch.php?" + urllib.parse.urlencode(
        {"q": q, "fl[]": ["identifier", "title", "creator", "date"], "sort[]": "downloads desc", "rows": 10, "output": "json"}, doseq=True
    )
    docs = get(url)["response"]["docs"]
    docs.sort(key=lambda d: norm(title)[:12] not in norm(d.get("title", "")))  # exact titles first
    return docs


def item_files(identifier):
    meta = get(f"https://archive.org/metadata/{identifier}")
    mp3 = next((f for f in meta.get("files", []) if f.get("format") == "VBR MP3"), None)
    if not mp3:
        return None
    label = next((f for f in meta["files"] if f["name"] == f"{identifier}.jpg"), None)
    creators = meta["metadata"].get("creator")
    creator = creators[0] if isinstance(creators, list) else creators
    return mp3, label, creator, meta["metadata"].get("date", "")[:4]


def seconds(length):
    """File lengths come as seconds ("203.4") or as mm:ss ("03:19")."""
    if ":" in length:
        parts = [float(x) for x in length.split(":")]
        return sum(v * 60 ** i for i, v in enumerate(reversed(parts)))
    return float(length)


def pretty(s):
    """Great 78 titles are often in capitals: make them readable."""
    if not s:
        return s
    small = {"a", "an", "and", "the", "of", "in", "on", "to", "for", "at", "or", "if", "but", "de", "la", "e"}
    out = []
    for i, w in enumerate(s.split()):
        if sum(c.isupper() for c in w) > 1 and w.upper() == w:  # a word in capitals
            w = w.lower()
            w = w if (i and w.strip("(") in small) else w[:1].upper() + w[1:] if not w.startswith("(") else "(" + w[1:2].upper() + w[2:]
        out.append(w)
    return " ".join(out)


def label_disc(identifier, size):
    """The photographed label, cut out as a disc."""
    img = Image.open(io.BytesIO(get(f"https://archive.org/download/{identifier}/{identifier}.jpg", binary=True))).convert("RGB")
    w, h = img.size
    side = min(w, h)
    img = img.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2)).resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    return img, mask.resize((size, size), Image.LANCZOS)


def font(size, bold=False):
    for name in (["georgiab.ttf", "DejaVuSerif-Bold.ttf"] if bold else ["georgia.ttf", "DejaVuSerif.ttf"]):
        for base in ("/mnt/c/Windows/Fonts/", "/usr/share/fonts/truetype/dejavu/"):
            try:
                return ImageFont.truetype(base + name, size)
            except OSError:
                pass
    return ImageFont.load_default()


def sleeve(album, sides):
    """A 1950s reissue-style sleeve: a flat colour, three of the original
    labels fanned across it, the title set in a serif."""
    S = 1024
    bg, accent, ink = album["colours"]
    im = Image.new("RGB", (S, S), bg)
    d = ImageDraw.Draw(im)
    # Paper grain
    grain = (np.random.default_rng(len(album["id"])).random((S, S)) * 18 - 9).astype(np.int16)
    arr = np.clip(np.asarray(im).astype(np.int16) + grain[..., None], 0, 255).astype(np.uint8)
    im = Image.fromarray(arr)
    d = ImageDraw.Draw(im)
    picks = [sides[0], sides[len(sides) // 2], sides[-1]]
    spots = [(120, 150, 420), (470, 90, 460), (330, 380, 400)]
    for side, (x, y, size) in zip(picks, spots):
        disc, mask = label_disc(side["identifier"], size)
        shadow = Image.new("L", (size + 60, size + 60), 0)
        ImageDraw.Draw(shadow).ellipse((30, 38, size + 30, size + 38), fill=110)
        shadow = shadow.filter(ImageFilter.GaussianBlur(14))
        im.paste(Image.new("RGB", shadow.size, "#000"), (x - 30, y - 30), shadow)
        im.paste(disc, (x, y), mask)
    d.rectangle((0, 820, S, S), fill=accent)
    d.text((56, 842), album["name"], font=font(92, bold=True), fill=bg)
    d.text((60, 952), album["artist"], font=font(34), fill=bg)
    d.text((S - 56, 40), "78 RPM · GREAT 78 PROJECT", font=font(24), fill=ink, anchor="ra")
    OUT_IMG.mkdir(parents=True, exist_ok=True)
    path = OUT_IMG / f"{album['id']}.webp"
    im.save(path, quality=86, method=6)
    return path


def main():
    out = []
    for album in ALBUMS:
        print(album["name"])
        sides = []
        for title, artist in album["sides"]:
            for doc in find(title, artist):
                found = item_files(doc["identifier"])
                if found:
                    break
            else:
                print(f"  ! no playable item: {title} / {artist}")
                continue
            mp3, label, creator, year = found
            sides.append(
                {
                    "identifier": doc["identifier"],
                    "name": pretty(doc["title"]),
                    "artist": pretty(creator or artist),
                    "year": year,
                    "durationMs": round(seconds(mp3["length"]) * 1000),
                    "url": f"https://archive.org/download/{doc['identifier']}/{urllib.parse.quote(mp3['name'])}",
                }
            )
            print(f"  {year} {sides[-1]['name']} — {sides[-1]['artist']} ({seconds(mp3['length']):.0f}s)")
            time.sleep(0.5)
        sleeve(album, sides)
        out.append({k: album[k] for k in ("id", "name", "artist", "year")} | {"cover": f"demo/{album['id']}.webp", "sides": sides})
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print("wrote", OUT_JSON)


if __name__ == "__main__":
    main()
