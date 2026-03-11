import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://vkoegxohahpptdyipmkr.supabase.co',
  'sb_publishable_y0ZeufG01WW57EWJs4GJUw_tFsr34qV'
);

async function queryProblems() {
  const { data: problems, error: problemsError } = await supabase
    .from('problems')
    .select('id, index_in_image, content, problem_metadata')
    .eq('session_id', '4eb03fcd-d15c-474e-b243-566083b8e2da')
    .order('index_in_image', { ascending: true });

  if (problemsError) {
    console.error('Problems error:', problemsError);
    return;
  }

  console.log('=== PROBLEMS ===');
  console.log(JSON.stringify(problems, null, 2));

  // Get problem IDs
  const problemIds = problems.map(p => p.id);

  // Query labels
  const { data: labels, error: labelsError } = await supabase
    .from('labels')
    .select('problem_id, classification, correct_answer, user_answer, is_correct, user_mark')
    .in('problem_id', problemIds);

  if (labelsError) {
    console.error('Labels error:', labelsError);
    return;
  }

  console.log('\n=== LABELS ===');
  console.log(JSON.stringify(labels, null, 2));
}

queryProblems().catch(console.error);
