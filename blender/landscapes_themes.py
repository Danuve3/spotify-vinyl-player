"""Builds the themed window landscapes (west, medieval, arctic, volcanic,
fantasy, forest, antiquity, cyberpunk, steampunk, gothic).

    uv run --no-project --with opencv-python-headless --with numpy --with pillow \
        python blender/landscapes_themes.py [name ...]

Every theme is one photograph, so day and night show the very same place:
the day image is the photo graded; the night one is "day for night" — dimmed,
cooled and desaturated, with the sky cut out (alpha) so the procedural night
sky shows behind the skyline. Glowing things (lava) keep their light.
The printed spans and elevations go into src/scene/landscape/themes.ts.
"""

import sys

import cv2
import numpy as np
from PIL import Image

from landscapes import OUT, SRC, equirect_band, linear_to_srgb, night_grade, read_hdr, soft_clip, srgb_to_linear

Image.MAX_IMAGE_PIXELS = None
WORK = 4096  # working width
NIGHT_WIDTH = 3072  # night images are dark: less detail needed


def load_photo(name, x0=0.0, x1=1.0, y0=0.0, y1=1.0):
    im = Image.open(SRC / name).convert("RGB")
    w, h = im.size
    im = im.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)))
    if im.width > WORK:
        im = im.resize((WORK, round(im.height * WORK / im.width)), Image.LANCZOS)
    return srgb_to_linear(np.asarray(im).astype(np.float32) / 255)


def photo_span(lin, half_span, horizon_v):
    """Elevation of the top and bottom edges for a photo spanning 2*half_span
    degrees across, with its horizon `horizon_v` down from the top."""
    h, w = lin.shape[:2]
    v_span = 2 * half_span * h / w
    top = horizon_v * v_span
    return round(top - v_span, 2), round(top, 2)


