// Supabase project of the website. The anon (publishable) key is meant to be
// public: row-level security in Supabase decides what it can read and write.
window.AW_ADMIN = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  schema: 'website'   // the website's tables, kept apart from everything else in the database
};
