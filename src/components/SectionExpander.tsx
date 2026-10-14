import { Disclosure, DisclosureButton } from "@headlessui/react";
import { ChevronRightIcon } from "@heroicons/react/24/solid";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { ReactNode, useEffect, useRef } from "react";
import { EASE_OUT } from "@/lib/motion";

interface SectionExpanderProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  headerRight?: ReactNode;
  /** Called when the user expands or collapses the section. */
  onOpenChange?: (open: boolean) => void;
}

/** Reports open-state changes (not the initial state) to `onOpenChange`. */
function OpenStateReporter({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const previous = useRef(open);
  useEffect(() => {
    if (previous.current === open) return;
    previous.current = open;
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  return null;
}

export function SectionExpander({
  title,
  defaultOpen = true,
  children,
  headerRight,
  onOpenChange,
}: SectionExpanderProps) {
  return (
    <Disclosure defaultOpen={defaultOpen}>
      {({ open }) => (
        <div>
          <OpenStateReporter open={open} onOpenChange={onOpenChange} />
          <div className="flex items-center gap-2 py-2 select-none">
            <DisclosureButton className="flex items-center gap-2 text-sm font-semibold text-ps-text hover:text-ps-text transition-colors cursor-pointer">
              <ChevronRightIcon
                className={clsx(
                  "h-4 w-4 transition-transform duration-200",
                  open && "rotate-90",
                )}
              />
              <span>{title}</span>
            </DisclosureButton>
            {headerRight && (
              <div className="ml-auto flex items-center">{headerRight}</div>
            )}
          </div>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                key="content"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: EASE_OUT }}
                className="overflow-hidden"
              >
                {children}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </Disclosure>
  );
}
