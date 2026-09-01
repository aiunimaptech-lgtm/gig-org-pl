/* =====================================================================
   GIG — jedno miejsce na dane dostępowe do Supabase.

   `SUPABASE_ANON` to klucz PUBLICZNY (`sb_publishable_`) — jest widoczny
   w źródle strony i tak ma być. Dostępu pilnuje RLS po stronie bazy.
   Klucza `service_role` NIGDY tu nie wpisujemy — jego miejsce to sekrety
   Supabase (Edge Functions).

   Plik ładowany PRZED pozostałymi skryptami GIG, bez `defer`, żeby
   `window.GIG_CFG` istniało niezależnie od tego, czy dany skrypt jest
   odroczony. Po rotacji klucza wystarczy zmienić to jedno miejsce.
   ===================================================================== */
window.GIG_CFG = {
  SUPABASE_URL:  "https://zlepwzeyjwpmhyxfnime.supabase.co",
  SUPABASE_ANON: "sb_publishable_1KPF4mdln3C-cZHMIqAOFw_ZM8Go2Ji"
};
