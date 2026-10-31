"""Generates the Tsuki Reader app icons into ./icons from tools/logo.png.

The logo has a transparent background, so its own alpha channel is used
directly. The white parts of the mascot are kept as they are.
"""
from PIL import Image, ImageDraw
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)
OUT = os.path.join(ROOT, 'icons')
os.makedirs(OUT, exist_ok=True)

logo = Image.open(os.path.join(SCRIPT_DIR, 'logo.png')).convert('RGBA')

# Crop to the non-transparent content, then pad to a square
logo = logo.crop(logo.getchannel('A').getbbox())
side = max(logo.size)
square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
square.paste(logo, ((side - logo.width) // 2, (side - logo.height) // 2), logo)


def make(size, maskable=False):
    S = size
    # Dark gradient background (matches the app theme)
    bg = Image.new('RGBA', (S, S))
    px = bg.load()
    for y in range(S):
        for x in range(S):
            t = (x + y) / (2 * S)
            px[x, y] = (int(18 + 15 * t), int(18 + 15 * t), int(28 + 20 * t), 255)

    # Rounded mask (maskable icons stay square)
    mask = Image.new('L', (S, S), 0)
    md = ImageDraw.Draw(mask)
    if maskable:
        md.rectangle([0, 0, S, S], fill=255)
    else:
        md.rounded_rectangle([0, 0, S, S], radius=int(S * .22), fill=255)
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    im.paste(bg, (0, 0), mask)

    # Logo centred, with more padding for maskable icons
    pad = int(S * 0.14) if maskable else int(S * 0.08)
    inner = S - pad * 2
    im.alpha_composite(square.resize((inner, inner), Image.LANCZOS), (pad, pad))
    return im


make(192).save(os.path.join(OUT, 'icon-192.png'))
make(512).save(os.path.join(OUT, 'icon-512.png'))
make(512, maskable=True).save(os.path.join(OUT, 'maskable-512.png'))
make(180, maskable=True).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'))
print('icons generated')
