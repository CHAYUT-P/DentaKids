/**
 * The PromptPay "Thai QR" payload (EMVCo merchant-presented QR) for a phone
 * number or a 13-digit tax/ID number, with the amount filled in so the
 * family's banking app only asks them to confirm.
 */

const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, "0")}${value}`;

/** CRC-16/CCITT-FALSE, the checksum Thai QR codes end with */
export function crc16(s: string): string {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** null when the id is neither a Thai mobile number nor a 13-digit id */
export function promptPayPayload(id: string, amount?: number): string | null {
  const digits = id.replace(/\D/g, "");
  let target: string;
  if (digits.length === 10 && digits.startsWith("0")) target = tlv("01", `0066${digits.slice(1)}`);
  else if (digits.length === 13) target = tlv("02", digits);
  else return null;

  const body =
    tlv("00", "01") +
    tlv("01", amount ? "12" : "11") +
    tlv("29", tlv("00", "A000000677010111") + target) +
    tlv("53", "764") +
    (amount ? tlv("54", amount.toFixed(2)) : "") +
    tlv("58", "TH") +
    "6304";
  return body + crc16(body);
}
