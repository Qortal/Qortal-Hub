const GCALL_SEQ_MODULO = 65536;
const GCALL_SEQ_HALF_RANGE = GCALL_SEQ_MODULO / 2;

export function gcallSeqIsAfter(seq: number, reference: number): boolean {
  if (reference < 0) return true;
  const diff = (seq - reference + GCALL_SEQ_MODULO) & 0xffff;
  return diff > 0 && diff < GCALL_SEQ_HALF_RANGE;
}
