import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/states';
import { IconCamera, IconUpload } from '@/components/ui/icons';

/**
 * Mirrors the server's own upload gate (`config/constants.js`). Checking here
 * saves an 8MB upload that was always going to be rejected; the server still
 * checks the bytes themselves, which is the real control — the client's
 * declared MIME type and filename are never trusted there.
 */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ACCEPTED = 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif';

export type LocalRejection = 'TOO_LARGE' | 'NOT_AN_IMAGE';

export function UploadDropzone({
  file,
  onSelect,
  disabled = false,
}: {
  file: File | null;
  onSelect: (file: File | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation(['health', 'errors', 'common']);
  const inputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [rejection, setRejection] = useState<LocalRejection | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // An object URL is a document-scoped handle; without the revoke the page
  // leaks one per photo the farmer flips through.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const accept = useCallback(
    (candidate: File | undefined) => {
      if (!candidate) return;

      if (!candidate.type.startsWith('image/')) {
        setRejection('NOT_AN_IMAGE');
        onSelect(null);
        return;
      }
      if (candidate.size > MAX_UPLOAD_BYTES) {
        setRejection('TOO_LARGE');
        onSelect(null);
        return;
      }

      setRejection(null);
      onSelect(candidate);
    },
    [onSelect],
  );

  return (
    <div className="space-y-3">
      <div
        data-testid="upload-dropzone"
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (!disabled) accept(event.dataTransfer.files[0]);
        }}
        className={cn(
          'rounded-xl border-2 border-dashed px-5 py-8 text-center',
          isDragging ? 'border-brand-600 bg-brand-50' : 'border-line bg-surface',
          disabled && 'opacity-60',
        )}
      >
        {previewUrl ? (
          <div className="space-y-3">
            <img
              src={previewUrl}
              alt={t('health:photoAlt')}
              data-testid="upload-preview"
              className="mx-auto max-h-64 rounded-lg object-contain"
            />
            <Button
              variant="secondary"
              onClick={() => inputRef.current?.click()}
              disabled={disabled}
              data-testid="upload-replace"
            >
              {t('health:photoReplace')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <span className="inline-flex text-brand-500" aria-hidden="true">
              <IconUpload size={32} />
            </span>
            <p className="text-base font-semibold">{t('health:dropzoneTitle')}</p>
            <p className="text-xs text-ink-500">{t('health:dropzoneHint')}</p>
            <Button
              onClick={() => inputRef.current?.click()}
              disabled={disabled}
              leadingIcon={<IconCamera size={18} />}
              data-testid="upload-choose"
            >
              {t('health:dropzoneCta')}
            </Button>
          </div>
        )}

        {/*
          `capture="environment"` opens the rear camera directly on a phone,
          which is where every one of these photos is actually taken. Desktop
          browsers ignore it and show a file picker.
        */}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          capture="environment"
          className="sr-only"
          data-testid="upload-input"
          aria-label={t('health:dropzoneCta')}
          onChange={(event) => accept(event.target.files?.[0])}
        />
      </div>

      {rejection && (
        <Notice tone="danger" data-testid="upload-rejection">
          {rejection === 'TOO_LARGE'
            ? t('errors:uploadTooLarge')
            : t('errors:uploadNotAnImage')}
        </Notice>
      )}
    </div>
  );
}
