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
