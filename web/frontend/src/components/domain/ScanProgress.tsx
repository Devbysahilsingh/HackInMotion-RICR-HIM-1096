import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';

/**
 * What the server genuinely does with a submitted photograph, in order.
 *
 * Transcribed from `analyzeCropHealth` in
 * `backend/src/services/cropHealthService.js` — sanitize → store → registry
 * lookup → tier walk → knowledge-base guidance. Nothing is listed that the
 * pipeline does not perform: there is no leaf segmentation, no lesion-shape
 * measurement and no background separation in this system, so those are absent
 * however good they would look on a progress list.
 */
const SERVER_STAGES = [
  { key: 'checkPhoto', bodyKey: 'checkPhotoBody' },
  { key: 'checkStored', bodyKey: 'checkStoredBody' },
  { key: 'checkCrop', bodyKey: 'checkCropBody' },
  { key: 'checkMatch', bodyKey: 'checkMatchBody' },
  { key: 'checkGuidance', bodyKey: 'checkGuidanceBody' },
] as const;

type StageState = 'waiting' | 'running' | 'done';

/**
 * The scanning state: the farmer's own photograph, and an honest account of
 * what is being done to it.
 *
 * ## Why the stages are not ticked one by one
 *
 * `POST /crop-health/analyze` is a single request. The client can observe
 * exactly two things: how much of the photograph has been uploaded (a real
 * byte count, from `onUploadProgress`) and whether the response has arrived.
 * Everything between those is server-side and unobservable — so ticking
 * "leaf area found" halfway through would be an animation pretending to be a
 * measurement, which rule 7 forbids as squarely as an invented yield figure.
 *
 * What this does instead: the upload phase reports its true percentage, and the
 * five server stages are shown together as *in progress* — a description of the
 * work, not a claim about which line of it is executing. They settle to done
 * only when the response lands. The account of what actually happened, tier by
 * tier, is on the result page, where `escalationPath` records it for real.
 */
export function ScanProgress({
  previewUrl,
  uploadFraction,
  uploaded,
}: {
  /** The object URL of the file the farmer chose — their photo, not a placeholder. */
  previewUrl: string | null;
  /** 0–1, from the real upload progress event. */
  uploadFraction: number;
  /** True once the bytes are all sent and the server is working. */
  uploaded: boolean;
}) {
  const { t } = useTranslation(['health', 'common']);

  const percent = Math.round(uploadFraction * 100);
  const sendState: StageState = uploaded ? 'done' : 'running';
  const serverState: StageState = uploaded ? 'running' : 'waiting';

  return (
    <div
      className="space-y-6"
      data-testid="scan-analyzing"
      // The one place the app has to speak while the farmer waits.
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center text-center">
        {/*
          Their photograph, at a size worth looking at. The sweep is a slow
          light band travelling down the image — a calm "we are reading this",
          not a targeting reticle. It is decorative and disappears entirely
          under `prefers-reduced-motion`, which the base layer already honours.
        */}
        <div className="relative w-full max-w-sm overflow-hidden rounded-card border border-line bg-canvas">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={t('health:photoAlt')}
              className="block max-h-80 w-full object-contain"
              data-testid="scan-preview"
            />
          ) : (
            <div className="ph h-64 w-full" aria-hidden="true" />
          )}

          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-1/3 animate-[scanSweep_2.4s_ease-in-out_infinite] bg-gradient-to-b from-transparent via-leaf-500/25 to-transparent"
          />
        </div>

        <h2 className="mt-6 text-[1.5rem] sm:text-[1.75rem]">{t('health:scanningTitle')}</h2>
        <p className="mt-2 max-w-[44ch] text-sm text-ink-500">{t('health:scanningBody')}</p>

        {/*
          Determinate while the bytes are moving, because that number is real;
          indeterminate afterwards, because the server does not stream progress
          and a moving bar there would be inventing one.
        */}
        <div
          className="mt-5 h-2 w-full max-w-xs overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuenow={uploaded ? undefined : percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('health:scanningSending')}
        >
          <div
            className={
              uploaded
                ? 'h-full w-1/3 animate-pulse rounded-full bg-brand-600'
                : 'h-full rounded-full bg-brand-600'
            }
            style={uploaded ? undefined : { width: `${percent}%` }}
          />
        </div>
      </div>

      <section>
        <h3 className="kicker">{t('health:stagesHeading')}</h3>

        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StageCard
            state={sendState}
            title={t('health:scanningSending')}
            body={t('health:checkPhotoBody')}
            detail={uploaded ? undefined : `${percent}%`}
          />
          {SERVER_STAGES.map((stage) => (
            <StageCard
              key={stage.key}
              state={serverState}
              title={t(`health:${stage.key}`)}
              body={t(`health:${stage.bodyKey}`)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * One stage. The state word is written out beside the mark — colour and glyph
 * are never the only signal (accessibility.md), and "in progress" has to be
 * distinguishable from "done" in greyscale and to a screen reader.
 */
function StageCard({
  state,
  title,
  body,
  detail,
}: {
  state: StageState;
  title: string;
  body: string;
  detail?: string;
}) {
  const { t } = useTranslation('health');

  const stateLabel =
    state === 'done' ? t('stageDone') : state === 'running' ? t('stageRunning') : t('stageWaiting');

  return (
    <Card
      className={cn('h-full p-4', state === 'waiting' && 'bg-canvas shadow-none')}
      data-testid="scan-stage"
      data-state={state}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[0.688rem] font-bold',
            state === 'done'
              ? 'bg-brand-600 text-white'
              : state === 'running'
                ? 'bg-leaf-tint text-leaf-700'
                : 'border border-line text-ink-400',
          )}
        >
          {state === 'done' ? '✓' : state === 'running' ? '●' : '○'}
        </span>

        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">{body}</p>
          <p
            className={cn(
              'mt-1.5 text-[0.688rem] font-semibold uppercase tracking-[0.1em]',
              state === 'done'
                ? 'text-brand-600'
                : state === 'running'
                  ? 'text-leaf-700'
                  : 'text-ink-400',
            )}
          >
            {stateLabel}
            {detail ? ` · ${detail}` : ''}
          </p>
        </div>
      </div>
    </Card>
  );
}
