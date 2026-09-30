"""Builds the window landscapes in public/landscapes/ from the originals in
sources/landscapes/ (not in the repo: see the README credits for where each
one comes from).

    uv run --no-project --with opencv-python-headless --with numpy --with pillow \
        python blender/landscapes.py [name ...]

Every output is a band of the panorama in equirectangular form: azimuth and
elevation both linear in the image, which is how the window shader maps it.
The numbers each one prints (span and elevation of its edges) go into
src/scene/landscape/landscapes.ts.
"""

import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "sources" / "landscapes"
OUT = ROOT / "public" / "landscapes"
MAX_WIDTH = 4096


def srgb_to_linear(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def soft_clip(x):
    """Filmic shoulder: keeps the darks linear and rolls bright lights off."""
    return np.where(x < 0.6, x, 0.6 + 0.4 * np.tanh((x - 0.6) / 0.4))


def night_grade(lin, exposure, tint=(0.86, 0.95, 1.18), desat=0.55):
    """Moonlight look: dim, cool and pale in the shadows (as the eye sees at
    night), while bright artificial lights keep their colour."""
    x = lin * exposure
    lum = (x * [0.2126, 0.7152, 0.0722]).sum(axis=2, keepdims=True)
    night = np.clip(1 - lum / 0.08, 0, 1)  # how much it is in the scotopic range
    grey = lum * np.array(tint)
    x = x + (grey - x) * desat * night
    return soft_clip(x)


def equirect_band(img, center_u, half_span_deg, el_bottom_deg, el_top_deg, horizon_v=0.5):
    """Crops a band of a 360-degree equirectangular image. horizon_v is where
    elevation 0 sits (0.5 for a level panorama); elevations are relative to it."""
    h, w = img.shape[:2]
    deg_per_px = 360 / w
    x0 = int(round((center_u * 360 - half_span_deg) / deg_per_px))
    x1 = int(round((center_u * 360 + half_span_deg) / deg_per_px))
    cols = np.arange(x0, x1) % w
    y_h = horizon_v * h
    y0 = int(round(y_h - el_top_deg / deg_per_px))
    y1 = int(round(y_h - el_bottom_deg / deg_per_px))
    band = img[max(y0, 0):min(y1, h)][:, cols]
    return band


def save(name, rgb_linear_or_srgb, alpha=None, is_linear=True, half_span=None, el=None):
    OUT.mkdir(parents=True, exist_ok=True)
    rgb = linear_to_srgb(rgb_linear_or_srgb) if is_linear else rgb_linear_or_srgb
    rgb = (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)
    im = Image.fromarray(rgb, "RGB")
    if alpha is not None:
        im.putalpha(Image.fromarray((np.clip(alpha, 0, 1) * 255 + 0.5).astype(np.uint8), "L"))
    if im.width > MAX_WIDTH:
        im = im.resize((MAX_WIDTH, round(im.height * MAX_WIDTH / im.width)), Image.LANCZOS)
    path = OUT / f"{name}.webp"
    im.save(path, quality=86, method=6)
    # Linear colours at the top and around the horizon, for the sky it blends into
    arr = np.asarray(im.convert("RGB")).astype(np.float32) / 255
    lin = srgb_to_linear(arr)
    top = lin[: max(2, im.height // 60)].reshape(-1, 3).mean(axis=0)
    print(f"{name}: {im.width}x{im.height}, {path.stat().st_size // 1024} KB, half span {half_span} deg, el {el} deg")
    print(f"  top colour (linear) {np.round(top, 4).tolist()}")


def read_hdr(name):
    return cv2.imread(str(SRC / name), cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32)


def read_jpg(name):
    return np.asarray(Image.open(SRC / name).convert("RGB")).astype(np.float32) / 255


def countryside():
    # Clarens (South Africa) by moonlight: the valley, the village and the moon
    img = read_hdr("clarens_night_01_16k.hdr")
    band = equirect_band(img, 170 / 360, 75, -35, 62)
    save("countryside", night_grade(band, 0.085), half_span=75, el=(-35, 62))


def sea():
    # Clear night over water with the moon low: only the sky is used, the sea
    # itself is rendered (see Ocean.tsx)
    img = read_hdr("kloppenheim_02_puresky_8k.hdr")
    band = equirect_band(img, 207 / 360, 75, -4, 70)
    save("sea-sky", night_grade(band, 0.11, desat=0.35), half_span=75, el=(-4, 70))


def wasteland():
    # Pripyat from a rooftop, the Chernobyl plant on the horizon; graded to a
    # smoky dusk, with the sky cut out for the burning sky behind it
    img = srgb_to_linear(read_jpg("pripyat-2009.jpg"))
    horizon_v = 0.545
    band = equirect_band(img, 0.705, 75, -40, 12, horizon_v)
    h = band.shape[0]
    deg_per_px = 360 / img.shape[1]
    el = 12 - (np.arange(h) + 0.5) * deg_per_px  # elevation of each row
    lum = (band * [0.2126, 0.7152, 0.0722]).sum(axis=2)
    sat = band.max(axis=2) - band.min(axis=2)
    skyish = np.clip((lum - 0.28) / 0.12, 0, 1) * np.clip((0.12 - sat) / 0.06, 0, 1)
    # Well above the skyline it is all sky; right on it, only the bright pale pixels
    above = np.clip((el[:, None] - 1.2) / 0.8, 0, 1)
    near = ((el[:, None] > -0.6) & (el[:, None] <= 1.2)).astype(np.float32)
    sky = np.maximum(above, skyish * near)
    sky = cv2.GaussianBlur(sky, (0, 0), 1.2)
    alpha = 1 - sky
    # Dusk under smoke: dark, desaturated, a warm cast from the fires and the
    # red sky, colder in the shadows
    x = band * 0.16
    lum = (x * [0.2126, 0.7152, 0.0722]).sum(axis=2, keepdims=True)
    x = x + (lum - x) * 0.65
    x = x * np.array([1.18, 0.9, 0.78]) * (0.75 + 0.25 * np.clip(lum / 0.03, 0, 1)) + np.array([0.0, 0.0, 0.004]) * (1 - np.clip(lum / 0.02, 0, 1))
    save("wasteland", soft_clip(x), alpha=alpha, half_span=75, el=(-40, 12))


def moon():
    # Apollo 17 at Taurus-Littrow (NASA): the hills away from the lander and
    # the sun's glare; the photographer's shadow is painted out
    img = srgb_to_linear(read_jpg("apollo17-landing.jpg"))
    h, w = img.shape[:2]
    # Shadow of the astronaut (u 0.105-0.135, v 0.72-1): cloned from beside it
    x0, x1 = int(0.103 * w), int(0.137 * w)
    y0 = int(0.70 * h)
    shift = x1 - x0 + int(0.004 * w)
    patch = img[y0:, x0 + shift:x1 + shift].copy()
    fx = np.minimum(np.arange(x1 - x0), np.arange(x1 - x0)[::-1]) / 40
    fy = np.minimum(np.arange(h - y0) / 40, 1)
    feather = np.clip(np.minimum(fx[None, :], 1) * fy[:, None], 0, 1)[..., None]
    img[y0:, x0:x1] = img[y0:, x0:x1] * (1 - feather) + patch * feather
    # The panorama spans 360 degrees; its horizon is about 45% down
    center_u, half = 0.245, 65
    deg_per_px = 360 / w
    top_el = 0.45 * h * deg_per_px
    band = equirect_band(img, center_u, half, -(h * deg_per_px - top_el), top_el, 0.45)
    lum = (band * [0.2126, 0.7152, 0.0722]).sum(axis=2)
    alpha = np.clip((lum - 0.004) / 0.012, 0, 1)
    alpha = cv2.GaussianBlur(alpha, (0, 0), 0.8)
    # Lunar day under a black sky, slightly dimmed for a room at night
    save("moon", soft_clip(band * 0.55), alpha=alpha, half_span=half, el=(round(-(h * deg_per_px - top_el), 2), round(top_el, 2)))


def earth():
    # NASA Blue Marble (public domain): land and sea in RGB, clouds in alpha,
    # for the Earth hanging over the Moon
    land = Image.open(SRC / "land_shallow_topo_2048.jpg").convert("RGB").resize((1024, 512), Image.LANCZOS)
    clouds = Image.open(SRC / "cloud_combined_2048.jpg").convert("L").resize((1024, 512), Image.LANCZOS)
    land.putalpha(clouds)
    OUT.mkdir(parents=True, exist_ok=True)
    land.save(OUT / "earth.webp", quality=88, method=6)
    print(f"earth: {(OUT / 'earth.webp').stat().st_size // 1024} KB")


def future():
    # Chongqing from Eling Park at night; the whole photo, resized
    img = read_jpg("chongqing-eling.jpg")
    save("future", img, is_linear=False, half_span=65, el="see shader")


def day_grade(lin, exposure, sat=1.0):
    """Daylight: a plain exposure with the same filmic roll-off."""
    x = lin * exposure
    lum = (x * [0.2126, 0.7152, 0.0722]).sum(axis=2, keepdims=True)
    return soft_clip(lum + (x - lum) * sat)


def countryside_day():
    # Clarens at midday (Poly Haven): same hills, facing the village
    img = read_hdr("clarens_midday_16k.hdr")
    band = equirect_band(img, 285 / 360, 75, -35, 62)
    save("countryside-day", day_grade(band, 0.95), half_span=75, el=(-35, 62))


def sea_day():
    img = read_hdr("kloppenheim_06_puresky_8k.hdr")
    band = equirect_band(img, 205 / 360, 75, -4, 70)
    save("sea-sky-day", day_grade(band, 0.42), half_span=75, el=(-4, 70))


def manhattan_day():
    # Top of the Rock looking south, January 2026: the same view as the night
    img = read_jpg("manhattan-day.jpg")
    save("manhattan-day", img, is_linear=False, half_span=55, el=(-21.8, 22.2))


def future_day():
    # Chongqing from the tower in Eling Park, by day
    img = read_jpg("chongqing-day.jpg")
    save("future-day", img, is_linear=False, half_span=65, el=(-22.6, 16.4))


def wasteland_day():
    # Pripyat by day under a toxic haze: the same crop and sky cut as the
    # night version (the fires and smoke sit on it), bleached and yellowed
    img = srgb_to_linear(read_jpg("pripyat-2009.jpg"))
    band = equirect_band(img, 0.705, 75, -40, 12, 0.545)
    alpha = np.asarray(Image.open(OUT / "wasteland.webp").convert("RGBA").resize((band.shape[1], band.shape[0])))[..., 3] / 255
    x = band * 0.85
    lum = (x * [0.2126, 0.7152, 0.0722]).sum(axis=2, keepdims=True)
    x = lum + (x - lum) * 0.35  # drained of colour
    x = x * np.array([1.08, 1.0, 0.78])  # sickly yellow-brown haze
    h = x.shape[0]
    # Haze thickening towards the horizon (the top of this band)
    depth = np.clip(1 - np.arange(h) / (h * 0.55), 0, 1)[:, None, None] ** 2
    x = x * (1 - depth * 0.55) + np.array([0.32, 0.28, 0.2]) * depth * 0.55
    save("wasteland-day", soft_clip(x), alpha=alpha, half_span=75, el=(-40, 12))


JOBS = {"earth": earth, "countryside": countryside, "sea": sea, "wasteland": wasteland, "moon": moon, "future": future,
        "countryside_day": countryside_day, "sea_day": sea_day, "manhattan_day": manhattan_day,
        "future_day": future_day, "wasteland_day": wasteland_day}

if __name__ == "__main__":
    for name in sys.argv[1:] or JOBS:
        JOBS[name]()
