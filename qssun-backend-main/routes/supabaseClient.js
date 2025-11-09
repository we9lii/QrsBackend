const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase URL and Anon Key are required. Make sure they are in your .env file.');
  // In a real scenario, you might want to exit the process
  // process.exit(1); 
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

module.exports = { supabase };