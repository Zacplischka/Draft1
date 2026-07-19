import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Shared modal on native <dialog> (issue #27): showModal() provides the focus
 * trap, Escape-to-close, scroll lock, and top-layer; closing returns focus to
 * the trigger. The dialog itself is transparent — children render the visible
 * panel — so a pointerdown that lands on the dialog element is a backdrop
 * click and dismisses. `className` positions/sizes the dialog.
 */
export function Modal({
  onClose,
  className,
  children,
}: {
  onClose: () => void;
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    // React's autoFocus fires before showModal and would break focus return.
    d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) ref.current!.close();
      }}
      className={`bg-transparent backdrop:bg-slate-900/40 ${className}`}
    >
      {children}
    </dialog>
  );
}
