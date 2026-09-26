import type { ScanFinding } from '@/types';

export interface LastScan {
  rawText: string;
  /** The 原材料名 section we actually matched against (may equal rawText). */
  section: string;
  findings: ScanFinding[];
  createdAt: number;
}

/**
 * Tiny in-memory handoff between the scan screen and the result screen.
 * Avoids serializing the whole result through router params.
 */
let last: LastScan | null = null;

export function setLastScan(scan: LastScan): void {
  last = scan;
}

export function getLastScan(): LastScan | null {
  return last;
}
