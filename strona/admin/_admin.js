/* ============================================================
   GIG Admin Panel — wspólny JS
   ------------------------------------------------------------
   KONFIGURACJA — uzupełnij po założeniu projektu Supabase:
   https://supabase.com → New project → Settings → API
   ============================================================ */

const SUPABASE_URL  = window.GIG_CFG.SUPABASE_URL;
const SUPABASE_ANON = window.GIG_CFG.SUPABASE_ANON;

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

/* ── Auth ── */
async function getSession() {
  const { data } = await db.auth.getSession();
  return data.session;
}
async function requireAuth() {
  const session = await getSession();
  if (!session) { window.location.href = 'index.html'; return null; }
  return session;
}
async function logout() {
  await db.auth.signOut();
  window.location.href = 'index.html';
}

/* ── Toasty ── */
let toastContainer;
function initToasts() {
  toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  document.body.appendChild(toastContainer);
}
function toast(msg, type = 'default', duration = 3500) {
  if (!toastContainer) initToasts();
  const icons = { success: '✓', error: '✕', default: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${msg}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

/* ── Sidebar: aktywny link ── */
function highlightNav() {
  const page = location.pathname.split('/').pop() || 'index.html';
  const hash = location.hash;
  document.querySelectorAll('.sidebar-nav a').forEach(a => {
    a.classList.remove('active');
    const full = a.getAttribute('href') || '';
    const base = full.split('#')[0];
    const linkHash = full.includes('#') ? full.slice(full.indexOf('#')) : '';
    const samePage = base === page || base.endsWith('/' + page);
    if (!samePage) return;
    if (linkHash) { if (linkHash === hash) a.classList.add('active'); }
    else if (!hash) { a.classList.add('active'); }
  });
}

/* ── Sidebar: badge z liczbą NOWYCH ── */
async function loadSidebarBadges() {
  const map = [
    { table: 'submissions_newsletter', id: 'navBadgeNewsletter' },
    { table: 'submissions_kontakt',    id: 'navBadgeKontakt' },
    { table: 'zapisy_szkolenia',       id: 'navBadgeZapisy' },
  ];
  for (const m of map) {
    const el = document.getElementById(m.id);
    if (!el) continue;
    try {
      const { count } = await db.from(m.table)
        .select('id', { count: 'exact', head: true })
        .eq('status', 'new');
      if (count && count > 0) { el.textContent = count; el.style.display = ''; }
      else { el.style.display = 'none'; }
    } catch (_) { el.style.display = 'none'; }
  }
}

/* ── Dane użytkownika w sidebarze ── */
async function fillUserInfo() {
  const session = await getSession();
  if (!session) return;
  const email = session.user.email || '';
  const el = document.getElementById('userAvatar');
  const ne = document.getElementById('userName');
  if (el) el.textContent = email.charAt(0).toUpperCase();
  if (ne) ne.textContent = email;
}

/* ── Taby ── */
function initTabs(containerSelector) {
  const container = document.querySelector(containerSelector || '.tabs-root');
  if (!container) return;
  const btns = container.querySelectorAll('.tab-btn');
  const panes = container.querySelectorAll('.tab-pane');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      btns.forEach(b => b.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const pane = container.querySelector(`.tab-pane[data-tab="${target}"]`);
      if (pane) pane.classList.add('active');
    });
  });
  if (btns.length > 0 && !container.querySelector('.tab-btn.active')) btns[0].click();
}

/* ── Modale ── */
function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('open'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('open'); }
function initModals() {
  document.querySelectorAll('[data-modal-open]').forEach(btn =>
    btn.addEventListener('click', () => openModal(btn.dataset.modalOpen)));
  document.querySelectorAll('[data-modal-close]').forEach(btn =>
    btn.addEventListener('click', () => closeModal(btn.dataset.modalClose)));
  document.querySelectorAll('.modal-overlay').forEach(overlay =>
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); }));
}

/* ── Format daty ── */
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

