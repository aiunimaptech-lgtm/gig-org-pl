# -*- coding: utf-8 -*-
"""Generuje tła na Zoom (1920x1080) z logo GIG: wariant jasny i ciemny.
Sygnet odtworzony 1:1 ze ścieżki SVG (4 czerwone pasy), wordmark złożony czcionką Arial.
Zapis: C:\\#logotypy\\GIG-tlo-zoom-jasne.png i ...-ciemne.png"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = r"C:\#logotypy"
W, H = 1920, 1080
RED = (220, 38, 38, 255)          # #dc2626 (z sygnetu)
ARIALBD = r"C:\Windows\Fonts\arialbd.ttf"
ARIAL = r"C:\Windows\Fonts\arial.ttf"

def font(path, size): return ImageFont.truetype(path, size)

def make_sygnet(size, color=RED):
    """Sygnet GIG: czerwony wielokąt cięty w 4 pionowe pasy. Render z supersamplingiem."""
    SS = 4
    Wd = size * SS
    img = Image.new("RGBA", (Wd, Wd), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    def m(v): return (v + 10) / 120.0 * Wd          # viewBox -10..110
    pts = [(5,35),(45,10),(55,20),(85,15),(105,50),(95,85),(65,110),(25,100),(0,75)]
    d.polygon([(m(x), m(y)) for x, y in pts], fill=color)
    for a, b in [(-10,0),(23,27),(50,54),(77,81),(105,110)]:   # przerwy -> 4 pasy
        d.rectangle([m(a), 0, m(b), Wd], fill=(0,0,0,0))
    return img.resize((size, size), Image.LANCZOS)

def draw_tracked(d, xy, text, fnt, fill, tracking=0):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=fnt, fill=fill)
        w = d.textlength(ch, font=fnt)
        x += w + tracking
    return x

def logo_block(sygnet_h, gig_color, sub_color, divider_color):
    """Zwraca RGBA: sygnet | kreska | (GIG / GEODEZYJNA IZBA GOSPODARCZA). Blok dopasowany do tekstu."""
    syg = make_sygnet(sygnet_h)
    gigf = font(ARIALBD, int(sygnet_h*0.70))
    subf = font(ARIAL, int(sygnet_h*0.135))
    pad = int(sygnet_h*0.18)
    tmp = Image.new("RGBA", (10,10)); td = ImageDraw.Draw(tmp)
    gig_bb = td.textbbox((0,0), "GIG", font=gigf)
    gig_w = gig_bb[2]-gig_bb[0]; gig_h = gig_bb[3]-gig_bb[1]
    subs = ["GEODEZYJNA","IZBA","GOSPODARCZA"]
    track = max(1, int(sygnet_h*0.02))
    sub_ws = [sum(td.textlength(c, font=subf)+track for c in s) for s in subs]
    sub_bb = td.textbbox((0,0), "GEODEZYJNA", font=subf)
    sub_lh = int((sub_bb[3]-sub_bb[1])*1.45)
    text_w = int(max(gig_w, max(sub_ws)))
    top = 2; gap = int(sygnet_h*0.10)
    text_h = top + gig_h + gap + 3*sub_lh
    block_h = max(sygnet_h, text_h)
    div_x = sygnet_h + pad
    text_x = div_x + 3 + pad
    total_w = text_x + text_w + 4
    img = Image.new("RGBA", (total_w, block_h), (0,0,0,0))
    img.alpha_composite(syg, (0, (block_h - sygnet_h)//2))   # sygnet wyśrodkowany w pionie
    d = ImageDraw.Draw(img)
    d.rectangle([div_x, int(block_h*0.08), div_x+3, int(block_h*0.92)], fill=divider_color)
    d.text((text_x - gig_bb[0], top - gig_bb[1]), "GIG", font=gigf, fill=gig_color)
    sy = top + gig_h + gap
    for i, s in enumerate(subs):
        draw_tracked(d, (text_x, sy + i*sub_lh - sub_bb[1]), s, subf, sub_color, tracking=track)
    return img

def gradient(c_top, c_bot):
    base = Image.new("RGB", (1, H))
    for y in range(H):
        t = y/(H-1)
        base.putpixel((0,y), tuple(int(c_top[i]+(c_bot[i]-c_top[i])*t) for i in range(3)))
    return base.resize((W, H)).convert("RGBA")

def faint(img, alpha):
    a = img.split()[3].point(lambda p: int(p*alpha))
    out = img.copy(); out.putalpha(a); return out

def build(dark):
    if dark:
        bg = gradient((22,32,42),(13,19,26))         # #16202a -> #0d131a
        gigc=(255,255,255,255); subc=(174,184,194,255); divc=(120,130,140,255)
        wm = faint(make_sygnet(1150, (255,255,255,255)), 0.05)
        webc=(150,162,174,255); accent=(204,10,43,255)
        name="GIG-tlo-zoom-ciemne.png"
    else:
        bg = gradient((255,255,255),(233,238,242))    # white -> #e9eef2
        gigc=(26,34,48,255); subc=(107,120,132,255); divc=(210,216,222,255)
        wm = faint(make_sygnet(1150), 0.06)
        webc=(120,132,144,255); accent=(204,10,43,255)
        name="GIG-tlo-zoom-jasne.png"
    img = bg
    # znak wodny (sygnet) po prawej, częściowo poza kadrem
    img.alpha_composite(wm, (W-820, H-720))
    # cienki czerwony pasek na dole
    d = ImageDraw.Draw(img)
    d.rectangle([0, H-10, W, H], fill=accent)
    # logo w lewym górnym rogu
    logo = logo_block(150, gigc, subc, divc)
    img.alpha_composite(logo, (96, 92))
    # adres www na dole po lewej
    wf = font(ARIAL, 30)
    d.text((96, H-78), "www.gig.org.pl", font=wf, fill=webc)
    img.convert("RGB").save(os.path.join(OUT, name), quality=95)
    return name

os.makedirs(OUT, exist_ok=True)
for dark in (False, True):
    n = build(dark)
    print("zapisano:", os.path.join(OUT, n))
