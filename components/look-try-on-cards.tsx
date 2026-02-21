"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface LookDetailsSummary {
  styles: string[];
  formality: string | null;
  suitablePlaces: string[];
  suitableOccasions: string[];
}

interface LookTryOnCardsProps {
  imageUrl: string;
  imageAlt: string;
  details: LookDetailsSummary;
  lookTitle: string;
  onLookTitleChange: (value: string) => void;
  onSave: () => void;
  saveDisabled: boolean;
  saveLabel: string;
  onSecondaryAction?: () => void;
  secondaryActionDisabled?: boolean;
  secondaryActionLabel?: string;
  secondaryActionClassName?: string;
  onOpenImage: (imageUrl: string, imageAlt: string) => void;
}

const LookDetailsCard = ({ details }: { details: LookDetailsSummary }) => (
  <div className="space-y-8 rounded-lg border bg-white p-4">
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Look details</p>
      {details.styles.length > 0 ? (
        <div className="space-y-3 pb-2">
          <p className="text-sm font-medium text-slate-700">Style</p>
          <div className="flex flex-wrap gap-1.5">
            {details.styles.map((style) => (
              <span
                key={`summary-style-${style}`}
                className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700"
              >
                {style}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {details.formality ? (
        <div className="space-y-3 pb-2">
          <p className="text-sm font-medium text-slate-700">Formality</p>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
              {details.formality}
            </span>
          </div>
        </div>
      ) : null}
      {details.suitablePlaces.length > 0 ? (
        <div className="space-y-3 pb-2">
          <p className="text-sm font-medium text-slate-700">Suitable places</p>
          <div className="flex flex-wrap gap-1.5">
            {details.suitablePlaces.map((place) => (
              <span
                key={`summary-place-${place}`}
                className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700"
              >
                {place}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {details.suitableOccasions.length > 0 ? (
        <div className="space-y-3 pb-2">
          <p className="text-sm font-medium text-slate-700">Suitable occasions</p>
          <div className="flex flex-wrap gap-1.5">
            {details.suitableOccasions.map((occasion) => (
              <span
                key={`summary-occasion-${occasion}`}
                className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700"
              >
                {occasion}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  </div>
);

export default function LookTryOnCards({
  imageUrl,
  imageAlt,
  details,
  lookTitle,
  onLookTitleChange,
  onSave,
  saveDisabled,
  saveLabel,
  onSecondaryAction,
  secondaryActionDisabled = false,
  secondaryActionLabel,
  secondaryActionClassName,
  onOpenImage,
}: LookTryOnCardsProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="rounded-lg border bg-white p-3">
        <div className="w-full overflow-auto rounded-md border bg-slate-100">
          <button
            type="button"
            className="block cursor-zoom-in"
            onClick={() => onOpenImage(imageUrl, imageAlt)}
            aria-label="Open try-on image in full size"
          >
            <img
              src={imageUrl}
              alt={imageAlt}
              width={1024}
              height={1536}
              className="h-auto w-full max-w-[320px]"
            />
          </button>
        </div>
      </div>

      <LookDetailsCard details={details} />

      <div className="space-y-4 rounded-lg border bg-white p-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Look title</p>
          <Input
            value={lookTitle}
            onChange={(event) => onLookTitleChange(event.target.value)}
            placeholder="Manual Look title"
          />
        </div>
        <Button type="button" className="w-full" onClick={onSave} disabled={saveDisabled}>
          {saveLabel}
        </Button>
        {onSecondaryAction && secondaryActionLabel ? (
          <Button
            type="button"
            variant="outline"
            className={secondaryActionClassName}
            onClick={onSecondaryAction}
            disabled={secondaryActionDisabled}
          >
            {secondaryActionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
