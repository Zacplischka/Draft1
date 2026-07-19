import { useState } from 'react';
import { LiveStatus } from './Announce';

/** Clipboard copy with textual "✓ Copied" feedback (issue #29). */
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
        {copied ? '✓ Copied' : label}
      </button>
      <LiveStatus message={copied ? 'Copied to clipboard.' : null} />
    </>
  );
}
