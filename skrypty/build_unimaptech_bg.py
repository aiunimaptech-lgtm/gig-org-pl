# -*- coding: utf-8 -*-
"""Tła na Zoom (1920x1080) z logo UnimapTech: wariant jasny i ciemny.
Logo z C:\\#logotypy\\unimaptech.png (przezroczyste). Akcent marki #347D98.
Zapis: C:\\#logotypy\\UnimapTech-tlo-zoom-jasne.png / -ciemne.png"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

def remove_white(im):
    """Usuwa białe tło logo (biel->przezroczyste), z miękką krawędzią."""
    arr = np.array(im.convert("RGBA")).astype(np.float32)
    mn = np.minimum(np.minimum(arr[...,0], arr[...,1]), arr[...,2])
    a = np.clip((245.0 - mn) / (245.0 - 210.0), 0, 1) * 255.0   # opaque<=210, transp>=245
    arr[...,3] = np.minimum(arr[...,3], a)
    return Image.fromarray(arr.astype("uint8"), "RGBA")

OUT = r"C:\#logotypy"
LOGO = os.path.join(OUT, "unimaptech.png")
W, H = 1920, 1080
TEAL = (52, 125, 152)             # #347D98
ARIAL = r"C:\Windows\Fonts\arial.ttf"

def gradient(c_top, c_bot):
    base = Image.new("RGB", (1, H))
    for y in range(H):
        t = y/(H-1)
        base.putpixel((0,y), tuple(int(c_top[i]+(c_bot[i]-c_top[i])*t) for i in range(3)))
    return base.resize((W, H)).convert("RGBA")

def faint(img, alpha):
    a = img.split()[3].point(lambda p: int(p*alpha))
    out = img.copy(); out.putalpha(a); return out

def scaled(img, height=None, width=None):
    w, h = img.size
    if height: width = int(w*height/h)
    elif width: height = int(h*width/w)
    return img.resize((width, height), Image.LANCZOS)

def build(dark):
    logo = remove_white(Image.open(LOGO))
    if dark:
        bg = gradient((22,32,42),(13,19,26))          # charcoal
        webc=(150,162,174,255); name="UnimapTech-tlo-zoom-ciemne.png"; wm_a=0.05
    else:
        bg = gradient((255,255,255),(233,238,242))     # white -> light
        webc=(120,132,144,255); name="UnimapTech-tlo-zoom-jasne.png"; wm_a=0.06
    img = bg
    # znak wodny: duże, mocno wyblakłe logo w prawym dolnym rogu (częściowo poza kadrem)
    wm = faint(scaled(logo, width=1150), wm_a)
    img.alpha_composite(wm, (W-980, H-560))
    # cienki pasek marki na dole
    d = ImageDraw.Draw(img)
    d.rectangle([0, H-10, W, H], fill=TEAL+(255,))
    # logo w lewym górnym rogu
    lg = scaled(logo, height=168)
    img.alpha_composite(lg, (96, 96))
    # adres www
    d.text((96, H-78), "www.unimaptech.pl", font=ImageFont.truetype(ARIAL, 30), fill=webc)
    img.convert("RGB").save(os.path.join(OUT, name), quality=95)
    return name

os.makedirs(OUT, exist_ok=True)
for dark in (False, True):
    print("zapisano:", os.path.join(OUT, build(dark)))
