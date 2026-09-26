import { File, Paths } from 'expo-file-system';

/**
 * Persistent scan debug log.
 *
 * logcat rotates away, so every scan also appends a JSONL record to the app's
 * document directory. Read it from the in-app Debug screen (with a Share
 * button), or over USB when the app is debuggable.
 */
export interface ScanDebugRecord {
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

const FILE_NAME = 'scan-debug.jsonl';
const MAX_RECORDS = 40;
const MAX_CHARS = 400_000;

function debugFile(): File {
  return new File(Paths.document, FILE_NAME);
}

/** Append one scan record (JSONL), rotating when the file gets large. */
export function appendScanRecord(record: ScanDebugRecord): void {
  try {
    const file = debugFile();
    if (!file.exists) file.create({ overwrite: true });
    file.write(`${JSON.stringify(record)}\n`, { append: true });

    const text = file.textSync();
    if (text.length > MAX_CHARS) {
      const kept = text.trim().split('\n').slice(-MAX_RECORDS).join('\n') + '\n';
      file.write(kept); // default is overwrite (append is opt-in)
    }
  } catch (err) {
    console.warn('[debugFile] append failed:', String(err));
  }
}

/** Raw JSONL contents (empty string when nothing has been recorded yet). */
export function readScanDebug(): string {
  try {
    const file = debugFile();
    return file.exists ? file.textSync() : '';
  } catch (err) {
    return `(read failed: ${String(err)})`;
  }
}

export function scanDebugUri(): string {
  return debugFile().uri;
}

export function clearScanDebug(): void {
  try {
    const file = debugFile();
    if (file.exists) file.delete();
  } catch (err) {
    console.warn('[debugFile] clear failed:', String(err));
  }
}
