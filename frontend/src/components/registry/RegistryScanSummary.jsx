import React from "react";
import { registryTimestamp } from "../../lib/registry-utils.mjs";

export function RegistryScanSummary({ scan }) {
  if (!scan) return null;
  const interval = Number(scan.intervalMs) || 30000;
  const overdueAfter = Math.max(interval * 3, 90000);
  return (
    <div className="text-sm text-slate-600 dark:text-slate-400 space-y-1"
      aria-label="Background discovery status">
      {!scan.enabled && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
          Automatic discovery is disabled. Set <code>SERVICE_REGISTRY_ENABLED=true</code> on the backend
          and restart Portracker to start recording listeners. Existing history is still available.
        </p>
      )}
      {scan.enabled && (
        <p className="text-xs">History scans run independently of Live Ports, approximately every
          {" "}{Math.round(interval / 1000)} seconds; an unavailable source backs off.</p>
      )}
      {scan.enabled && scan.sources.length === 0 && <p>Discovery enabled; waiting for the first scan.</p>}
      {(scan.sources || []).map(item => {
        const overdue = scan.enabled && item.lastAttemptAt &&
          Date.now() - item.lastAttemptAt > overdueAfter;
        return (
          <p key={item.source}>
            <strong className="capitalize">{item.source}</strong>: {item.outcome}
            {item.errorCode === "awaiting_first_scan" && " (awaiting scan after restart)"}
            {item.lastAttemptAt
              ? " · Last attempt " + registryTimestamp(item.lastAttemptAt)
              : " · No attempt yet"}
            {item.lastSuccessAt
              ? " · Last complete scan " + registryTimestamp(item.lastSuccessAt)
              : " · No complete scan yet"}
            {overdue && " · Scan overdue or source in backoff"}
          </p>
        );
      })}
    </div>
  );
}
