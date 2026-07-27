/* Generator statycznej kopii listy członków GIG.
   Tworzy: strona/_assets/js/czlonkowie-fallback.js  (window.GIG_CZLONKOWIE_FALLBACK)
   Strona /czlonkowie/ używa tego pliku, gdy Supabase nie odpowiada — dzięki temu
   katalog członków działa nawet przy awarii/uśpieniu bazy.

   Użycie:
     node skrypty/gen_czlonkowie_fallback.js                 # z lokalnego skrypty/_czlonkowie.json
     node skrypty/gen_czlonkowie_fallback.js --from-supabase # świeże dane prosto z bazy (po jej przywróceniu)

   Po każdej zmianie członków w panelu /admin/ warto uruchomić wariant --from-supabase
   i zacommitować odświeżony plik, żeby kopia nie odstawała od bazy.
*/
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "strona", "_assets", "js", "czlonkowie-fallback.js");
const SRC_JSON = path.join(__dirname, "_czlonkowie.json");

const SUPABASE_URL = "https://zlepwzeyjwpmhyxfnime.supabase.co";
const SUPABASE_ANON = "sb_publishable_1KPF4mdln3C-cZHMIqAOFw_ZM8Go2Ji";

// Kolumny renderowane przez /czlonkowie/ (resztę — www, social, opis, współrzędne,
// NIP/REGON/KRS — dokłada czlonkowie-enrich.js przez mergeEnrich()).
const FIELDS = ["name", "region", "person", "phone", "email", "address", "website", "description"];

function pick(row) {
  const o = {};
  for (const f of FIELDS) {
    const v = row[f];
    if (v != null && String(v).trim() !== "") o[f] = v;
  }
  return o;
}

async function fromSupabase() {
  const url =
    SUPABASE_URL +
    "/rest/v1/czlonkowie?select=" +
    FIELDS.join(",") +
    "&status=eq.published&order=region.asc&order=name.asc";
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON, Authorization: "Bearer " + SUPABASE_ANON },
  });
  if (!res.ok) throw new Error("Supabase HTTP " + res.status + ": " + (await res.text()).slice(0, 200));
  return res.json();
}

function fromLocalJson() {
  return JSON.parse(fs.readFileSync(SRC_JSON, "utf8"));
}

(async () => {
  const useDb = process.argv.includes("--from-supabase");
  let rows;
  try {
    rows = useDb ? await fromSupabase() : fromLocalJson();
  } catch (e) {
    console.error("BŁĄD pobierania danych:", e.message);
    if (useDb) console.error("Sprawdź, czy projekt Supabase jest przywrócony (nie uśpiony).");
    process.exit(1);
  }

  const data = rows.map(pick).filter((r) => r.name);
  data.sort((a, b) =>
    (a.region || "").localeCompare(b.region || "", "pl") || a.name.localeCompare(b.name, "pl")
  );

  const banner =
    "/* Statyczna kopia listy członków GIG — awaryjne źródło dla /czlonkowie/,\n" +
    "   używane gdy Supabase nie odpowiada. NIE edytuj ręcznie.\n" +
    "   Regeneracja: node skrypty/gen_czlonkowie_fallback.js [--from-supabase]\n" +
    "   Rekordów: " + data.length + "  ·  źródło: " + (useDb ? "Supabase" : "skrypty/_czlonkowie.json") + " */\n";

  fs.writeFileSync(OUT, banner + "window.GIG_CZLONKOWIE_FALLBACK=" + JSON.stringify(data) + ";\n", "utf8");
  console.log("Zapisano " + path.relative(ROOT, OUT) + " — " + data.length + " firm (źródło: " + (useDb ? "Supabase" : "lokalny JSON") + ")");
})();
