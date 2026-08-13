import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Freshness, Priority } from '@/api/types';
import { ConfidenceBar } from '@/components/domain/ConfidenceBar';
import { WhyTrace } from '@/components/domain/WhyTrace';
import { PageHeader } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, Section } from '@/components/ui/Card';
import {
  CheckboxField,
  RadioCardGroup,
  SelectField,
  TextAreaField,
  TextField,
} from '@/components/ui/Field';
import { FreshnessDot, SourceLabel } from '@/components/ui/FreshnessDot';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { PriorityChip } from '@/components/ui/PriorityChip';
import { SkeletonCard, SkeletonList, SkeletonText } from '@/components/ui/Skeleton';
import { SpeakButton } from '@/components/ui/SpeakButton';
import { Spinner } from '@/components/ui/Spinner';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { EmptyState, ErrorState, Notice } from '@/components/ui/states';

/**
 * The primitive showcase (docs/frontend/component-map.md: "storybook skipped
 * (time) — showcase route `/dev/components` in dev builds only — **not a
 * hidden prod route** — stripped from prod bundle").
 *
 * That distinction is the whole point and is enforced in `App.tsx`: the route
 * is registered behind `import.meta.env.DEV`, so Rollup's dead-code
 * elimination removes both the route and this module from a production build.
 * There is no runtime flag, no query parameter and no header that can reach
 * it on a deployed host — which is what keeps it from being the kind of hidden
 * route CLAUDE.md rule 2 forbids.
 *
 * Every string here is a literal on purpose: this page has no farmer audience,
 * and translating a swatch label would only add keys nobody reads. The i18n
 * gate exempts `pages/dev/` for exactly that reason (`check-ui-strings.mjs`).
 */
const PRIORITIES: Priority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'INFO'];

const FRESHNESS: Freshness[] = [
  { status: 'live', source: 'open-meteo', fetchedAt: new Date().toISOString() },
  {
    status: 'cached',
    source: 'openweather',
    fetchedAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
  },
  { status: 'cached', source: 'openweather', fetchedAt: null, staleWarning: true },
  { status: 'historical', source: 'seed', latestDate: null },
  { status: 'pending', source: null, fetchedAt: null },
];

const SAMPLE_TRACE = [
  { step: 'INPUT', soilType: 'black', weatherDays: 14, logCount: 2 },
  { step: 'RESERVOIR', tawMm: 92.4, rawMm: 36.9, p: 0.4 },
  { step: 'VERDICT', verdict: 'IRRIGATE_TODAY', depletionMm: 38.2, amountMm: 40 },
];

