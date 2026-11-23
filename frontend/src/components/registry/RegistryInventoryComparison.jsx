import React from "react";
import { compareLocalInventory, endpointLabel } from "../../lib/registry-inventory.mjs";
import { registryTimestamp } from "../../lib/registry-utils.mjs";

export function RegistryInventoryComparison({ live, targets, scan, error }) {
  const result = compareLocalInventory({ live, targets, scan });
  const ready = result.state === "complete" || result.state === "partial";
  const excluded = result.coverage?.filter(item => !item.eligible) || [];
  return (
    <section aria-label="Local TCP inventory comparison"
      className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300">
      <h2 className="font-semibold text-slate-900 dark:text-slate-100">
        Live Ports versus History — local TCP
      </h2>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        Compares the last successful local Live Ports snapshot with current saved
        listening endpoints, not service cards. UDP, Docker internal ports, and
        remote servers are excluded. Docker and system observations remain separate.
      </p>
      {!ready ? (
        <p role="status">
          Comparison unavailable: {error || result.reason}.
          Use Live Ports to refresh its local snapshot, then Scan now in History.
        </p>
      ) : (
        <>
          <p role="status">
            {result.matched} matching endpoints · {result.liveOnly.length} only in Live Ports ·
            {" "}{result.savedOnly.length} only in History.
            {result.state === "partial" && " Partial comparison only."}
          </p>
          <p className="text-xs text-slate-500">
            Live sample: {registryTimestamp(result.liveAt)}. Independent collectors
            may scan at different times or normalize bind addresses differently.
          </p>
          <div className="flex flex-wrap gap-3 text-xs">
            {result.counts.map(row => (
              <span key={row.source} className="capitalize">
                {row.source}: Live {row.live} / History {row.saved}
              </span>
            ))}
          </div>
          {(result.liveOnly.length > 0 || result.savedOnly.length > 0) && (
            <details className="text-xs">
              <summary className="cursor-pointer font-medium">Inspect endpoint differences</summary>
              {[
                { label: "Only in Live Ports", rows: result.liveOnly },
                { label: "Only in History", rows: result.savedOnly },
              ].filter(group => group.rows.length > 0).map(group => (
                <div key={group.label} className="mt-2 space-y-1">
                  <strong>{group.label} ({group.rows.length})</strong>
                  <ul className="list-disc pl-5">
                    {group.rows.slice(0, 5).map(row => (
                      <li key={row.key} className="break-all">{endpointLabel(row)}</li>
                    ))}
                  </ul>
                  {group.rows.length > 5 && <p>Showing the first five endpoints.</p>}
                </div>
              ))}
            </details>
          )}
        </>
      )}
      {excluded.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Not compared: {excluded.map(item => item.source + " (" + item.reason + ")").join(", ")}.
          Incomplete or stale scans cannot establish that a service is offline.
        </p>
      )}
    </section>
  );
}
