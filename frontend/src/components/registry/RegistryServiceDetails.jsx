import React from "react";
import { Pin, Trash2, X } from "lucide-react";
import { RegistryRecoveryDetails } from "./RegistryRecoveryDetails";
import { RegistryDockerProvenance } from "./RegistryDockerProvenance";
import { RegistryLinuxProvenance } from "./RegistryLinuxProvenance";
import { registryStatusLabel, registryTimestamp } from "../../lib/registry-utils.mjs";

const STATUS_CLASSES = {
  listening: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  offline: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
  unknown: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
};
const FIELD_CLASS = "rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-3 py-2 text-sm";

export function StatusBadge({ status }) {
  return (
    <span className={"rounded-full px-2.5 py-1 text-xs font-semibold " +
      (STATUS_CLASSES[status] || STATUS_CLASSES.unknown)}>
      {registryStatusLabel(status)}
    </span>
  );
}

export function RegistryServiceDetails({
  detail, detailError, onPinToggle, onClose, onForget, pinBusy, forgetting,
}) {
  return (
    <section aria-label="Saved service details"
      className="col-span-full min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-3">
      <div className="flex flex-wrap justify-between gap-3 items-center">
        <h2 className="font-semibold text-lg text-slate-900 dark:text-white">Saved service details</h2>
        <div className="flex flex-wrap items-center gap-2">
          {detail && (
            <>
              <button type="button" disabled={forgetting} onClick={onForget}
                aria-label={"Forget " + detail.displayName}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm border border-red-300 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50">
                <Trash2 className="w-4 h-4" aria-hidden="true" /> Forget
              </button>
              <button type="button" onClick={() => onPinToggle(detail)}
                disabled={pinBusy} aria-label={detail.pinned ? "Unpin selected service" : "Pin selected service"}
                aria-pressed={detail.pinned}
                className={FIELD_CLASS + " inline-flex gap-2 items-center disabled:opacity-50"}>
                <Pin className="w-4 h-4" fill={detail.pinned ? "currentColor" : "none"} />
                {detail.pinned ? "Unpin" : "Pin"}
              </button>
            </>
          )}
          <button type="button" aria-label="Close saved service details" onClick={onClose}
            className={FIELD_CLASS}><X className="w-4 h-4" /></button>
        </div>
      </div>
      {detailError && <p role="alert" className="text-red-600 text-sm">{detailError}</p>}
      {!detail && !detailError && <p role="status">Loading details…</p>}
      {detail && (
        <>
              <div className="flex flex-wrap gap-2 items-center">
                {detail.iconHash && (
                  <img alt="" loading="lazy" width="28" height="28"
                    className="w-7 h-7 object-contain"
                    src={"/api/service-registry/icons/" + detail.iconHash} />
                )}
                <strong>{detail.displayName}</strong>
                <StatusBadge status={detail.status} />
                <span className="text-xs text-slate-500">{detail.identityConfidence} identity</span>
              </div>
              {detail.httpTitle && (
                <p className="font-medium text-sm">{detail.httpTitle}</p>
              )}
              {detail.httpRootUrl && (
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  HTTP root seen at{" "}
                  <a className="underline hover:text-indigo-600" href={detail.httpRootUrl}
                    target="_blank" rel="noopener noreferrer">
                    {detail.httpRootUrl}
                  </a>
                  {" "}(may only be reachable from the Portracker host)
                </p>
              )}
              {detail.metadataFetchedAt && (
                <p className="text-xs text-slate-500">
                  Page metadata collected {registryTimestamp(detail.metadataFetchedAt)}
                </p>
              )}
              <p className="text-sm text-slate-600 dark:text-slate-400">
                First seen {registryTimestamp(detail.firstSeenAt)} · Last seen {registryTimestamp(detail.lastSeenAt)}
              </p>
              {detail.runCount > 1 && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Observed process runs: {detail.runCount} (logical service retained across restarts)
                </p>
              )}
              <RegistryLinuxProvenance evidence={detail.linuxProvenance} />
              <RegistryDockerProvenance evidence={detail.dockerProvenance} />
              {detail.recovery && (
                <RegistryRecoveryDetails key={detail.id}
                  serviceId={detail.id} recovery={detail.recovery} />
              )}
              <h3 className="font-medium text-sm">Remembered endpoints</h3>
              <ul className="list-disc pl-5 text-sm space-y-1 text-slate-600 dark:text-slate-300">
                {detail.endpoints.slice(0, 20).map(ep => (
                  <li key={ep.id}>{ep.hostIp}:{ep.hostPort}/{ep.protocol} · {ep.source}
                    {" · "}Last seen {registryTimestamp(ep.lastSeenAt)}</li>
                ))}
              </ul>
              {detail.endpoints.length > 20 && (
                <p className="text-sm text-slate-500">Showing the 20 most recently seen endpoints.</p>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Title/favicon are captured from the HTTP root when enabled. Linux provenance and copy-only recovery suggestions require authenticated opt-in; no commands are executed.
              </p>

        </>
      )}
    </section>
  );
}
