# -*- coding: utf-8 -*-
"""Porządki wydajnościowe w kopii WordPressa (idempotentne).

- Cloudflare Turnstile: klucz przypisany do starej domeny, widżet się zapętlał
  (setki błędów w konsoli, ciągłe zapytania). Formularze obsługuje
  _assets/js/forms_integration.js wprost do Supabase i Turnstile nie używa.
- Contact Form 7 (index.js, swv): przy każdym wejściu pytał nieistniejące API
  WordPressa (/wp-json/... → 403). Wysyłkę i tak przejmuje forms_integration.js
  (capture + stopImmediatePropagation), więc skrypty CF7 były martwe.
- Font Awesome v4-shims: blokował renderowanie w <head>, a strona używa już klas
  v5 (fas/fab); dostaje `defer`.

    python skrypty/wydajnosc_porzadki.py
"""
import io
import os
import re

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'strona')
WZORY = [
    r'<script data-wp-strategy="async" id="cloudflare-turnstile-js" src="https://challenges\.cloudflare\.com/turnstile/v0/api\.js"></script>\n?',
    r'<script id="cloudflare-turnstile-js-after">[\s\S]*?</script>\n?',
    r'<div class="wpcf7-turnstile cf-turnstile"[^>]*></div>',
    r'<script id="swv-js" src="/wp-content/plugins/contact-form-7/includes/swv/js/index\.js"></script>\n?',
    r'<script id="contact-form-7-js" src="/wp-content/plugins/contact-form-7/includes/js/index\.js"></script>\n?',
]
SHIM = ('<script id="font-awesome-4-shim-js" src="/wp-content/plugins/elementor/assets/lib/font-awesome/js/v4-shims.min.js"></script>',
        '<script defer id="font-awesome-4-shim-js" src="/wp-content/plugins/elementor/assets/lib/font-awesome/js/v4-shims.min.js"></script>')

zmienione = 0
for katalog, _, pliki in os.walk(ROOT):
    if os.sep + 'admin' in katalog:
        continue
    for n in pliki:
        if not n.endswith('.html'):
            continue
        p = os.path.join(katalog, n)
        s0 = s = io.open(p, encoding='utf-8').read()
        for w in WZORY:
            s = re.sub(w, '', s)
        s = s.replace(*SHIM)
        if s != s0:
            io.open(p, 'w', encoding='utf-8', newline='').write(s)
            zmienione += 1
            print('uporządkowano:', os.path.relpath(p, ROOT))
print('plików:', zmienione)
