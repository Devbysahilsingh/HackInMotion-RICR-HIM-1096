import { useTranslation } from 'react-i18next';

import { GROWTH_STAGES, type StageResult } from '@/api/types';
import { cn } from '@/lib/cn';

/**
 * Where a crop is in its season, drawn as the four FAO-56 stages side by side.
 *
 * The design's crop screen opens with this strip — *Emergence → Vegetative →
 * Pod filling → Maturity* — because "which stage is it in?" is the question
 * every other answer on the page hangs off: the Kc, the irrigation trigger, the
 * fertiliser split and the disease window all move with it.
 *
 * ## What is drawn, and what is not invented
 *
 * The stage names are the engine's own four (`agri:stage.*`), not the crop-
 * specific words the mockup used. A per-crop vocabulary ("pod filling" for
 * soybean, "tillering" for wheat) would be a crop conditional in the UI, which
 * rule 4 forbids, and the registry publishes no such names to read instead.
 *
 * Fill is likewise not guessed. `stage.stageIndex` says which stage the engine
 * placed the crop in; stages before it are complete, stages after it are empty,
 * and the current one is filled by how far through its own published window the
 * crop is (`dayInStage` over the window `stageStartDay…stageEndDay`). When the
 * engine reached no verdict at all — an unsown crop, a crop with no calendar —
 * nothing is drawn rather than a bar sitting at zero, which would read as "this
 * crop has not started" when the truth is "we do not know".
 */
export function CropStageTimeline({
  stage,
  variant = 'labelled',
  className,
}: {
  stage: StageResult;
  /** `compact` is the unlabelled bar used on a crop tile in a grid. */
  variant?: 'labelled' | 'compact';
  className?: string;
}) {
  const { t } = useTranslation('agri');

  if (!stage.hasVerdict || !stage.stage) return null;

  const currentIndex = stage.stageIndex ?? GROWTH_STAGES.indexOf(stage.stage);
  if (currentIndex < 0) return null;

  const window =
    stage.stageStartDay != null && stage.stageEndDay != null
      ? stage.stageEndDay - stage.stageStartDay
      : null;
  const withinCurrent =
    window && window > 0 && stage.dayInStage != null
      ? Math.min(1, Math.max(0, stage.dayInStage / window))
      : // No window published for this stage: the crop is somewhere inside it
        // and the honest drawing is a half-filled band, not a precise one.
        0.5;

  return (
    <div
      className={cn(variant === 'labelled' ? 'space-y-2' : undefined, className)}
      data-testid="crop-stage-timeline"
      data-stage={stage.stage}
    >
      <div
        className="flex gap-1.5"
        role="img"
        aria-label={`${t('stage.' + stage.stage)} — ${currentIndex + 1}/${GROWTH_STAGES.length}`}
      >
        {GROWTH_STAGES.map((name, index) => (
          <span
            key={name}
            className={cn(
              'h-1.5 flex-1 overflow-hidden rounded-full bg-line',
              variant === 'labelled' && 'h-2',
            )}
          >
            <span
              className={cn(
                'block h-full rounded-full',
                index < currentIndex ? 'bg-brand-600' : 'bg-leaf-500',
              )}
              style={{
                width:
                  index < currentIndex
                    ? '100%'
                    : index === currentIndex
                      ? `${withinCurrent * 100}%`
                      : '0%',
              }}
            />
          </span>
        ))}
      </div>

      {variant === 'labelled' && (
        <div className="flex gap-1.5 text-[0.688rem] font-medium">
          {GROWTH_STAGES.map((name, index) => (
            <span
              key={name}
              className={cn(
                'min-w-0 flex-1 truncate',
                index === currentIndex ? 'font-semibold text-brand-600' : 'text-ink-500',
                // The last label is pushed right so the row reads as a scale
                // with two ends rather than four left-aligned words.
                index === GROWTH_STAGES.length - 1 && 'text-right',
              )}
            >
              {t(`stage.${name}`)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
