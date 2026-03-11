import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://vkoegxohahpptdyipmkr.supabase.co',
  'sb_publishable_y0ZeufG01WW57EWJs4GJUw_tFsr34qV'
);

async function listTables() {
  try {
    // Try to query information_schema
    const { data, error } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public');

    if (error) {
      console.error('Error:', error.message);
      return;
    }

    console.log('Tables:', data);
  } catch (e) {
    console.error('Exception:', e.message);
  }

  // Alternative: try to query sessions table to see if it exists
  const { data: sessions, error: sessionsError } = await supabase
    .from('sessions')
    .select('*')
    .limit(1);

  if (sessionsError) {
    console.error('Sessions table error:', sessionsError.message);
  } else {
    console.log('Sessions table exists');
  }

  // Check problems table
  const { data: problems, error: problemsError } = await supabase
    .from('problems')
    .select('*')
    .limit(1);

  if (problemsError) {
    console.error('Problems table error:', problemsError.message);
  } else {
    console.log('Problems table exists, sample:', problems);
  }
}

listTables().catch(console.error);