/* ── Eksport CSV ── */
function exportCSV(rows, columns, filename) {
  const header = columns.map(c => c.label).join(';');
  const body = rows.map(row =>
    columns.map(c => `"${(row[c.key] ?? '').toString().replace(/"/g, '""')}"`).join(';')
  ).join('\n');
  const blob = new Blob(['﻿' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ── Escape ── */
function esc(s) {
  return (s ?? '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Zapisy na szkolenia: liczba osób w zgłoszeniu ──
   Deklarowana liczba, a gdy jej brak — liczba wpisanych nazwisk (linia lub przecinek).
   Używane przez pulpit, listę szkoleń i widok zapisów, żeby liczyły tak samo. */
function gigLiczbaOsob(r) {
  return Number(r.liczba_osob) || (r.uczestnicy ? r.uczestnicy.split(/\n|,/).filter(x => x.trim()).length : 1);
}

/* ============================================================
   KREATOR E-MAILA — wspólny dla zapisów (uczestnicy) i kontaktu
   ------------------------------------------------------------
   gigKreatorMaila({
     odbiorcy:   [{email, name}]        // wymagane; duplikaty adresów odpadają
     temat:      'wstępny temat',
     rodzaj:     'szkolenie' | 'kontakt', // dobiera stopkę maila w funkcji
     szkolenie:  'nazwa szkolenia',      // do stopki (rodzaj 'szkolenie')
     opis:       'HTML obok liczby odbiorców (już escapowany)',
     cytat:      'tekst cytowany pod treścią (odpowiedź na wiadomość)',
     poWyslaniu: async (wynik) => {}     // po udanej wysyłce
   })
   Wysyłka: Edge Function `wyslij-mail` (Resend) — tylko z sesją admina.
   Strona musi ładować Quill (quill.js + quill.snow.css).
   ============================================================ */
let gigMailQuill = null, gigMailOpcje = null;

function gigMailZbuduj() {
  if (document.getElementById('gigMailModal')) return;
  const host = document.createElement('div');
  host.innerHTML = `
  <div class="modal-overlay" id="gigMailModal">
    <div class="modal-box" style="max-width:760px;">
      <div class="modal-header">
        <div class="modal-title" id="gigMailTytul">Wiadomość</div>
        <button class="modal-close" type="button" data-zamknij>×</button>
      </div>
      <div class="modal-body">
        <div class="mail-odb" id="gigMailOdbiorcy"></div>
        <div class="form-group">
          <label for="gigMailTemat">Temat</label>
          <input type="text" id="gigMailTemat" class="form-control" placeholder="Temat wiadomości">
        </div>
        <div class="form-group">
          <label>Treść</label>
          <div id="gigMailEdytor"></div>
          <p class="mail-hint">Mail wychodzi w szacie GIG (jak potwierdzenia zapisu), osobno do każdego odbiorcy. Odpowiedzi trafią na biuro@gig.org.pl.</p>
        </div>
        <div class="mail-wynik" id="gigMailWynik"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" type="button" data-zamknij>Anuluj</button>
        <button class="btn btn-primary" type="button" id="gigMailWyslij">✉ Wyślij</button>
      </div>
    </div>
  </div>`;
  const modal = host.firstElementChild;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-zamknij]').forEach(b => b.addEventListener('click', () => closeModal('gigMailModal')));
  modal.addEventListener('click', e => { if (e.target === modal) closeModal('gigMailModal'); });
  document.getElementById('gigMailWyslij').addEventListener('click', gigMailWyslij);
}

function gigKreatorMaila(o) {
  if (typeof Quill === 'undefined') { toast('Edytor nie załadował się — odśwież stronę', 'error'); return; }
  const widziane = new Set(), odbiorcy = [];
  (o.odbiorcy || []).forEach(r => {
    const e = (r.email || '').trim().toLowerCase();
    if (!e || widziane.has(e)) return;
    widziane.add(e); odbiorcy.push({ email: e, name: (r.name || '').trim(), id: r.id || null });
  });
  if (!odbiorcy.length) { toast('Brak odbiorców'); return; }
  gigMailZbuduj();
  gigMailOpcje = { ...o, odbiorcy };

  document.getElementById('gigMailTytul').textContent =
    odbiorcy.length === 1 ? 'Wiadomość do: ' + (odbiorcy[0].name || odbiorcy[0].email) : 'Wiadomość do uczestników';
  const box = document.getElementById('gigMailOdbiorcy');
  if (odbiorcy.length === 1) {
    box.innerHTML = `Do: <strong>${esc(odbiorcy[0].email)}</strong>${odbiorcy[0].name ? ' — ' + esc(odbiorcy[0].name) : ''}`
      + (o.opis ? ' · ' + o.opis : '');
  } else {
    box.innerHTML = `Odbiorcy: <strong>${odbiorcy.length}</strong> adresów` + (o.opis ? ' · ' + o.opis : '')
      + `<details><summary>pokaż listę</summary><ul>${odbiorcy.map(r => `<li>${esc(r.email)}${r.name ? ' — ' + esc(r.name) : ''}</li>`).join('')}</ul></details>`;
  }
  document.getElementById('gigMailTemat').value = o.temat || '';

  if (!gigMailQuill) {
    gigMailQuill = new Quill('#gigMailEdytor', { theme: 'snow', placeholder: 'Treść wiadomości…',
      modules: { toolbar: [['bold', 'italic', 'underline'], [{ header: [2, 3, false] }],
                           [{ list: 'ordered' }, { list: 'bullet' }], ['link'], ['clean']] } });
  }
  gigMailQuill.setText('');
  if (o.cytat) {
    /* cytowana wiadomość pod dwiema pustymi liniami — kursor zostaje u góry */
    const ops = [{ insert: '\n\n' }];
    String(o.cytat).split(/\n/).forEach(l => {
      if (l) ops.push({ insert: l });
      ops.push({ insert: '\n', attributes: { blockquote: true } });
    });
    gigMailQuill.setContents(ops);
    gigMailQuill.setSelection(0, 0);
  }
  const w = document.getElementById('gigMailWynik'); w.className = 'mail-wynik'; w.innerHTML = '';
  const btn = document.getElementById('gigMailWyslij'); btn.disabled = false; btn.textContent = o.etykietaWyslij || '✉ Wyślij';
  openModal('gigMailModal');
  setTimeout(() => document.getElementById('gigMailTemat').focus(), 60);
}

async function gigMailWyslij() {
  const o = gigMailOpcje; if (!o) return;
  const temat = document.getElementById('gigMailTemat').value.trim();
  const html  = gigMailQuill.root.innerHTML;
  const tekst = (gigMailQuill.root.innerText || '').trim();
  const wynik = document.getElementById('gigMailWynik');
  const pokaz = (k, m) => { wynik.className = 'mail-wynik ' + k; wynik.innerHTML = m; };
  if (!temat) return pokaz('err', 'Podaj temat wiadomości.');
  if (!tekst) return pokaz('err', 'Wpisz treść wiadomości.');
  const n = o.odbiorcy.length;

  /* Tryb kampanii: zamiast wysyłać od razu, oddajemy treść wywołującemu
     (Baza e-mail zakłada kampanię i kolejkę — wysyłka idzie porcjami). */
  if (typeof o.zamiastWysylki === 'function') {
    if (!confirm(`Utworzyć kampanię „${temat}” dla ${n} adresów?\n\nWysyłka ruszy dopiero w zakładce „Wysyłki”, porcjami, z limitem dziennym.`)) return;
    const btnK = document.getElementById('gigMailWyslij');
    btnK.disabled = true; btnK.textContent = 'Tworzenie…';
    try {
      await o.zamiastWysylki({ temat, html, odbiorcy: o.odbiorcy });
    } catch (e) {
      console.error(e);
      pokaz('err', 'Nie udało się utworzyć kampanii: ' + esc(e.message));
      btnK.disabled = false; btnK.textContent = o.etykietaWyslij || '✉ Wyślij';
    }
    return;
  }

  if (!confirm(`Wysłać wiadomość „${temat}” do ${n} ${n === 1 ? 'osoby' : 'osób'}?`)) return;

  const btn = document.getElementById('gigMailWyslij');
  btn.disabled = true; btn.textContent = 'Wysyłanie…';
  try {
    const sesja = await getSession();
    if (!sesja) throw new Error('sesja wygasła — zaloguj się ponownie');
    const res = await fetch(SUPABASE_URL + '/functions/v1/wyslij-mail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + sesja.access_token },
      body: JSON.stringify({ subject: temat, html, recipients: o.odbiorcy, rodzaj: o.rodzaj || '', szkolenie: o.szkolenie || '' }),
    });
    const w = await res.json().catch(() => ({}));
    if (!res.ok || !w.ok) throw new Error(w.error || ('HTTP ' + res.status));
    const nieudane = (w.wyniki || []).filter(x => !x.ok);
    if (nieudane.length) {
      pokaz('err', `Wysłano ${w.wyslane} z ${w.razem}. Nie dotarło do:<ul>${nieudane.map(x => `<li>${esc(x.email)}</li>`).join('')}</ul>`);
      btn.disabled = false; btn.textContent = '✉ Wyślij';
      return;
    }
    pokaz('ok', `Wysłano do ${w.wyslane} ${w.wyslane === 1 ? 'osoby' : 'osób'}.`);
    toast('E-mail wysłany', 'success');
    if (typeof o.poWyslaniu === 'function') { try { await o.poWyslaniu(w); } catch (e) { console.error(e); } }
    setTimeout(() => { closeModal('gigMailModal'); document.getElementById('gigMailTemat').value = ''; gigMailQuill.setText(''); }, 1400);
  } catch (e) {
    console.error(e);
    pokaz('err', 'Nie udało się wysłać: ' + esc(e.message));
    btn.disabled = false; btn.textContent = '✉ Wyślij';
  }
}

/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {
  initToasts();
  initModals();
  highlightNav();
  fillUserInfo();
  loadSidebarBadges();
  window.addEventListener('hashchange', highlightNav);
  document.querySelectorAll('[data-action="logout"]').forEach(btn => btn.addEventListener('click', logout));
});

/* ============================================================
   OBRAZKI — wspólny upload do Supabase Storage (bucket `media`)
   ------------------------------------------------------------
   Używane przez edytor artykułów; przygotowane tak, by dało się
   podpiąć też przy członkach i wydarzeniach.

   gigZrobPodglad(file)          → dataURL do miniatury
   gigZmniejszObraz(file, opcje) → Blob (JPEG) po skalowaniu
   gigWyslijObraz(file, folder)  → publiczny URL po wgraniu
   gigPodepnijUpload(cfg)        → montuje pole „przeciągnij zdjęcie"
   ============================================================ */

const GIG_MAX_PX      = 1600;      // dłuższy bok po zmniejszeniu
const GIG_JAKOSC      = 0.82;      // kompresja JPEG
const GIG_MAX_WEJSCIE = 25 * 1024 * 1024;
const GIG_BUCKET      = 'media';

function gigZrobPodglad(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

/* Skalowanie w przeglądarce — na serwer idzie już lekki plik. */
function gigZmniejszObraz(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      const skala = Math.min(1, GIG_MAX_PX / Math.max(w, h));
      w = Math.round(w * skala); h = Math.round(h * skala);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      c.toBlob(b => b ? res(b) : rej(new Error('Nie udało się przetworzyć obrazu')),
               'image/jpeg', GIG_JAKOSC);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('To nie wygląda na plik graficzny')); };
    img.src = url;
  });
}

