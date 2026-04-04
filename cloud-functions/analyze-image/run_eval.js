import { spawn } from 'child_process';
import fs from 'fs';

const p = spawn('node', [
  'test-analyze.js', 
  '../../test_image/맨 처음 받은거/20250420_134039.jpg', 
  "4,2,3,2,3,cutting,Are,aren't going to clear the streets after school,We planning lot of events for children", 
  "4,2,3,2,3,cutting,Are,aren't going to clean the streets after school,We are planning a lot of events for children"
], { env: process.env });

let out = '';
p.stdout.on('data', d => out += d.toString('utf8'));
p.stderr.on('data', d => out += d.toString('utf8'));

p.on('close', () => {
    const lines = out.split('\n');
    const resultLines = lines.filter(l => 
        l.includes('[PASS]') || 
        l.includes('[FAIL]') || 
        l.includes('====>') || 
        l.includes('user_answer=') ||
        l.includes('correct_answer=')
    );
    fs.writeFileSync('clean_20250420_result.txt', resultLines.join('\n'));
    console.log('Test completed, results saved to clean_20250420_result.txt');
});
