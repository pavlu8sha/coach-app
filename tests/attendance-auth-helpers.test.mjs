import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('attendance read/write helpers are private and only guarded app wrappers call them', () => {
  const attendance = fs.readFileSync(path.join(ROOT, 'Attendance.js'), 'utf8');
  const web = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');

  assert.match(attendance, /function\s+getRoster_\s*\(/);
  assert.doesNotMatch(attendance, /function\s+getRoster\s*\(/);
  assert.match(attendance, /function\s+saveAttendance_\s*\(/);
  assert.doesNotMatch(attendance, /function\s+saveAttendance\s*\(/);
  assert.match(web, /getRoster_\(group\)/);
  assert.match(web, /saveAttendance_\(group, dateStr, toSave\)/);
});
