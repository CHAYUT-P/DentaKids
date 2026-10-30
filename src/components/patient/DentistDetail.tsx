"use client";

import Link from "next/link";

import type { Dentist } from "@/data/dentists";
import { useLang } from "@/i18n/lang";
import { Check, Star } from "@/components/shared/icons";
import { DentistPortrait } from "@/components/patient/portrait";
import { Cta, Eyebrow, Ledger, Panel, Row, Screen } from "@/components/patient/screen";
import { ServiceIcon } from "@/components/shared/serviceIcons";

/**
 * The big profile: the large picture, the description, and what this dentist
 * takes bookings for. Each treatment chip books that treatment with this
 * dentist, which is the whole point of arriving here from the roster.
 */
export function DentistDetail({ d }: { d: Dentist }) {
  const { t, lang } = useLang();
  const x = d.text[lang];
  return (
    <Screen title={x.name} back="/dentists">
      <div className={`docHero t-${d.tint}`}>
        <DentistPortrait d={d} alt={x.name} />
        <div className="docHeroText">
          <div className="docName big">{x.name}</div>
          <div className="docTitle">{x.title}</div>
          {d.years > 0 ? (
            <span className="yrs solid">
              <Star size={11} />
              {d.years} {t.common.years} {t.common.exp}
            </span>
          ) : null}
        </div>
      </div>

      {x.bio ? (
        <>
          <Eyebrow>{t.dentistsPage.bio}</Eyebrow>
          <Panel>
            <p className="prose">{x.bio}</p>
          </Panel>
        </>
      ) : null}

      {x.credentials.length > 0 ? (
        <>
          <Eyebrow>{t.dentistsPage.credentials}</Eyebrow>
          <ul className="creds">
            {x.credentials.map((c) => (
              <li key={c}>
                <span className="cTick">
                  <Check size={11} />
                </span>
                {c}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <Ledger>
        {d.licenseNo ? <Row k={t.dentistsPage.license} v={d.licenseNo} /> : null}
        {x.languages ? <Row k={t.dentistsPage.languages} v={x.languages} /> : null}
        <Row k={t.dentistsPage.availability} v={x.days} />
      </Ledger>

      <Eyebrow>{t.dentistsPage.treats}</Eyebrow>
      <div className="chips">
        {d.treats.map((k) => (
          <Link key={k} href={`/book?t=${k}&d=${d.slug}`} className="chip">
            <ServiceIcon k={k} size={17} />
            {t.service[k]}
          </Link>
        ))}
      </div>

      <Cta href={`/book?d=${d.slug}`}>{t.dentistsPage.bookWith}</Cta>
    </Screen>
  );
}
