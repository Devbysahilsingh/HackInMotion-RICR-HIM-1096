import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from '@/lib/cn';

const CONTROL =
  'touch-target w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base ' +
  'text-ink-900 placeholder:text-ink-500/70 disabled:bg-canvas disabled:text-ink-500';
const CONTROL_INVALID = 'border-danger-600 bg-danger-50/40';

interface FieldShellProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}

/**
 * Label, control, hint and error as one unit.
 *
 * The wiring is the point: `aria-describedby` names the hint *and* the error,
 * and `aria-invalid` flips with the error, so a screen-reader user hears why a
 * field was rejected instead of just that it was. Every form control in the
 * app goes through here, which is what keeps that from being remembered
 * per-form (accessibility.md: "labeled inputs").
 */
export function Field({ label, hint, error, required, children, className }: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink-700">
        {label}
        {required && (
          <span className="ml-1 text-danger-600" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {children({ id, describedBy, invalid: Boolean(error) })}

      {hint && (
        <p id={hintId} className="text-xs text-ink-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-danger-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>;

export interface TextFieldProps extends NativeInputProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  containerClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, required, className, containerClassName, ...rest },
  ref,
) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      {({ id, describedBy, invalid }) => (
        <input
          ref={ref}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          className={cn(CONTROL, invalid && CONTROL_INVALID, className)}
          {...rest}
        />
      )}
    </Field>
  );
});

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  containerClassName?: string;
  children: ReactNode;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, required, className, containerClassName, children, ...rest },
  ref,
) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      {({ id, describedBy, invalid }) => (
        <select
          ref={ref}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          className={cn(CONTROL, 'pr-8', invalid && CONTROL_INVALID, className)}
          {...rest}
        >
          {children}
        </select>
      )}
    </Field>
  );
});

export interface TextAreaFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id'
> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  containerClassName?: string;
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField(
    { label, hint, error, required, className, containerClassName, rows = 3, ...rest },
    ref,
  ) {
    return (
      <Field
        label={label}
        hint={hint}
        error={error}
        required={required}
        className={containerClassName}
      >
        {({ id, describedBy, invalid }) => (
          <textarea
            ref={ref}
            id={id}
            rows={rows}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            required={required}
            className={cn(CONTROL, 'min-h-24', invalid && CONTROL_INVALID, className)}
            {...rest}
          />
        )}
      </Field>
    );
  },
);

export interface CheckboxFieldProps extends Omit<NativeInputProps, 'type'> {
  label: ReactNode;
  hint?: ReactNode;
}

export const CheckboxField = forwardRef<HTMLInputElement, CheckboxFieldProps>(
  function CheckboxField({ label, hint, className, ...rest }, ref) {
    const id = useId();
    const hintId = hint ? `${id}-hint` : undefined;

    return (
      <div className="space-y-1">
        <div className="flex items-start gap-3">
          <input
            ref={ref}
            id={id}
            type="checkbox"
            aria-describedby={hintId}
            className={cn('mt-0.5 h-5 w-5 shrink-0 rounded border-line text-brand-600', className)}
            {...rest}
          />
          <label htmlFor={id} className="text-sm text-ink-700">
            {label}
          </label>
        </div>
        {hint && (
          <p id={hintId} className="pl-8 text-xs text-ink-500">
            {hint}
          </p>
        )}
      </div>
    );
  },
);

/**
 * A radio group rendered as large tappable cards.
 *
 * Used for the severity follow-up and the crop-rec wizard, where the options
 * are few, the answer matters, and the target has to survive a dusty screen.
 * Native radios underneath, so keyboard and screen-reader behaviour is the
 * platform's rather than a re-implementation.
 */
export function RadioCardGroup<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  error,
  columns = 2,
}: {
  name: string;
  legend: ReactNode;
  options: { value: T; label: ReactNode; description?: ReactNode }[];
  value: T | undefined;
  onChange: (value: T) => void;
  error?: ReactNode;
  columns?: 1 | 2 | 3;
}) {
  const gridClass =
    columns === 1 ? 'grid-cols-1' : columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-ink-700">{legend}</legend>
      <div className={cn('grid gap-2', gridClass)}>
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                'touch-target flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm',
                selected
                  ? 'border-brand-600 bg-brand-50 text-brand-800'
                  : 'border-line bg-surface text-ink-700 hover:bg-canvas',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="mt-0.5 h-4 w-4 shrink-0 text-brand-600"
              />
              <span>
                <span className="block font-medium">{option.label}</span>
                {option.description && (
                  <span className="block text-xs text-ink-500">{option.description}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p className="text-xs font-medium text-danger-600" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
