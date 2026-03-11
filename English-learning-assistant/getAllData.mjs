import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://vkoegxohahpptdyipmkr.supabase.co',
  'sb_publishable_y0ZeufG01WW57EWJs4GJUw_tFsr34qV'
);

async function getAllData() {
  const tableNames = ['sessions', 'problems', 'labels', 'generated_problems', 'problem_solving_sessions'];
  
  for (const table of tableNames) {
    const { data, error, status } = await supabase
      .from(table)
      .select('*')
      .limit(5);

    console.log(`\n=== ${table} ===`);
    if (error) {
      console.log('Error:', error.message);
    } else {
      console.log('Count:', data.length);
      if (data.length > 0) {
        console.log('Columns:', Object.keys(data[0]));
        console.log('First row:', JSON.stringify(data[0], null, 2));
      }
    }
  }
}

getAllData().catch(console.error);
