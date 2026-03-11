import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://vkoegxohahpptdyipmkr.supabase.co',
  'sb_publishable_y0ZeufG01WW57EWJs4GJUw_tFsr34qV'
);

async function getSchema() {
  // Get table columns for problems table
  const { data: columnsData, error: columnsError } = await supabase
    .from('problems')
    .select('*')
    .limit(0);

  if (columnsError) {
    console.error('Problems error:', columnsError);
  } else {
    console.log('Problems table columns:', Object.keys(columnsData ? columnsData[0] : {}));
  }

  // Get table columns for sessions table
  const { data: sessionsData, error: sessionsError } = await supabase
    .from('sessions')
    .select('*')
    .limit(0);

  if (sessionsError) {
    console.error('Sessions error:', sessionsError);
  } else {
    console.log('Sessions table columns:', Object.keys(sessionsData ? sessionsData[0] : {}));
  }

  // Get table columns for labels table
  const { data: labelsData, error: labelsError } = await supabase
    .from('labels')
    .select('*')
    .limit(0);

  if (labelsError) {
    console.error('Labels error:', labelsError);
  } else {
    console.log('Labels table columns:', Object.keys(labelsData ? labelsData[0] : {}));
  }

  // Try to get any data to see structure
  console.log('\n=== Trying different table names ===');
  const tableNames = ['sessions', 'problems', 'labels', 'generated_problems', 'problem_solving_sessions'];
  
  for (const table of tableNames) {
    const { data, error, status } = await supabase
      .from(table)
      .select('*')
      .limit(1);

    if (!error) {
      console.log(`\n${table}: ✓ Exists`);
      if (data && data.length > 0) {
        console.log('Sample columns:', Object.keys(data[0]));
        console.log('Sample data:', JSON.stringify(data[0], null, 2).substring(0, 200));
      }
    }
  }
}

getSchema().catch(console.error);
