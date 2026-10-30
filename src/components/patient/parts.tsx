"use client";

import Link from "next/link";
import { useTreatments } from "@/lib/treatmentsContext";

import type { Dentist } from "@/data/dentists";
import type { Service } from "@/data/services";
import type { ClinicInfoDTO } from "@/server/queries";
import { LANG_LABEL, type Lang } from "@/i18n/dict";
import { useLang, useT } from "@/i18n/lang";
import { Bell, Chevron, Clock, LogoMark, Phone, Pin, Star } from "@/components/shared/icons";
import { ServiceIcon } from "@/components/shared/serviceIcons";
import { Mascot } from "@/components/shared/Mascot";
import { DentistAvatar } from "@/components/patient/portrait";

/** Thai / English, in the header row just left of the bell. Thai is the default. */
export function LangSwitch() {
  const { lang, setLang, t } = useLang();
  const options: Lang[] = ["th", "en"];
  return (
    <div className="langSwitch" role="group" aria-label={t.langSwitch}>
      {options.map((l) => (
        <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
          {LANG_LABEL[l]}
        </button>
      ))}
    </div>
  );
}

export function Header() {
  const t = useT();
  return (
    <header className="header">
      <div className="mark">
        <LogoMark />
      </div>
      <div className="who">
        {/* the brand stays Latin in both languages */}
        <div className="name" lang="en">
          {t.clinic.name}
        </div>
        <div className="tag">{t.clinic.tagline}</div>
      </div>
      <LangSwitch />
      <Link href="/notifications" className="bell" aria-label={t.notifications}>
        <Bell />
      </Link>
    </header>
  );
}

/** `href` omitted means the heading stands alone, with no "see all" link. */
export function SectionHead({ title, href }: { title: string; href?: string }) {
  const t = useT();
  return (
    <div className="sectionHead">
      <h2>{title}</h2>
      {href ? (
        <Link href={href} className="seeAll">
          <span>{t.seeAll}</span>
          <Chevron />
        </Link>
      ) : null}
    </div>
  );
}

export function ServiceGrid({ items, cols = 5 }: { items: Service[]; cols?: 3 | 5 }) {
  const { t, lang } = useLang();
  const tr = useTreatments();
  // a tile whose treatment the clinic switched off disappears ("more" stays)
  const shown = items.filter((s) => s.key === "more" || tr.list.length === 0 || tr.get(s.key).isActive);
  return (
    <div className={cols === 3 ? "grid cols3" : "grid"}>
      {shown.map((s) => (
        <Link
          key={s.key}
          /* the last tile is the way out to the full list, not a treatment */
          href={s.key === "more" ? "/services" : `/book?t=${s.key}`}
          className="tile"
        >
          <span className={`disc t-${s.tint}`}>
            <ServiceIcon k={s.key === "more" ? "more" : tr.icon(s.key)} size={cols === 3 ? 35 : 31} />
          </span>
          <span className="label">{s.key === "more" ? t.service.more : tr.name(s.key, lang)}</span>
        </Link>
      ))}
    </div>
  );
}

/**
 * The three-fact strip on the home page: today's hours, the phone number and
 * the address — all from the database (clinic_day + clinic_info), so the staff
 * app edits what this shows. Tapping opens the clinic page.
 */
export function InfoRow({
  hours,
  info,
  todayKey,
}: {
  hours?: { day: string; isOpen: boolean; start: string; end: string }[];
  info?: ClinicInfoDTO | null;
  /** which weekday "today" is — computed on the server, never in the browser */
  todayKey?: string;
}) {
  const { t, lang } = useLang();

  const todayRow = hours?.find((h) => h.day === todayKey);
  const hoursLine = todayRow
    ? todayRow.isOpen
      ? `${todayRow.start} - ${todayRow.end}`
      : t.common.closed
    : "–";
  // straight from clinic_info — a blank field shows a dash, never a made-up value
  const phone = info?.phoneDisplay || "–";
  const address = (lang === "th" ? info?.addressTh : info?.addressEn) || "–";

  return (
    <Link href="/clinic" className="info">
      <div className="col">
        <div className="top">
          <Clock />
          <span className="k">{t.clinic.hoursLabel}</span>
        </div>
        <div className="v">{hoursLine}</div>
      </div>
      <div className="col">
        <div className="top">
          <Phone />
          <span className="k">{t.clinic.phoneLabel}</span>
        </div>
        <div className="v">{phone}</div>
      </div>
      <div className="col">
        <div className="top">
          <Pin />
          <span className="k">{t.clinic.addressLabel}</span>
        </div>
        <div className="v">{address}</div>
      </div>
    </Link>
  );
}

export function Ribbon({ msg, face = true }: { msg: string; face?: boolean }) {
  return (
    <footer className="ribbon">
      {face ? <Mascot h={22} id="rib" /> : null}
      <span className="msg">{msg}</span>
    </footer>
  );
}

/**
 * The dentists on the home page: a swipeable row of faces, because parents pick
 * the dentist their child already knows. Tapping one opens the full profile.
 * The roster arrives as a prop — the DB decides who is active.
 */
export function DentistStrip({ list }: { list: Dentist[] }) {
  const { t, lang } = useLang();
  return (
    <div className="docStrip">
      {list.map((d) => {
        const x = d.text[lang];
        return (
          <Link key={d.slug} href={`/dentists/${d.slug}`} className="docMini">
            <DentistAvatar d={d} alt={x.name} size={58} />
            <span className="dmName">{x.name}</span>
            <span className="dmTitle">{x.title}</span>
            {d.years > 0 ? (
              <span className="dmYrs">
                <Star size={9} />
                {d.years} {t.common.years}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
