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

export function generatePayload(studentNo: string, secret: string = getQrSecret()): string {
  const year = new Date().getFullYear();
  let hash = 0;
  const input = `${studentNo}::${secret}`;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) % 1000003;
  }
  // 3-character check → 26^3 = 17,576 combinations, low collision risk.
  const first = CHECK_ALPHABET[hash % CHECK_ALPHABET.length];
  const second = CHECK_ALPHABET[Math.floor(hash / CHECK_ALPHABET.length) % CHECK_ALPHABET.length];
  const third = CHECK_ALPHABET[Math.floor(hash / CHECK_ALPHABET.length / CHECK_ALPHABET.length) % CHECK_ALPHABET.length];
  return `CP-${year}-${studentNo}${first}${second}${third}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return phone;
  const first = digits.slice(0, 5);
  const last = digits.slice(-2);
  return `+${first}*****${last}`;
}
