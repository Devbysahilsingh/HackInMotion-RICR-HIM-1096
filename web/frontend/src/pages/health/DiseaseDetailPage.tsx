import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';

import { DiseaseName } from '@/components/domain/DiseaseName';
import { PageHeader } from '@/components/layout/AppLayout';
import { ButtonLink } from '@/components/ui/Button';
import { Card, Section } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/states';

/**
 * One disease, in full.
 *
 * A scan result names a disease and gives the few lines that matter right now.
 * This is where the rest of what is known about it lives: what it looks like,
 * what to check in the field, what to do, and how to keep it out next season.
 *
 * ## The design does not have this screen
 *
 * The prototype declares a `disease` route and gives it a title ("Purple
 * blotch") but never draws it — there is no `isDisease` block in the file. So
 * this page is built from the design's *language* (the hero, the kicker-led
 * sections, the card rhythm) rather than copied from a mockup, and that is worth
 * knowing when comparing the two.
 *
 * ## Where the words come from
 *
 * Entirely from the `disease` namespace — 408 English strings compiled from
 * TNAU, ICAR and NIPHM publications, keyed `CODE.section.n`. Nothing here is
 * authored by the app or by a model: this page selects and renders sourced
 * text, which is the same contract the scan result honours (rule 6 — the KB
 * speaks).
 *
 * Note what the KB deliberately does not contain: pesticide doses. The
 * `nextStep` entries say so themselves and point at a KVK and the Kisan Call
 * Centre. That is a property of the source data, not a gap in this page.
 */

/** The KB's sections, in the order a farmer needs them. */
const SECTIONS = [
  { part: 'symptom', headingKey: 'health:symptomsHeading' },
  { part: 'inspect', headingKey: 'health:inspectHeading' },
  { part: 'nextStep', headingKey: 'health:nextStepHeading' },
  { part: 'prevention', headingKey: 'health:preventionHeading' },
] as const;

/**
 * No entry in the KB has more than a handful of lines per section; this is the
 * ceiling on the probe, not a claim about the data.
 */
const MAX_ENTRIES = 12;

export default function DiseaseDetailPage() {
  const { t, i18n } = useTranslation(['health', 'disease', 'common']);
  const { code = '' } = useParams();
  const [searchParams] = useSearchParams();
  const cropCode = searchParams.get('cropCode') ?? undefined;

  /*
   * The KB is a flat key-value file, so the entries for a section are
   * discovered by walking `CODE.part.1`, `.2`, … until one is missing.
   * `i18n.exists` is used rather than `t(...)` with a fallback, because `t`
   * returns the key itself when a string is absent and that would print
   * `ONION_PURPLE_BLOTCH.symptom.5` at a farmer.
   */
  const sections = SECTIONS.map(({ part, headingKey }) => {
    const entries: string[] = [];
    for (let index = 1; index <= MAX_ENTRIES; index += 1) {
      const key = `${code}.${part}.${index}`;
      if (!i18n.exists(key, { ns: 'disease' })) break;
      entries.push(t(key, { ns: 'disease' }));
    }
    return { part, headingKey, entries };
  }).filter((section) => section.entries.length > 0);

  return (
    <>
      <PageHeader
        title={code}
        kicker={t('health:diseaseKicker')}
        description={<DiseaseName code={code} cropCode={cropCode} showFallbackNote />}
        actions={
          <ButtonLink to="/scan" variant="secondary">
            {t('common:nav.scan')}
          </ButtonLink>
        }
      />

      {sections.length === 0 ? (
        /*
          A code with no KB entry is a real state: the registry carries more
          disease codes than the knowledge base has text for. Saying so is
          better than an empty page that looks broken.
        */
        <EmptyState title={t('health:noGuidance')} />
      ) : (
        <div className="space-y-6">
          {sections.map((section) => (
            <Section key={section.part} title={t(section.headingKey)} as="h2">
              <Card className="p-5">
                <ul className="space-y-3">
                  {section.entries.map((entry, index) => (
                    <li key={index} className="flex gap-3 text-[0.938rem] leading-relaxed">
                      <span
                        aria-hidden="true"
                        className="mt-0.5 font-display text-sm font-extrabold text-leaf-600"
                      >
                        {index + 1}
                      </span>
                      {entry}
                    </li>
                  ))}
                </ul>
              </Card>
            </Section>
          ))}
        </div>
      )}
    </>
  );
}
