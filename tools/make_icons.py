"""Generates the Tsuki Reader app icons (original artwork) into ./icons."""
from PIL import Image, ImageDraw
import os

os.makedirs('icons', exist_ok=True)


def make(size, maskable=False):
    S = size * 4
    bg = Image.new('RGBA', (S, S))
    px = bg.load()
    for y in range(S):
        for x in range(S):
            t = (x + y) / (2 * S)
            px[x, y] = (int(50 + 30 * t), int(56 + 20 * t), int(78 + 40 * t), 255)
    mask = Image.new('L', (S, S), 0)
    md = ImageDraw.Draw(mask)
    if maskable:
        md.rectangle([0, 0, S, S], fill=255)
    else:
        md.rounded_rectangle([0, 0, S, S], radius=int(S * .22), fill=255)
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    im.paste(bg, (0, 0), mask)
    d = ImageDraw.Draw(im)
    sc = .72 if maskable else 1.0
    cx = cy = S / 2
    w, h = S * .56 * sc, S * .40 * sc
    top, bot = cy - h / 2, cy + h / 2
    left, right = cx - w / 2, cx + w / 2
    d.polygon([(left, top + h * .08), (cx - S * .01 * sc, top), (cx - S * .01 * sc, bot), (left, bot - h * .08)], fill=(245, 246, 250, 255))
    d.polygon([(right, top + h * .08), (cx + S * .01 * sc, top), (cx + S * .01 * sc, bot), (right, bot - h * .08)], fill=(214, 218, 230, 255))
    d.rectangle([cx - S * .012 * sc, top, cx + S * .012 * sc, bot], fill=(255, 87, 34, 255))
    for i in range(4):
        y = top + h * (.28 + i * .17)
        d.rounded_rectangle([left + w * .07, y, cx - w * .08, y + h * .05], radius=int(h * .025), fill=(150, 156, 175, 255))
        d.rounded_rectangle([cx + w * .08, y, right - w * .07, y + h * .05], radius=int(h * .025), fill=(130, 136, 158, 255))
    d.polygon([(right - w * .2, top), (right - w * .1, top), (right - w * .1, top + h * .34), (right - w * .15, top + h * .27), (right - w * .2, top + h * .34)], fill=(255, 87, 34, 255))
    return im.resize((size, size), Image.LANCZOS)


make(192).save('icons/icon-192.png')
make(512).save('icons/icon-512.png')
make(512, True).save('icons/maskable-512.png')
make(180, True).convert('RGB').save('icons/apple-touch-icon.png')
print('icons generated')
