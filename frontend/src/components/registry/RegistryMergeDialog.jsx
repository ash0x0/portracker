import React, { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { getRegistryServices, mergeRegistryServices } from "../../lib/api/serviceRegistry";
import { parseRegistryPortPrefix } from "../../lib/registry-utils.mjs";

const FIELD_CLASS = "rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-3 py-2 text-sm";

/** Used by History and Pinned. The target keeps its ID; candidates can be unpinned. */
export function RegistryMergeDialog({ target, onMerged, onClose }) {
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState([]);
  const [sourceId, setSourceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      const term = query.trim();
      const portSearch = /^\d+$/.test(term) ? parseRegistryPortPrefix(term) : null;
      getRegistryServices({
        serverId: target.serverId, source: target.source, limit: 100,
        ...(portSearch ? { portPrefix: portSearch } : { search: term }),
      }, controller.signal).then(result => {
        if (!controller.signal.aborted) {
          setChoices(result.items.filter(item => item.id !== target.id));
          setLoading(false);
        }
      }).catch(failure => {
        if (!controller.signal.aborted) {
          setError(failure.message || "Unable to find merge candidates");
          setLoading(false);
        }
      });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [target.id, target.source, target.serverId, query]);

  const handleMerge = async () => {
    if (!sourceId || busy) return;
    setBusy(true);
    setError("");
    try {
      const updated = await mergeRegistryServices(target.id, sourceId);
      onMerged(updated);
    } catch (failure) {
      setError(failure.message || "Unable to merge saved services");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge saved services</DialogTitle>
          <DialogDescription>
            Combine another {target.source || "same-source"} entry into
            <strong> {target.displayName}</strong>. The selected service keeps its ID.
            Ports, history and pins are retained. This cannot be undone.
            Conflicting saved names, icons, notes or commands must be resolved
            before merging. Cross-source merges are not supported.
          </DialogDescription>
        </DialogHeader>
        <label className="block space-y-1 text-sm">
          <span>Find another service by name or port</span>
          <input value={query} maxLength={100} disabled={busy}
            onChange={event => { setQuery(event.target.value); setChoices([]); setLoading(true); setSourceId(""); setError(""); }}
            placeholder="e.g. opencode or 49374" className={FIELD_CLASS + " w-full"}
            aria-label="Search for a service to merge" />
        </label>
        <div role="radiogroup" aria-label="Service to merge"
          className="max-h-64 space-y-2 overflow-y-auto">
          {loading && <p role="status" className="text-sm text-slate-500">Finding services…</p>}
          {!loading && choices.length === 0 && (
            <p className="text-sm text-slate-500">No matching services from the same source.</p>
          )}
          {!loading && choices.map(candidate => (
            <label key={candidate.id}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-300 dark:border-slate-700 p-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
              <input type="radio" name="merge-source" value={candidate.id}
                disabled={busy} checked={sourceId === candidate.id}
                onChange={() => setSourceId(candidate.id)} />
              <span className="min-w-0">
                <span className="block font-medium">{candidate.displayName}</span>
                <span className="block text-slate-600 dark:text-slate-300">
                  {candidate.previewHostIp}:{candidate.previewPort} · {candidate.status}
                  {candidate.pinned ? " · pinned" : ""}
                </span>
              </span>
            </label>
          ))}
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <DialogFooter>
          <button type="button" disabled={busy} onClick={onClose}
            className={FIELD_CLASS}>Cancel</button>
          <button type="button" disabled={!sourceId || busy || loading}
            onClick={handleMerge}
            className="rounded-lg bg-indigo-700 px-3 py-2 text-sm text-white disabled:opacity-50">
            {busy ? "Merging…" : "Confirm merge"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
