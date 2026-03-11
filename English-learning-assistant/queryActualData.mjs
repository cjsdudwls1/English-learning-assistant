import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://vkoegxohahpptdyipmkr.supabase.co',
  'sb_publishable_y0ZeufG01WW57EWJs4GJUw_tFsr34qV'
);

async function query() {
  console.log('=== Query with target session ID ===\n');

  // Query sessions table - look for the specific session ID
  console.log('1. Checking sessions table for 4eb03fcd-d15c-474e-b243-566083b8e2da');
  const { data: targetSession, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', '4eb03fcd-d15c-474e-b243-566083b8e2da');

  if (sessionError) {
    console.error('Session error:', sessionError);
  } else {
    console.log('Session found:', targetSession.length > 0);
    if (targetSession.length > 0) {
      console.log(JSON.stringify(targetSession, null, 2));
    }
  }

  // If not found, get all sessions
  console.log('\n2. All sessions (first 5):');
  const { data: allSessions, error: allSessionsError } = await supabase
    .from('sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  if (allSessionsError) {
    console.error('Error:', allSessionsError);
  } else {
    console.log(`Total: ${allSessions.length}`);
    if (allSessions.length > 0) {
      console.log('First session ID:', allSessions[0].id);
      console.log(JSON.stringify(allSessions[0], null, 2));
    }
  }

  // Get problems for the target session ID (if it exists) or first session
  const sessionId = targetSession?.length > 0 ? targetSession[0].id : (allSessions?.length > 0 ? allSessions[0].id : null);
  
  if (sessionId) {
    console.log(`\n3. Problems for session ${sessionId}:`);
    const { data: problems, error: problemError } = await supabase
      .from('problems')
      .select('*')
      .eq('session_id', sessionId)
      .order('index_in_image', { ascending: true });

    if (problemError) {
      console.error('Problem error:', problemError);
    } else {
      console.log(`Found ${problems.length} problems`);
      if (problems.length > 0) {
        console.log(JSON.stringify(problems[0], null, 2));
      }
    }

    // Get labels for these problems
    console.log(`\n4. Labels for session ${sessionId}:`);
    const { data: labels, error: labelError } = await supabase
      .from('labels')
      .select('*')
      .eq('session_id', sessionId);

    if (labelError) {
      console.error('Label error:', labelError);
    } else {
      console.log(`Found ${labels.length} labels`);
      if (labels.length > 0) {
        console.log(JSON.stringify(labels[0], null, 2));
      }
    }
  }
}

query().catch(console.error);
