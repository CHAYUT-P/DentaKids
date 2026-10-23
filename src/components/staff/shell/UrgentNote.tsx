import { isUrgent, URGENT_MARK } from "@/lib/urgent";

/**
 * A booking's note on the queue and schedule: a family's "in pain /
 * emergency" mark stands out in red so the desk can fit them in first; any
 * other note shows as one quiet line.
 */
export function UrgentNote({ note, compact = false }: { note?: string | null; compact?: boolean }) {
  const text = (note ?? "").trim();
  if (!text) return null;
  if (isUrgent(text)) {
    const rest = text.slice(URGENT_MARK.length).replace(/^\s*—\s*/, "");
    return (
      <span className="urgent-note" title={text}>
        <span className="urgent-tag">{URGENT_MARK}</span>
        {!compact && rest ? <span className="urgent-text">{rest}</span> : null}
      </span>
    );
  }
  if (compact) return null;
  return (
    <span className="tr-note" title={text}>
      {text}
    </span>
  );
}
