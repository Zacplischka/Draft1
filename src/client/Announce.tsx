import type { ReactNode } from 'react';

/**
 * Screen-reader announcements (issue #28).
 *
 * ErrorText is the shared inline error message: role="alert" makes screen
 * readers announce it the moment it mounts, so render it conditionally when
 * the error appears. It's a <span> so it stays valid inside <label>.
 *
 * LiveStatus announces outcome states (ballot submitted, solution submitted,
 * voting resumed) without moving focus. Live regions only reliably announce
 * *changes* to an element that already exists, so keep it always mounted at a
 * stable position and swap `message` between null and text.
 */
export function ErrorText({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <span role="alert" className={`block text-sm text-red-600 ${className}`}>
      {children}
    </span>
  );
}

export function LiveStatus({ message }: { message: string | null }) {
  return (
    <span role="status" className="sr-only">
      {message}
    </span>
  );
}
