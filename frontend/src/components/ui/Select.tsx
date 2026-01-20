import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SelectContextValue {
  value: string;
  onValueChange: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  searchable?: boolean;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  items: Array<{ value: string; label: string }>;
  registerItem: (value: string, label: string) => void;
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
}

const SelectContext = createContext<SelectContextValue | undefined>(undefined);

const useSelectContext = () => {
  const context = useContext(SelectContext);
  if (!context) {
    throw new Error('Select components must be used within a Select component');
  }
  return context;
};

interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  defaultValue?: string;
  children: React.ReactNode;
  searchable?: boolean;
  isLoading?: boolean;
}

const Select: React.FC<SelectProps> = ({
  value,
  onValueChange,
  defaultValue,
  children,
  searchable = false,
  isLoading = false,
}) => {
  const [internalValue, setInternalValue] = useState(defaultValue || '');
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [items, setItems] = useState<Array<{ value: string; label: string }>>([]);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const currentValue = value !== undefined ? value : internalValue;
  const handleValueChange = (newValue: string) => {
    if (value === undefined) {
      setInternalValue(newValue);
    }
    onValueChange?.(newValue);
    setSearchQuery('');
  };

  const registerItem = useCallback((value: string, label: string) => {
    setItems((prev) => {
      if (prev.find((item) => item.value === value)) return prev;
      return [...prev, { value, label }];
    });
  }, []);

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setFocusedIndex(-1);
    }
  }, [open]);

  return (
    <SelectContext.Provider
      value={{
        value: currentValue,
        onValueChange: handleValueChange,
        open,
        setOpen,
        searchable,
        searchQuery,
        setSearchQuery,
        items,
        registerItem,
        focusedIndex,
        setFocusedIndex,
      }}
    >
      <div className="relative">{children}</div>
    </SelectContext.Provider>
  );
};

Select.displayName = 'Select';

interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, ...props }, ref) => {
    const { open, setOpen } = useSelectContext();
    const triggerRef = useRef<HTMLButtonElement>(null);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(!open);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!open) {
          setOpen(true);
        }
      }
    };

    return (
      <button
        ref={(node) => {
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
          triggerRef.current = node;
        }}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground',
          'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
          'transition-all duration-150',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        onClick={() => setOpen(!open)}
        onKeyDown={handleKeyDown}
        {...props}
      >
        {children}
        <svg
          className={cn('h-4 w-4 opacity-50 transition-transform duration-150', open && 'rotate-180')}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    );
  }
);

SelectTrigger.displayName = 'SelectTrigger';

interface SelectValueProps {
  placeholder?: string;
}

const SelectValue: React.FC<SelectValueProps> = ({ placeholder }) => {
  const { value } = useSelectContext();

  if (!value && placeholder) {
    return <span className="text-muted-foreground">{placeholder}</span>;
  }

  return <span>{value}</span>;
};

SelectValue.displayName = 'SelectValue';

interface SelectContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

const SelectContent = React.forwardRef<HTMLDivElement, SelectContentProps>(
  ({ className, children, ...props }, ref) => {
    const {
      open,
      setOpen,
      searchable,
      searchQuery,
      setSearchQuery,
      items,
      focusedIndex,
      setFocusedIndex,
      onValueChange,
    } = useSelectContext();
    const contentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (contentRef.current && !contentRef.current.contains(event.target as Node)) {
          const trigger = contentRef.current.previousElementSibling;
          if (trigger && !trigger.contains(event.target as Node)) {
            setOpen(false);
          }
        }
      };

      if (open) {
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
      }
    }, [open, setOpen]);

    useEffect(() => {
      if (open && focusedIndex >= 0 && contentRef.current) {
        const focusedElement = contentRef.current.querySelector(
          `[data-item-index="${focusedIndex}"]`
        ) as HTMLElement;
        focusedElement?.scrollIntoView({ block: 'nearest' });
      }
    }, [open, focusedIndex]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
      const filteredItems = searchable
        ? items.filter((item) =>
            item.label.toLowerCase().includes(searchQuery.toLowerCase())
          )
        : items;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && focusedIndex >= 0 && filteredItems.length > 0) {
        e.preventDefault();
        const item = filteredItems[focusedIndex];
        if (item) {
          onValueChange(item.value);
          setOpen(false);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      } else if (searchable && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        setSearchQuery((prev) => prev + e.key);
        setFocusedIndex(0);
      }
    };

    if (!open) return null;

    const filteredItems = searchable
      ? items.filter((item) => item.label.toLowerCase().includes(searchQuery.toLowerCase()))
      : items;

    return (
      <div
        ref={(node) => {
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
          contentRef.current = node;
        }}
        role="listbox"
        className={cn(
          'absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-card py-1 shadow-lg',
          'animate-in fade-in-0 zoom-in-95',
          className
        )}
        onKeyDown={handleKeyDown}
        {...props}
      >
        {searchable && (
          <div className="sticky top-0 z-10 bg-card border-b border-border px-2 py-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setFocusedIndex(0);
                }}
                className="w-full pl-8 pr-2 py-1.5 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-background"
                placeholder="Search..."
                autoFocus
              />
            </div>
          </div>
        )}
        {filteredItems.length === 0 && searchable && searchQuery && (
          <div className="px-2 py-4 text-sm text-muted-foreground text-center">No results found</div>
        )}
        {children}
      </div>
    );
  }
);

SelectContent.displayName = 'SelectContent';

interface SelectItemProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  children: React.ReactNode;
}

const SelectItem = React.forwardRef<HTMLDivElement, SelectItemProps>(
  ({ className, value, children, ...props }, ref) => {
    const {
      value: selectedValue,
      onValueChange,
      setOpen,
      searchable,
      searchQuery,
      items,
      registerItem,
      focusedIndex,
      setFocusedIndex,
    } = useSelectContext();
    const itemRef = useRef<HTMLDivElement>(null);
    const isSelected = selectedValue === value;
    const itemIndex = items.findIndex((item) => item.value === value);
    const isFocused = itemIndex === focusedIndex;

    useEffect(() => {
      if (typeof children === 'string') {
        registerItem(value, children);
      } else if (React.isValidElement(children) && typeof children.props.children === 'string') {
        registerItem(value, children.props.children);
      }
    }, [value, children, registerItem]);

    const handleClick = () => {
      onValueChange(value);
      setOpen(false);
    };

    const handleMouseEnter = () => {
      setFocusedIndex(itemIndex);
    };

    return (
      <div
        ref={(node) => {
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
          itemRef.current = node;
        }}
        role="option"
        aria-selected={isSelected}
        data-item-index={itemIndex}
        className={cn(
          'relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors duration-150',
          'hover:bg-neutral-100',
          isFocused && 'bg-neutral-100',
          isSelected && 'bg-primary-50 text-primary-900 font-medium',
          className
        )}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        {...props}
      >
        {isSelected && (
          <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center text-primary-600">
            <svg
              className="h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </span>
        )}
        {children}
      </div>
    );
  }
);

SelectItem.displayName = 'SelectItem';

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
export default Select;

