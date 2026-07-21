import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';

interface DropdownMenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Wraps trigger AND content — outside-click/Escape logic anchors here. */
  rootRef: React.RefObject<HTMLDivElement | null>;
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | undefined>(undefined);

const useDropdownMenuContext = () => {
  const context = useContext(DropdownMenuContext);
  if (!context) {
    throw new Error('Dropdown menu components must be used within a DropdownMenu component');
  }
  return context;
};

interface DropdownMenuProps {
  children: React.ReactNode;
  /**
   * Extra classes for the positioning wrapper. Needed e.g. for full-width
   * triggers: a `w-full` child cannot widen the default shrink-to-fit
   * `inline-block` wrapper, so pass `w-full` here as well.
   */
  className?: string;
}

const DropdownMenu: React.FC<DropdownMenuProps> = ({ children, className }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen, rootRef }}>
      <div ref={rootRef} className={cn('relative inline-block text-left', className)}>
        {children}
      </div>
    </DropdownMenuContext.Provider>
  );
};

DropdownMenu.displayName = 'DropdownMenu';

interface DropdownMenuTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  children: React.ReactNode;
}

const DropdownMenuTrigger = React.forwardRef<HTMLButtonElement, DropdownMenuTriggerProps>(
  ({ className, children, asChild, ...props }, ref) => {
    const { open, setOpen } = useDropdownMenuContext();

    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children as React.ReactElement<React.HTMLAttributes<HTMLElement>>, {
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          setOpen(!open);
          const childProps = (children as React.ReactElement<React.HTMLAttributes<HTMLElement>>).props;
          if (childProps.onClick) {
            childProps.onClick(e as React.MouseEvent<HTMLElement>);
          }
        },
      });
    }

    return (
      <button
        ref={ref}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn('inline-flex items-center justify-center', className)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        {...props}
      >
        {children}
      </button>
    );
  }
);

DropdownMenuTrigger.displayName = 'DropdownMenuTrigger';

interface DropdownMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  children: React.ReactNode;
}

const DropdownMenuContent = React.forwardRef<HTMLDivElement, DropdownMenuContentProps>(
  ({ className, align = 'end', sideOffset = 4, children, ...props }, ref) => {
    const { open, setOpen, rootRef } = useDropdownMenuContext();
    const contentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      // Anchor on the root (trigger + content): a mousedown on the trigger
      // must NOT count as "outside", or its click-toggle re-opens the menu
      // right after this closes it.
      const handleClickOutside = (event: MouseEvent) => {
        const root = rootRef.current ?? contentRef.current;
        if (root && !root.contains(event.target as Node)) {
          setOpen(false);
        }
      };

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          setOpen(false);
          // Return focus to the trigger so keyboard users aren't dropped.
          rootRef.current?.querySelector<HTMLElement>('button, [role="button"]')?.focus();
        }
      };

      if (open) {
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
          document.removeEventListener('mousedown', handleClickOutside);
          document.removeEventListener('keydown', handleKeyDown);
        };
      }
    }, [open, setOpen, rootRef]);

    if (!open) return null;

    const alignmentClasses = {
      start: 'left-0',
      center: 'left-1/2 -translate-x-1/2',
      end: 'right-0',
    };

    return (
      <div
        ref={contentRef}
        role="menu"
        className={cn(
          'absolute z-50 min-w-[8rem] overflow-hidden rounded-xl border border-slate-200/60 bg-white p-1.5 text-slate-700 shadow-lg',
          'animate-in fade-in-0 zoom-in-95 duration-150',
          alignmentClasses[align],
          className
        )}
        style={{ top: `calc(100% + ${sideOffset}px)` }}
        {...props}
      >
        {children}
      </div>
    );
  }
);

DropdownMenuContent.displayName = 'DropdownMenuContent';

interface DropdownMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  inset?: boolean;
  destructive?: boolean;
}

const DropdownMenuItem = React.forwardRef<HTMLButtonElement, DropdownMenuItemProps>(
  ({ className, children, inset, destructive, onClick, ...props }, ref) => {
    const { setOpen } = useDropdownMenuContext();

    return (
      <button
        ref={ref}
        type="button"
        role="menuitem"
        className={cn(
          'relative flex w-full cursor-pointer select-none items-center rounded-lg px-3 py-2 text-sm outline-none transition-colors duration-150',
          'hover:bg-slate-50 focus:bg-slate-50',
          'disabled:pointer-events-none disabled:opacity-50',
          destructive && 'text-red-600 hover:bg-red-50 focus:bg-red-50',
          inset && 'pl-8',
          className
        )}
        onClick={(e) => {
          onClick?.(e);
          setOpen(false);
        }}
        {...props}
      >
        {children}
      </button>
    );
  }
);

DropdownMenuItem.displayName = 'DropdownMenuItem';

interface DropdownMenuLabelProps extends React.HTMLAttributes<HTMLDivElement> {
  inset?: boolean;
  children: React.ReactNode;
}

const DropdownMenuLabel = React.forwardRef<HTMLDivElement, DropdownMenuLabelProps>(
  ({ className, inset, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider', inset && 'pl-8', className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

DropdownMenuLabel.displayName = 'DropdownMenuLabel';

const DropdownMenuSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('-mx-1.5 my-1.5 h-px bg-slate-100', className)}
    {...props}
  />
));

DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

interface DropdownMenuGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

const DropdownMenuGroup = React.forwardRef<HTMLDivElement, DropdownMenuGroupProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div ref={ref} className={cn('', className)} {...props}>
        {children}
      </div>
    );
  }
);

DropdownMenuGroup.displayName = 'DropdownMenuGroup';

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
};
export default DropdownMenu;
