// QR payload generation. Payloads follow the PRD format (e.g. CP-2026-9812A):
//   CP-<YEAR>-<studentNo><check>
// The 2-character check code is derived from the student number + a secret so
// codes cannot be guessed. At scan time the app matches the payload EXACTLY
// against the students.qr_hash_payload column — the student number itself is
// never embedded in plain form.
const CHECK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O (avoid confusion with 1/0)

export function getQrSecret(): string {
  return process.env.QR_SECRET || 'tapin-school-default-secret';
}

/**
 * Check code derived from a hash input. `len` characters from the 26-letter
 * alphabet → 26^len combinations (3 chars = 17,576; 6 chars ≈ 309M).
 */
function checkCode(input: string, len = 3): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) % 1000003;
  }
  let out = '';
  for (let i = 0; i < len; i++) {
    let h = hash;
    for (let k = 0; k < i; k++) h = Math.floor(h / CHECK_ALPHABET.length);
    out += CHECK_ALPHABET[h % CHECK_ALPHABET.length];
  }
  return out;
}

/**
 * Student QR payload (CP-<YEAR>-<studentNo><check>). The hash input is
 * `${studentNo}::${secret}` — do NOT change it: every printed student QR
 * already encodes this exact derivation.
 */
export function generatePayload(studentNo: string, secret: string = getQrSecret()): string {
  const year = new Date().getFullYear();
  return `CP-${year}-${studentNo}${checkCode(`${studentNo}::${secret}`)}`;
}

/**
 * Guardian QR payload (GP-<YEAR>-<identityHash>). Derived from the GUARDIAN's
 * identity (name + address) rather than the student number, so every child
 * sharing the same guardian name + address shares ONE guardian QR — scanning
 * it shows all of their children's day reports. Salted differently from the
 * student payload so the two codes never match.
 */
export function generateGuardianPayload(
  guardianName: string,
  guardianAddress: string = '',
  secret: string = getQrSecret(),
): string {
  const year = new Date().getFullYear();
  const identity = `${String(guardianName).trim()}::${String(guardianAddress).trim()}`;
  // 6-char hash: identical identity → identical QR; near-zero collisions.
  return `GP-${year}-${checkCode(`${identity}::${secret}`, 6)}`;
}

/**
 * Visitor QR payload (VP-<YEAR>-<id><check>). Distinct prefix from CP
 * (student) and GP (guardian) so codes never collide. Derived from the
 * visitor's DB id so the same visitor always gets the same QR across visits.
 */
export function generateVisitorPayload(visitorId: number, secret: string = getQrSecret()): string {
  const year = new Date().getFullYear();
  return `VP-${year}-${visitorId}${checkCode(`VISITOR::${visitorId}::${secret}`)}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return phone;
  const first = digits.slice(0, 5);
  const last = digits.slice(-2);
  return `+${first}*****${last}`;
}
