import { File, Paths } from 'expo-file-system';

/**
 * Persistent scan debug log.
 *
 * logcat rotates away, so every scan also appends a JSONL record to the app's
 * document directory. Read it from the in-app Debug screen (with a Share
 * button), or over USB when the app is debuggable.
 */
export interface ScanDebugRecord {
  type: 'scan';
  sid: string;
  at: string;
  ms: number;
  cropped: boolean;
  passes: number;
  coverage: number;
  matched: number;
  unmatched: number;
  hits: string[];
  miss: string[];
  section: string;
  raw: { label: string; text: string }[];
}

/**
 * Real-use feedback: the user marks a finding as wrong on the result screen.
 * These records drive the curation backlog (which gaps actually show up in the
 * field) instead of relying only on the static top-800 frequency list.
 */
export interface FeedbackRecord {
  type: 'feedback';
  at: string;
  sid: string;
  raw: string;
  normalized: string;
  entryId: string | null;
  status: string | null;
  matchedTerm?: string;
}

const SCAN_FILE_NAME = 'scan-debug.jsonl';
const FEEDBACK_FILE_NAME = 'feedback.jsonl';
const SCAN_MAX_RECORDS = 40;
// Feedback is a curation backlog, not rotating diagnostics: keep a longer tail
// and, crucially, a separate file so scan records cannot rotate it away.
const FEEDBACK_MAX_RECORDS = 200;
const MAX_CHARS = 400_000;

function debugFile(name: string): File {
  return new File(Paths.document, name);
}

/** Append one JSONL record to `name`, rotating that file when it gets large. */
function append(name: string, maxRecords: number, record: unknown): void {
  try {
    const file = debugFile(name);
    if (!file.exists) file.create({ overwrite: true });
    file.write(`${JSON.stringify(record)}\n`, { append: true });

    const text = file.textSync();
    if (text.length > MAX_CHARS) {
      const kept = text.trim().split('\n').slice(-maxRecords).join('\n') + '\n';
      file.write(kept); // default is overwrite (append is opt-in)
    }
  } catch (err) {
    console.warn(`[debugFile] append ${name} failed:`, String(err));
  }
}

export function appendScanRecord(record: ScanDebugRecord): void {
  append(SCAN_FILE_NAME, SCAN_MAX_RECORDS, record);
}

export function appendFeedbackRecord(record: FeedbackRecord): void {
  append(FEEDBACK_FILE_NAME, FEEDBACK_MAX_RECORDS, record);
}

/** Raw JSONL contents (empty string when nothing has been recorded yet). */
export function readScanDebug(): string {
  try {
    const file = debugFile(SCAN_FILE_NAME);
    return file.exists ? file.textSync() : '';
  } catch (err) {
    return `(read failed: ${String(err)})`;
  }
}

export function scanDebugUri(): string {
  return debugFile(SCAN_FILE_NAME).uri;
}

export function clearScanDebug(): void {
  try {
    const file = debugFile(SCAN_FILE_NAME);
    if (file.exists) file.delete();
  } catch (err) {
    console.warn('[debugFile] clear failed:', String(err));
  }
}
