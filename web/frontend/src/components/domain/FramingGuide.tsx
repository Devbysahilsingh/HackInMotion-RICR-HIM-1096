import { useTranslation } from 'react-i18next';

import { IconCheck } from '@/components/ui/icons';

/**
 * What a usable photograph looks like, drawn rather than photographed.
 *
 * The empty half of the hero used to be a grey box with a file-type line in it
 * — the largest area on the screen saying the least. It now carries the single
 * thing that most changes whether a farmer gets a usable answer: how to frame
 * the shot.
 *
 * **A diagram, deliberately, not an example photo.** A real leaf picture here
 * would be somebody else's field presented as guidance on this screen, and the
 * next thing under it is the farmer's own photo in the same slot — two images
 * that mean completely different things in one frame. An obvious line drawing
 * cannot be mistaken for evidence (rule 7).
 *
 * Inline SVG, so it costs no request, scales to any width, and inherits
 * `currentColor` — which is what lets it sit on the cream panel without a
 * second asset for a dark surface.
 */
export function FramingGuide() {
  const { t } = useTranslation('health');

  const rules = [t('framingFill'), t('framingDaylight'), t('framingSteady')];

  return (
    <div className="w-full max-w-xs text-center">
      <svg
        viewBox="0 0 200 150"
        className="mx-auto w-full max-w-[13rem]"
        role="img"
        aria-label={t('framingHeading')}
      >
        {/*
          The viewfinder: four corner marks rather than a full rectangle, which
          is the universal "frame it here" and does not read as a photo border.
        */}
        <g stroke="currentColor" className="text-line-strong" strokeWidth="3" fill="none">
          <path d="M8 30 V12 H26" strokeLinecap="round" />
          <path d="M174 12 H192 V30" strokeLinecap="round" />
          <path d="M192 120 V138 H174" strokeLinecap="round" />
          <path d="M26 138 H8 V120" strokeLinecap="round" />
        </g>

        {/*
          A leaf that genuinely fills the frame — the rule the drawing exists to
          teach. Blade, midrib and two veins: enough to read as a leaf at 200px
          and nothing more.
        */}
        <g transform="translate(100 75)">
          <path
            d="M0 -52 C34 -34 46 0 0 52 C-46 0 -34 -34 0 -52 Z"
            className="fill-leaf-tint stroke-leaf-600"
            strokeWidth="3"
          />
          <path
            d="M0 -46 V46"
            className="stroke-leaf-600"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path
            d="M0 -18 L24 -30 M0 8 L26 -2 M0 -18 L-24 -30 M0 8 L-26 -2"
            className="stroke-leaf-600/60"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
          {/*
            Three lesions, because the farmer is being asked to photograph
            damage. Amber rather than red: this is a diagram of a photograph,
            not a severity claim.
          */}
          <circle cx="-11" cy="-8" r="5" className="fill-harvest-500/70" />
          <circle cx="9" cy="14" r="4" className="fill-harvest-500/70" />
          <circle cx="6" cy="-24" r="3" className="fill-harvest-500/70" />
        </g>
      </svg>

      <p className="kicker mt-4">{t('framingHeading')}</p>

      <ul className="mt-2.5 space-y-1.5 text-left">
        {rules.map((rule) => (
          <li key={rule} className="flex items-start gap-2 text-sm text-ink-700">
            <IconCheck size={16} className="mt-0.5 shrink-0 text-leaf-600" aria-hidden="true" />
            {rule}
          </li>
        ))}
      </ul>
    </div>
  );
}
