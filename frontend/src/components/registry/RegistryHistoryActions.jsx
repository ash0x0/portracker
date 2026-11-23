import React from "react";
import { GitMerge, Trash2, X } from "lucide-react";
import { RegistryPinButton } from "./RegistryPinButton";
import { StatusBadge } from "./RegistryServiceDetails";
import { OpenPortLink } from "@/components/ui/OpenPortLink";

const FIELD_CLASS = "rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-3 py-2 text-sm";

export function RegistryHistoryActions({
  service, expanded, pinBusy, forgetting, onPinToggle, onForget, onMerge, onClose,
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      <StatusBadge status={service.status} />
      <OpenPortLink port={service.previewPort} protocol={service.previewProtocol || "tcp"}
        httpRootUrl={service.httpRootUrl} offline={service.status !== "listening"} showPort />
      <RegistryPinButton service={service} onToggle={onPinToggle} busy={pinBusy}
        compact labelClassName={expanded ? "hidden sm:inline" : "hidden"}
        ariaLabel={(service.pinned ? "Unpin " : "Pin ") + service.displayName} />
      <button type="button" disabled={forgetting}
        aria-label={"Forget " + service.displayName} onClick={onForget}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-300 px-2.5 py-2 text-sm text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500">
        <Trash2 className="w-4 h-4" aria-hidden="true" />
        <span className={expanded ? "hidden sm:inline" : "hidden"}>Forget</span>
      </button>
      {expanded && (
        <>
          <button type="button" disabled={forgetting}
            aria-label={"Merge another service into " + service.displayName} onClick={onMerge}
            className={FIELD_CLASS + " inline-flex shrink-0 items-center gap-1.5 px-2.5 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"}>
            <GitMerge className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Merge with…</span>
          </button>
          <button type="button" aria-label="Close saved service details" onClick={onClose}
            className={FIELD_CLASS + " inline-flex shrink-0 items-center px-2.5 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"}>
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
}
