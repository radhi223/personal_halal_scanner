/** Damerau-free Levenshtein edit distance with O(min(a,b)) memory. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;

  let s = a;
  let t = b;
  if (s.length > t.length) {
    const tmp = s;
    s = t;
    t = tmp;
  }

  const sl = s.length;
  const tl = t.length;
  if (sl === 0) return tl;

  let prev = new Array<number>(sl + 1);
  let cur = new Array<number>(sl + 1);
  for (let i = 0; i <= sl; i++) prev[i] = i;

  for (let j = 1; j <= tl; j++) {
    cur[0] = j;
    const tc = t.charCodeAt(j - 1);
    for (let i = 1; i <= sl; i++) {
      const cost = s.charCodeAt(i - 1) === tc ? 0 : 1;
      const del = prev[i] + 1;
      const ins = cur[i - 1] + 1;
      const sub = prev[i - 1] + cost;
      cur[i] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }

  return prev[sl];
}

/** Normalized similarity in [0, 1]; 1 means identical. */
export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}