function gigNazwaPliku(orig) {
  const baza = (orig || 'obraz').replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[ąàáâä]/g,'a').replace(/[ćç]/g,'c').replace(/[ęèéêë]/g,'e')
    .replace(/[łl]/g,'l').replace(/[ńñ]/g,'n').replace(/[óòôö]/g,'o')
    .replace(/[śş]/g,'s').replace(/[żź]/g,'z').replace(/[ uü]/g,'u')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0, 60) || 'obraz';
  const stempel = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const los = Math.random().toString(36).slice(2, 7);
  return `${stempel}-${baza}-${los}.jpg`;
}

async function gigWyslijObraz(file, folder = 'artykuly') {
  if (!file.type || !file.type.startsWith('image/'))
    throw new Error('To nie jest plik graficzny. Wybierz JPG, PNG lub WEBP.');
  if (file.size > GIG_MAX_WEJSCIE)
    throw new Error('Plik jest za duży (ponad 25 MB). Zmniejsz go i spróbuj ponownie.');

  const blob = await gigZmniejszObraz(file);
  const sciezka = `${folder}/${gigNazwaPliku(file.name)}`;
  const { error } = await db.storage.from(GIG_BUCKET)
    .upload(sciezka, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) {
    if (/bucket/i.test(error.message || ''))
      throw new Error('Brak miejsca na zdjęcia w bazie (bucket „media"). Zgłoś to administratorowi.');
    throw error;
  }
  const { data } = db.storage.from(GIG_BUCKET).getPublicUrl(sciezka);
  return data.publicUrl;
}

