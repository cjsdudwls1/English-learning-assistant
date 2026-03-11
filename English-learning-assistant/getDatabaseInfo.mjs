import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

// Try using management API
const projectRef = 'vkoegxohahpptdyipmkr';

async function getDatabaseInfo() {
  // Try SQL query through Supabase client first
  const supabase = createClient(
    'https://vkoegxohahpptdyipmkr.supabase.co',
    'sb_publishable_y0ZeufG01WW57EWJs4GJUw_tFsr34qV'
  );

  console.log('Checking all possible tables...\n');
  
  const tablesToCheck = [
    'sessions', 'problems', 'labels',
    'generated_problems', 'problem_solving_sessions',
    'user_problems', 'analysis_results', 'image_problems',
    'session_data', 'problem_data', 'label_data'
  ];

  for (const table of tablesToCheck) {
    try {
      const { data, error, status, statusText } = await supabase
        .from(table)
        .select('COUNT(*)', { count: 'exact', head: true });

      if (!error) {
        console.log(`✓ ${table}: EXISTS`);
        // Try to get one row
        const { data: row, error: rowError } = await supabase
          .from(table)
          .select('*')
          .limit(1);
        
        if (!rowError && row && row.length > 0) {
          console.log(`  Columns: ${Object.keys(row[0]).join(', ')}`);
        }
      } else if (error.code !== 'PGRST116') { // PGRST116 = not found
        console.log(`⚠ ${table}: ${error.code} - ${error.message}`);
      }
    } catch (e) {
      // Silently skip
    }
  }
}

getDatabaseInfo().catch(console.error);
