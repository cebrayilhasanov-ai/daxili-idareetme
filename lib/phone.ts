// Azerbaijani phone numbers in one shape across the app (Versiya 2.70): "+99450 245 67 69" — the country code with the
// operator/city code, then 3-2-2. Accepts 0502456769, 502456769, +994502456769, "994 50 245 67 69"… A number that is not an
// Azerbaijani one (another country code, or another length) is left as typed, only its spaces tidied.
export function formatPhone(value: string | null | undefined): string {
  const raw = (value || "").trim().replace(/\s+/g, " ");
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  let local: string | null = null;
  if (digits.length === 12 && digits.startsWith("994")) local = digits.slice(3);
  else if (!raw.startsWith("+") && digits.length === 10 && digits.startsWith("0")) local = digits.slice(1);
  else if (!raw.startsWith("+") && digits.length === 9) local = digits;
  if (!local) return raw;
  return `+994${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5, 7)} ${local.slice(7, 9)}`;
}