export default function ComponentShowcase() {
  const { t } = useTranslation('common');
  const toast = useToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tab, setTab] = useState('one');
  const [radio, setRadio] = useState<string>();

  return (
    <>
      <PageHeader
        title="Component showcase"
        description="Development build only — this route does not exist in a production bundle."
        actions={<LanguageToggle />}
      />

      <div className="space-y-10">
        <Section title="Buttons" as="h2">
          <div className="flex flex-wrap gap-2">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button isLoading>Loading</Button>
            <Button disabled>Disabled</Button>
            <Button size="lg">Large</Button>
          </div>
        </Section>

        <Section title="Priority chips — icon + colour + text, never colour alone" as="h2">
          <div className="flex flex-wrap gap-2">
            {PRIORITIES.map((priority) => (
              <PriorityChip key={priority} priority={priority} />
            ))}
          </div>
          {/* The greyscale row is the accessibility check made visible. */}
          <div className="flex flex-wrap gap-2 grayscale">
            {PRIORITIES.map((priority) => (
              <PriorityChip key={priority} priority={priority} />
            ))}
          </div>
        </Section>

        <Section title="Freshness — the honesty labels" as="h2">
          <div className="flex flex-wrap items-center gap-4">
            {FRESHNESS.map((freshness, index) => (
              <FreshnessDot key={index} freshness={freshness} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <SourceLabel sourceLabelKey="health.sourceLocalAi" />
            <SourceLabel sourceLabelKey="health.sourceAiAssisted" />
            <SourceLabel sourceLabelKey="health.sourceGuided" />
          </div>
        </Section>

        <Section title="Badges" as="h2">
          <div className="flex flex-wrap gap-2">
            <Badge>Neutral</Badge>
            <Badge tone="brand">Brand</Badge>
            <Badge tone="warning">Warning</Badge>
            <Badge tone="danger">Danger</Badge>
            <Badge tone="success">Success</Badge>
          </div>
        </Section>

        <Section title="Notices and states" as="h2">
          <Notice tone="info">An informational notice.</Notice>
          <Notice tone="warning">A warning notice.</Notice>
          <Notice tone="danger">A failure notice.</Notice>
          <EmptyState title="Nothing here yet" body="With guidance and a way forward." />
          <ErrorState
            message="A localized failure message."
            onRetry={() => toast.push('Retried')}
          />
        </Section>

        <Section title="Loading" as="h2">
          <div className="flex items-center gap-4">
            <Spinner size="sm" />
            <Spinner />
            <Spinner size="lg" />
          </div>
          <SkeletonText lines={3} />
          <SkeletonCard />
          <SkeletonList count={2} />
        </Section>

        <Section title="Form controls" as="h2">
          <Card>
            <div className="space-y-4 p-4">
              <TextField label="Text field" placeholder="Type here" />
              <TextField label="With hint" hint="A helpful hint." />
              <TextField label="With error" error="Something is wrong with this." />
              <SelectField label="Select">
                <option>First</option>
                <option>Second</option>
              </SelectField>
              <TextAreaField label="Text area" placeholder="Longer text" />
              <CheckboxField label="A checkbox" hint="With a hint underneath." />
              <RadioCardGroup
                name="showcase-radio"
                legend="Radio cards"
                value={radio}
                onChange={setRadio}
                options={[
                  { value: 'a', label: 'Option A', description: 'With a description' },
                  { value: 'b', label: 'Option B' },
                ]}
              />
            </div>
          </Card>
        </Section>

        <Section title="Tabs" as="h2">
          <Tabs
            label="Showcase tabs"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'one', label: 'First' },
              { value: 'two', label: 'Second' },
              { value: 'three', label: 'Third' },
            ]}
          />
          <TabPanel id="showcase-panel">
            <p className="text-sm text-ink-700">Panel content for: {tab}</p>
          </TabPanel>
        </Section>

        <Section title="Overlays" as="h2">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setModalOpen(true)}>Open modal</Button>
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>
              Open confirm
            </Button>
            <Button variant="secondary" onClick={() => toast.push('A confirmation toast')}>
              Success toast
            </Button>
            <Button variant="secondary" onClick={() => toast.push('A failure toast', 'error')}>
              Error toast
            </Button>
          </div>
        </Section>

        <Section title="Explainability" as="h2">
          <WhyTrace trace={SAMPLE_TRACE} />
          <Card>
            <div className="space-y-6 p-4">
              <ConfidenceBar confidence={0.93} kind="CALIBRATED" />
              <ConfidenceBar confidence={0.65} kind="BAND" band="MEDIUM" />
              <ConfidenceBar confidence={0.42} kind="MATCH_SCORE" band="LOW" />
            </div>
          </Card>
        </Section>

        <Section title="Text to speech" as="h2">
          <div className="flex items-center gap-2">
            <SpeakButton text={t('app.tagline')} />
            <span className="text-sm text-ink-500">
              Renders nothing where the browser has no speech synthesis.
            </span>
          </div>
        </Section>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="A modal dialog"
        footer={<Button onClick={() => setModalOpen(false)}>Close</Button>}
      >
        <p className="text-sm text-ink-700">
          Focus is trapped, ESC closes, and focus returns to the opener.
        </p>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => setConfirmOpen(false)}
        title="Delete this thing?"
        body="This cannot be undone."
      />
    </>
  );
}
