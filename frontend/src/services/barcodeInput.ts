export const barcodePattern = /^(?:[0-9]{8}|[0-9]{12,14})$/;

export function barcodeFromSearch(value: string): string | undefined {
  const digits = value.trim();
  if (!barcodePattern.test(digits)) return;

  // Catalog numbers can also be numeric. Carry digits over only when their GTIN check digit is valid.
  const body = digits.slice(0, -1);
  const sum = Array.from(body).reduce((total, digit, index) => (
    total + Number(digit) * ((body.length - index) % 2 === 1 ? 3 : 1)
  ), 0);
  if ((10 - sum % 10) % 10 === Number(digits.at(-1))) return digits;
}
