import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://vkoegxohahpptdyipmkr.supabase.co',
  'sb_publishable_y0ZeufG01WW57EWJs4GJUw_tFsr34qV'
);

async function checkAuth() {
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error) {
    console.log('No authenticated user:', error.message);
  } else {
    console.log('Authenticated user:', user);
  }

  // Try to query with RLS disabled (if public access exists)
  console.log('\nTrying to fetch problems data...');
  const { data: problems, error: problemsError, status } = await supabase
    .from('problems')
    .select('*');

  console.log('Status:', status);
  if (problemsError) {
    console.log('Problems error:', problemsError);
  } else {
    console.log('Problems count:', problems.length);
    if (problems.length > 0) {
      console.log('First problem:', JSON.stringify(problems[0], null, 2));
    }
  }
}

checkAuth().catch(console.error);
