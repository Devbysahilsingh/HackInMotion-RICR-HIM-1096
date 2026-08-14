import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { FeedItem, Freshness } from '@/api/types';
import { translateMessageKey } from '@/i18n/messageKey';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FreshnessDot } from '@/components/ui/FreshnessDot';
import { PriorityChip } from '@/components/ui/PriorityChip';
import { SpeakButton } from '@/components/ui/SpeakButton';
import { IconCheck } from '@/components/ui/icons';
import { localizeCropParams, useCropNames } from '@/hooks/useCropNames';
import { cn } from '@/lib/cn';
import { feedTarget } from '@/lib/feedTarget';
import { WhyTrace } from './WhyTrace';

/**
 * One row of the action feed.
 *
 * Everything visible comes from the item's own `titleKey`/`bodyKey` plus its
 * `data` as interpolation params — the API never sends prose (rule 8), so the
 * card cannot render anything the knowledge base did not author.
 *
 * The "why?" expander sits inline rather than on a separate screen: it is the
 * explainability promise (FR: every recommendation explainable), and putting
 * it a navigation away would make it something nobody reads.
 */
export function FeedItemCard({
  item,
  onAcknowledge,
  isAcknowledging = false,
  tone = 'default',
}: {
  item: FeedItem;
  onAcknowledge?: (item: FeedItem) => void;
  isAcknowledging?: boolean;
  /**
   * `attention` is the design's warm-tinted panel for the one item it singles
   * out beside the day's decision. It changes the card's ground, not its
   * content — the priority chip still carries the ranked meaning, so the tint
   * is never the only thing saying "look here".
   */
  tone?: 'default' | 'attention';
}) {
  const { t } = useTranslation(['common', 'irrigation', 'weather', 'market', 'health']);
  const cropName = useCropNames();

  // `data` is interpolation params. A `cropCode` inside it is a canonical id
  // (`COTTON`), and ids never reach a farmer's screen — the community strings
  // say "reported this on {{cropCode}}", which must read कपास in Hindi.
  const params = localizeCropParams(item.data, cropName);
  const title = translateMessageKey(t, item.titleKey, params);
  const body = translateMessageKey(t, item.bodyKey, params);

  // Passed through as-is: `WhyTrace` handles both shapes the feed emits — an
  // array of engine steps, and the flat number object a weather risk carries.
  const trace = item.data?.trace ?? null;

  /*
   * Irrigation items carry the freshness of the weather their verdict was
   * computed from (`feedComposer.js`: `freshness: result.freshness`). Showing
   * it is not optional decoration — rule 9 requires cached content to be
   * labelled, and "water this crop today" derived from a three-day-old
   * forecast is exactly the case where a farmer needs to know.
   */
  const freshness = isFreshness(item.data?.freshness) ? item.data.freshness : null;

  const target = feedTarget(item);
  const acknowledged = item.acknowledgedAt !== null;

  return (
    <Card
      data-testid="feed-item"
      data-priority={item.priority}
      data-type={item.type}
      className={cn(
        'overflow-hidden',
        tone === 'attention' && 'border-harvest-500 bg-harvest-tint',
        item.priority === 'CRITICAL' && 'border-priority-critical/40',
        acknowledged && 'opacity-60',
      )}
    >
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <PriorityChip priority={item.priority} />
          <SpeakButton text={`${title}. ${body}`} />
        </div>

        <div>
          <h3 className="text-base font-semibold" data-testid="feed-item-title">
            {title}
          </h3>
          <p className="mt-1 text-sm text-ink-700">{body}</p>
        </div>

        {freshness && <FreshnessDot freshness={freshness} />}

        <WhyTrace trace={trace} />

        <div className="flex flex-wrap items-center gap-2">
          {target && (
            <Link
              to={target}
              className="text-sm font-semibold text-brand-700 underline underline-offset-2"
            >
              {t('common:action.viewAll')}
            </Link>
          )}

          {onAcknowledge && !acknowledged && (
            <Button
              variant="secondary"
              size="md"
              className="ml-auto"
              data-testid="feed-ack"
              isLoading={isAcknowledging}
              leadingIcon={<IconCheck size={16} />}
              onClick={() => onAcknowledge(item)}
            >
              {t('common:action.done')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * The feed's `data` is an open bag, so the freshness block is checked rather
 * than cast — a malformed one must render nothing, not a broken dot.
 */
function isFreshness(value: unknown): value is Freshness {
  return (
    typeof value === 'object' && value !== null && typeof (value as Freshness).status === 'string'
  );
}