def sky_mask(lin, is_sky, v_min, v_max, run=6, median=5):
    """1 on the ground, 0 on the sky. Per column, the skyline is the first row
    (below v_min) where `run` non-sky pixels follow each other; never below v_max."""
    s = linear_to_srgb(lin)
    sky = is_sky(s)
    h, w = sky.shape
    ground = (~sky).astype(np.float32)
    runs = cv2.filter2D(ground, -1, np.ones((run, 1), np.float32), anchor=(0, 0), borderType=cv2.BORDER_CONSTANT) >= run - 0.5
    r0, r1 = int(v_min * h), int(v_max * h)
    runs[:r0] = False
    runs[r1:] = True
    skyline = np.argmax(runs, axis=0).astype(np.float32)
    if median > 1:
        padded = np.pad(skyline, median // 2, mode="edge")
        skyline = np.median(np.lib.stride_tricks.sliding_window_view(padded, median), axis=1)
    rows = np.arange(h, dtype=np.float32)[:, None]
    alpha = np.clip(rows - skyline[None, :] + 0.5, 0, 1)
    return cv2.GaussianBlur(alpha, (0, 0), 1.0)


def hot_mask(lin):
    """Glowing lava: bright and strongly orange-red."""
    s = linear_to_srgb(lin)
    r, g, b = s[..., 0], s[..., 1], s[..., 2]
    hot = np.clip((r - 0.55) / 0.2, 0, 1) * np.clip((r - g * 1.25 - 0.05) / 0.2, 0, 1) * np.clip((r - b * 1.6) / 0.2, 0, 1)
    return cv2.GaussianBlur(hot, (0, 0), 1.5)[..., None]


def save_webp(name, lin, alpha=None, width=WORK):
    OUT.mkdir(parents=True, exist_ok=True)
    rgb = (np.clip(linear_to_srgb(lin), 0, 1) * 255 + 0.5).astype(np.uint8)
    im = Image.fromarray(rgb, "RGB")
    if alpha is not None:
        im.putalpha(Image.fromarray((np.clip(alpha, 0, 1) * 255 + 0.5).astype(np.uint8), "L"))
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    path = OUT / f"{name}.webp"
    im.save(path, quality=80, method=6)
    return im.size, path.stat().st_size // 1024


def pair(name, lin, el, half, is_sky=None, v_min=0.0, v_max=1.0, day_exposure=1.0, night_exposure=0.2,
         tint=(0.82, 0.93, 1.2), desat=0.6, keep_hot=False, cut_day=False, median=5):
    """Writes <name>-day.webp and <name>-night.webp from one linear image."""
    alpha = sky_mask(lin, is_sky, v_min, v_max, median=median) if is_sky else None
    day = soft_clip(lin * day_exposure)
    dsize, dkb = save_webp(f"{name}-day", day, alpha if cut_day else None)
    night = night_grade(lin, night_exposure, tint=tint, desat=desat)
    if keep_hot:
        hot = hot_mask(lin)
        night = night * (1 - hot) + soft_clip(lin * 1.1) * hot
    nsize, nkb = save_webp(f"{name}-night", night, alpha, NIGHT_WIDTH)
    # Linear colours of the photo's sky, for the procedural sky around it
    top = lin[: max(2, lin.shape[0] // 40)].reshape(-1, 3).mean(axis=0) * day_exposure
    print(f"{name}: day {dsize} {dkb} KB, night {nsize} {nkb} KB | halfSpan {half} el {el} | day sky {np.round(top, 3).tolist()}")
    if alpha is not None:
        preview = (np.clip(linear_to_srgb(night * 6), 0, 1) * 255).astype(np.uint8)
        preview = (preview * alpha[..., None] + np.array([255, 0, 255]) * (1 - alpha[..., None])).astype(np.uint8)
        Image.fromarray(preview).resize((1600, round(preview.shape[0] * 1600 / preview.shape[1]))).save(f"/tmp/mask_{name}.jpg", quality=80)


def blue(s):
    """Clear sky of any brightness: clearly bluer than red."""
    return (s[..., 2] > s[..., 0] * 1.2) & (s[..., 2] > s[..., 1] * 1.02)


def lum(s):
    return 0.3 * s[..., 0] + 0.59 * s[..., 1] + 0.11 * s[..., 2]


def sat(s):
    mx, mn = s.max(axis=2), s.min(axis=2)
    return (mx - mn) / (mx + 1e-4)


def west():
    # Monument Valley from the Lookout Point (the buttes, the dirt road)
    lin = load_photo("west.jpg")
    half = 80
    el = photo_span(lin, half, 0.6)
    blue_or_cloud = lambda s: blue(s) | ((s[..., 2] > s[..., 0] * 0.95) & (lum(s) > 0.3)) | ((sat(s) < 0.22) & (lum(s) > 0.6))
    pair("west", lin, el, half, blue_or_cloud, 0.36, 0.64, tint=(0.8, 0.9, 1.2))


def medieval():
    # La Cité de Carcassonne across the vineyards
    lin = load_photo("medieval.jpg")
    half = 62
    el = photo_span(lin, half, 0.52)
    # The hazy hills behind go too: at night they would be a dark line, not a pale band
    pale = lambda s: ((lum(s) > 0.64) & (sat(s) < 0.25)) | ((s[..., 2] > s[..., 0] * 1.08) & (lum(s) > 0.38))
    pair("medieval", lin, el, half, pale, 0.35, 0.62)


def arctic():
    # Svalbard: mountains across the fjord under low cloud
    lin = load_photo("arctic.jpg")
    half = 60
    el = photo_span(lin, half, 0.705)
    # The mountain tops are hidden in cloud: cut above the snow and rock
    skyish = lambda s: ((lum(s) > 0.3) & (s[..., 2] >= s[..., 0] * 0.97) & (sat(s) < 0.35)) | blue(s)
    pair("arctic", lin, el, half, skyish, 0.4, 0.52, tint=(0.8, 0.95, 1.25), desat=0.5, median=41)


def volcanic():
    # Holuhraun fissure eruption, Iceland 2014: lava fountains and a far vent
    # Cropped so the main fountain sits in the middle of the window
    lin = load_photo("volcanic.jpg", 0.0, 0.7)
    half = 65
    el = photo_span(lin, half, 0.57)
    grey_sky = lambda s: (lum(s) > 0.5) & (sat(s) < 0.2)
    pair("volcanic", lin, el, half, grey_sky, 0.1, 0.58, night_exposure=0.14, tint=(0.9, 0.9, 1.05), desat=0.5, keep_hot=True)


def fantasy():
    # The Old Man of Storr, Skye: the pinnacles, the sound and the islands
    lin = load_photo("fantasy.jpg")
    half = 80
    el = photo_span(lin, half, 0.33)
    skyish = lambda s: ((s[..., 2] > s[..., 0] * 1.02) & (lum(s) > 0.45)) | ((sat(s) < 0.18) & (lum(s) > 0.62))
    pair("fantasy", lin, el, half, skyish, 0.05, 0.36, tint=(0.78, 0.9, 1.25))


def forest():
    # Misty pines (Poly Haven): fog instead of sky, so nothing is cut
    img = read_hdr("misty_pines_8k.hdr")
    band = equirect_band(img, 170 / 360, 75, -35, 62)
    k = 0.18 / float(np.median(band))
    pair("forest", band * k, (-35, 62), 75, None, day_exposure=0.8, night_exposure=0.09, tint=(0.75, 0.9, 1.15), desat=0.7)


def antiquity():
    # The Colosseum and the Via Sacra (Poly Haven)
    img = read_hdr("colosseum_8k.hdr")
    band = equirect_band(img, 280 / 360, 75, -30, 60)
    k = 0.18 / float(np.median(band))
    skyish = lambda s: blue(s) | ((s[..., 2] >= s[..., 0]) & (lum(s) > 0.6)) | (lum(s) > 0.92)
    pair("antiquity", band * k, (-30, 60), 75, skyish, 0.02, 0.62, day_exposure=1.0, night_exposure=0.13)


def steampunk():
    # Hamburg's Speicherstadt: brick warehouses along a canal (Poly Haven)
    img = read_hdr("hamburg_canal_8k.hdr")
    band = equirect_band(img, 165 / 360, 75, -32, 50)
    k = 0.18 / float(np.median(band))
    bright = lambda s: ((lum(s) > 0.8) & (sat(s) < 0.25)) | blue(s)
    pair("steampunk", band * k, (-32, 50), 75, bright, 0.0, 0.62, day_exposure=0.85, night_exposure=0.11, tint=(0.85, 0.92, 1.1))


def gothic():
    # Prague Castle and St Vitus over the Vltava, with Charles Bridge
    lin = load_photo("gothic.jpg")
    half = 65
    el = photo_span(lin, half, 0.58)
    skyish = lambda s: ((s[..., 2] > s[..., 0] * 1.05) & (lum(s) > 0.5)) | blue(s)
    pair("gothic", lin, el, half, skyish, 0.05, 0.5, tint=(0.8, 0.9, 1.2))


def cyberpunk():
    # Kowloon from Lion Rock: a daytime and a blue-hour photo from the same summit
    day = load_photo("cyberpunk-day.jpg")
    half_d = 80
    el_d = photo_span(day, half_d, 0.3)
    size, kb = save_webp("cyberpunk-day", soft_clip(day))
    print(f"cyberpunk-day {size} {kb} KB halfSpan {half_d} el {el_d}")
    night = load_photo("cyberpunk.jpg", 0.0, 1.0, 0.08, 1.0)
    half_n = 90
    el_n = photo_span(night, half_n, 0.19)
    size, kb = save_webp("cyberpunk-night", soft_clip(night * 0.9), None, NIGHT_WIDTH)
    print(f"cyberpunk-night {size} {kb} KB halfSpan {half_n} el {el_n}")


JOBS = {f.__name__: f for f in (west, medieval, arctic, volcanic, fantasy, forest, antiquity, steampunk, gothic, cyberpunk)}

if __name__ == "__main__":
    for n in sys.argv[1:] or JOBS:
        JOBS[n]()
