import React from "react";
import { Pin } from "lucide-react";

const BASE_CLASS =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border " +
  "text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 " +
  "disabled:cursor-wait disabled:opacity-50";

const PIN_CLASS =
  "border-indigo-600 bg-indigo-600 text-white shadow-sm hover:border-indigo-700 hover:bg-indigo-700 " +
  "dark:border-indigo-500 dark:bg-indigo-600 dark:hover:border-indigo-400 dark:hover:bg-indigo-700";

const UNPIN_CLASS =
  "border-amber-400 bg-amber-50 text-amber-900 hover:border-amber-500 hover:bg-amber-100 " +
  "dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/50";

/** A consistent, clearly actionable Pin/Unpin control in History and Pinned details. */
export function RegistryPinButton({
  service, onToggle, busy = false, ariaLabel, compact = false, labelClassName = "",
}) {
  const pinned = Boolean(service.pinned);
  return (
    <button type="button" onClick={() => onToggle(service)} disabled={busy}
      aria-label={ariaLabel || (pinned ? "Unpin service" : "Pin service")}
      aria-pressed={pinned} aria-busy={busy}
      data-registry-pin-state={pinned ? "pinned" : "unpinned"}
      title={pinned
        ? "Remove from Pinned without deleting service history"
        : "Keep this service in Pinned, even when offline"}
      className={BASE_CLASS + " " + (compact ? "px-2.5 py-2" : "px-3 py-2") + " " +
        (pinned ? UNPIN_CLASS : PIN_CLASS)}>
      <Pin className="h-4 w-4" fill={pinned ? "currentColor" : "none"} aria-hidden="true" />
      <span className={labelClassName}>{pinned ? "Unpin" : "Pin"}</span>
    </button>
  );
}
