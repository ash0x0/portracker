import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Pin } from "lucide-react";
import { getRegistryLivePinTargets, setRegistryServicePinned } from "@/lib/api/serviceRegistry";
import { matchLivePinTarget } from "@/lib/live-registry-pins.mjs";
import { RegistryPinButton } from "./RegistryPinButton";

const LivePinsContext = createContext(null);

export function LiveRegistryPinProvider({ children }) {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = () => getRegistryLivePinTargets(controller.signal).then(data => {
      if (!controller.signal.aborted) setSnapshot(data);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure.message || "Unable to load service pins");
    });
    load();
    const timer = setInterval(load, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);

  const toggle = useCallback(async service => {
    if (busyId) return;
    setBusyId(service.id);
    setError("");
    try {
      const result = await setRegistryServicePinned(service.id, !service.pinned);
      setSnapshot(previous => previous && ({
        ...previous,
        items: previous.items.map(item => item.id === result.id
          ? { ...item, pinned: result.pinned } : item),
      }));
    } catch (failure) {
      setError(failure.message || "Unable to update pin");
    } finally {
      setBusyId(null);
    }
  }, [busyId]);

  return <LivePinsContext.Provider value={{ snapshot, error, busyId, toggle }}>
    {children}
  </LivePinsContext.Provider>;
}

export function LiveRegistryPinButton({ ports, serverId, compact = false }) {
  const state = useContext(LivePinsContext);
  if (serverId !== "local" || !state) return null;
  const { snapshot, error, busyId, toggle } = state;
  const { target, reason } = matchLivePinTarget(ports, snapshot?.items, snapshot?.truncated);
  if (!target) {
    const message = error || (snapshot ? reason : "Loading saved service identities");
    return <span className="inline-flex shrink-0" title={message}>
      <button type="button" disabled aria-label={"Pin unavailable: " + message}
        className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
        <Pin className="h-4 w-4" aria-hidden="true" /> Pin
      </button>
    </span>;
  }
  return <span className="inline-flex shrink-0" title={error || undefined}>
    <RegistryPinButton service={target} onToggle={toggle} busy={Boolean(busyId)}
      compact={compact} ariaLabel={(target.pinned ? "Unpin" : "Pin") + " live service"} />
  </span>;
}