/* Pole „przeciągnij zdjęcie": klik, przeciągnięcie i wklejenie ze schowka.
   cfg = { host, hidden, folder } — host: element, hidden: input z URL-em */
function gigPodepnijUpload(cfg) {
  const host   = typeof cfg.host === 'string' ? document.getElementById(cfg.host) : cfg.host;
  const hidden = typeof cfg.hidden === 'string' ? document.getElementById(cfg.hidden) : cfg.hidden;
  if (!host || !hidden) return;

  host.innerHTML =
    '<div class="gig-up" tabindex="0" role="button" aria-label="Dodaj zdjęcie">' +
      '<div class="gig-up-pusty">' +
        '<strong>Przeciągnij tutaj zdjęcie</strong>' +
        '<span>albo kliknij, żeby wybrać z dysku. Możesz też wkleić ze schowka (Ctrl+V).</span>' +
      '</div>' +
      '<div class="gig-up-podglad" hidden><img alt="Podgląd zdjęcia"><button type="button" class="gig-up-usun" title="Usuń zdjęcie">Usuń zdjęcie</button></div>' +
      '<div class="gig-up-praca" hidden>Wgrywam zdjęcie…</div>' +
      '<input type="file" accept="image/*" hidden>' +
    '</div>';

  const box     = host.querySelector('.gig-up');
  const pusty   = host.querySelector('.gig-up-pusty');
  const podglad = host.querySelector('.gig-up-podglad');
  const img     = host.querySelector('.gig-up-podglad img');
  const praca   = host.querySelector('.gig-up-praca');
  const input   = host.querySelector('input[type=file]');

  function pokaz(url) {
    if (url) { img.src = url; podglad.hidden = false; pusty.hidden = true; }
    else { img.removeAttribute('src'); podglad.hidden = true; pusty.hidden = false; }
  }
  host.gigPokaz = pokaz;

  async function obsluz(file) {
    if (!file) return;
    praca.hidden = false; box.classList.add('is-busy');
    try {
      pokaz(await gigZrobPodglad(file));               // natychmiastowy podgląd
      const url = await gigWyslijObraz(file, cfg.folder || 'artykuly');
      hidden.value = url; pokaz(url);
      toast('Zdjęcie dodane', 'success');
    } catch (e) {
      console.error(e);
      pokaz(hidden.value || '');
      toast(e.message || 'Nie udało się wgrać zdjęcia', 'error', 6000);
    } finally {
      praca.hidden = true; box.classList.remove('is-busy'); input.value = '';
    }
  }

  box.addEventListener('click', e => { if (!e.target.closest('.gig-up-usun')) input.click(); });
  box.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => obsluz(input.files[0]));
  host.querySelector('.gig-up-usun').addEventListener('click', e => {
    e.stopPropagation(); hidden.value = ''; pokaz(''); toast('Zdjęcie usunięte z wpisu');
  });
  ['dragenter','dragover'].forEach(t => box.addEventListener(t, e => {
    e.preventDefault(); box.classList.add('is-over');
  }));
  ['dragleave','drop'].forEach(t => box.addEventListener(t, e => {
    e.preventDefault(); box.classList.remove('is-over');
  }));
  box.addEventListener('drop', e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) obsluz(f);
  });
  document.addEventListener('paste', e => {
    if (!host.offsetParent) return;                    // tylko gdy pole widoczne
    const it = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (it) obsluz(it.getAsFile());
  });
}
