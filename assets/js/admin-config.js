// Supabase project of the website (the Atleable project; the website's tables
// are in their own "website" schema). The anon (publishable) key is meant to be
// public: row-level security in Supabase decides what it can read and write.
window.AW_ADMIN = {
  supabaseUrl: 'https://mmtcalnsehyuprcwlpgu.supabase.co',
  supabaseAnonKey: 'sb_publishable_7x42OLUU66GC_RlPCokigA_341obeTX',
  schema: 'website'   // the website's tables, kept apart from everything else in the database
};
