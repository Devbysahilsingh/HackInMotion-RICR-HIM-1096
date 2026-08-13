import { useTranslation } from 'react-i18next';

import type { Priority } from '@/api/types';
import { cn } from '@/lib/cn';
import { IconAlertCircle, IconAlertTriangle, IconClock, IconInfo } from './icons';

/**
 * Feed priority, rendered as icon + colour + **text**.
 *
 * Never colour-alone (accessibility.md). The three signals are deliberately
 * redundant: the shape distinguishes the four levels in greyscale, the label
 * distinguishes them for a screen reader, and the colour is what makes a
 * CRITICAL row findable at a glance in sunlight. Removing any one of the three
 * still leaves the chip readable — that redundancy is the point, and
 * `PriorityChip.test.tsx` asserts the icon and the text are both present.
 */
const STYLE: Record<Priority, { className: string; Icon: typeof IconInfo }> = {
  CRITICAL: {
    className: 'bg-priority-critical-soft text-priority-critical border-priority-critical/30',
    Icon: IconAlertTriangle,
  },
  HIGH: {
    className: 'bg-priority-high-soft text-priority-high border-priority-high/30',
    Icon: IconAlertCircle,
  },
  MEDIUM: {
    className: 'bg-priority-medium-soft text-priority-medium border-priority-medium/30',
    Icon: IconClock,
  },
  INFO: {
    className: 'bg-priority-info-soft text-priority-info border-priority-info/30',
    Icon: IconInfo,
  },
};

export function PriorityChip({ priority, className }: { priority: Priority; className?: string }) {
  const { t } = useTranslation('common');
  const style = STYLE[priority] ?? STYLE.INFO;
  const { Icon } = style;

  return (
    <span
      data-testid="priority-chip"
      data-priority={priority}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
        style.className,
        className,
      )}
    >
      <Icon size={14} />
      <span>{t(`priority.${priority}`)}</span>
    </span>
  );
}
