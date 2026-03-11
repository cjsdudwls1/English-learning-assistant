import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://vkoegxohahpptdyipmkr.supabase.co',
  'sb_publishable_y0ZeufG01WW57EWJs4GJUw_tFsr34qV'
);

async function queryRealData() {
  // First, let's find the right session or any session data
  console.log('=== SESSION_DATA ===');
  const { data: sessions, error: sessionError } = await supabase
    .from('session_data')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  if (sessionError) {
    console.error('Error:', sessionError);
  } else {
    console.log(`Found ${sessions.length} sessions`);
    for (const session of sessions) {
      console.log(`ID: ${session.id}`);
      if (session.id === '4eb03fcd-d15c-474e-b243-566083b8e2da') {
        console.log('*** FOUND TARGET SESSION! ***');
      }
    }
  }

  // Now look for problems and labels related to this session
  console.log('\n=== PROBLEM_DATA (first 5) ===');
  const { data: problems, error: problemError } = await supabase
    .from('problem_data')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  if (problemError) {
    console.error('Error:', problemError);
  } else {
    console.log(`Found ${problems.length} problems`);
    console.log(JSON.stringify(problems, null, 2));
  }

  // Check label_data
  console.log('\n=== LABEL_DATA (first 5) ===');
  const { data: labels, error: labelError } = await supabase
    .from('label_data')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  if (labelError) {
    console.error('Error:', labelError);
  } else {
    console.log(`Found ${labels.length} labels`);
    console.log(JSON.stringify(labels, null, 2));
  }

  // Check image_problems
  console.log('\n=== IMAGE_PROBLEMS (first 5) ===');
  const { data: imageProblems, error: imageProblemError } = await supabase
    .from('image_problems')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  if (imageProblemError) {
    console.error('Error:', imageProblemError);
  } else {
    console.log(`Found ${imageProblems.length} image problems`);
    console.log(JSON.stringify(imageProblems, null, 2));
  }
}

queryRealData().catch(console.error);
