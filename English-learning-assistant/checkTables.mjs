import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://vkoegxohahpptdyipmkr.supabase.co',
  'sb_publishable_y0ZeufG01WW57EWJs4GJUw_tFsr34qV'
);

async function checkTables() {
  const tables = ['sessions', 'problems', 'labels', 'session', 'problem', 'label'];
  
  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .limit(1);

    if (error) {
      console.log(`${table}: NOT FOUND (${error.message})`);
    } else {
      console.log(`${table}: EXISTS`);
    }
  }

  // Try to get all sessions to see data
  console.log('\n=== Trying to fetch all sessions ===');
  const { data: sessionData, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .limit(10);
  
  if (sessionError) {
    console.error('Error fetching sessions:', sessionError.message);
  } else {
    console.log('Sessions data:', JSON.stringify(sessionData, null, 2));
  }
}

checkTables().catch(console.error);
