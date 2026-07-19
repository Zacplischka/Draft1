import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { LiveStatus } from './Announce';

/** Clipboard copy with "Copied" feedback (issue #29); copy/check icons baked in (issue #31). */
export function CopyButton({
  text,
  label,
  className,
  ariaLabel,
}: {
  text: string;
  label: string;
  className: string;
  ariaLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <button
        onClick={() =>
          void navigator.clipboard
            .writeText(text)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
            .catch(() => {}) // clipboard permission denied — nothing to recover
        }
        aria-label={ariaLabel}
        className={className}
      >
        {copied ? (
          <>
            <Check className="inline h-4 w-4" aria-hidden /> Copied
          </>
        ) : (
          <>
            <Copy className="inline h-4 w-4" aria-hidden /> {label}
          </>
        )}
      </button>
      <LiveStatus message={copied ? 'Copied to clipboard.' : null} />
    </>
  );
}
