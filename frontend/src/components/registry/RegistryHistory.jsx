import { RegistryCapabilities } from "./RegistryCapabilities";
import { RegistryServiceDetails, StatusBadge } from "./RegistryServiceDetails";
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { History, Pin, RefreshCw, ScanSearch, Search } from "lucide-react";
import {
  getRegistryService,
  getRegistryServices,
  getRegistryScanStatus,
  scanRegistryNow,
  setRegistryServicePinned,
  forgetRegistryService,
} from "../../lib/api/serviceRegistry";
import {
  PAGE_SIZE, parseRegistryPortPrefix, registryPageCount, registryTimestamp,
} from "../../lib/registry-utils.mjs";

const FIELD_CLASS = "rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-3 py-2 text-sm";

function rememberScrollContainers(element) {
  const containers = [];
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const mode = window.getComputedStyle(node).overflowY;
    if (node.scrollHeight > node.clientHeight && (mode === "auto" || mode === "scroll")) {
      containers.push({ node, top: node.scrollTop });
    }
  }
  return containers;
}

function ScanSummary({ scan }) {
  if (!scan) return null;
  return (
    <div className="text-sm text-slate-600 dark:text-slate-400 space-y-1" aria-label="Background discovery status">
      {!scan.enabled && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
          Automatic discovery is disabled. Set <code>SERVICE_REGISTRY_ENABLED=true</code> on the backend
          and restart Portracker to start recording listeners. Existing history is still available.
        </p>
      )}
      {scan.enabled && scan.sources.length === 0 && <p>Discovery enabled; waiting for the first scan.</p>}
      {scan.sources.map(item => (
        <p key={item.source}>
          <strong className="capitalize">{item.source}</strong>: {item.outcome}
          {item.lastSuccessAt
            ? " · Last complete scan " + registryTimestamp(item.lastSuccessAt)
            : " · No complete scan yet"}
        </p>
      ))}
    </div>
  );
}

export function RegistryHistory({ pinnedOnly = false, onBrowseHistory = null }) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [portText, setPortText] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [lastSeenWindow, setLastSeenWindow] = useState("");
  const [page, setPage] = useState(0);
  const [version, setVersion] = useState(0);
  const [data, setData] = useState({ items: [], total: 0 });
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const hasLoadedListRef = useRef(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [forgetting, setForgetting] = useState(false);
  const [forgetDialogOpen, setForgetDialogOpen] = useState(false);
  const historyRef = useRef(null);
  const savedScrollRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [scanError, setScanError] = useState("");
  const [pinBusyId, setPinBusyId] = useState(null);
  const [pinError, setPinError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => { setPage(0); setSearch(query.trim()); }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const timer = setInterval(() => setVersion(value => value + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const parsedPort = parseRegistryPortPrefix(portText);
  const invalidPort = Boolean(portText.trim()) && parsedPort === null;

  useEffect(() => {
    if (invalidPort) return;
    const controller = new AbortController();
    if (!hasLoadedListRef.current) setLoading(true);
    setError("");
    getRegistryServices({
      limit: PAGE_SIZE, offset: page * PAGE_SIZE, serverId: "local",
      status, source, search, portPrefix: parsedPort,
      pinnedOnly: pinnedOnly ? true : null,
      seenSince: lastSeenWindow ? Date.now() - Number(lastSeenWindow) * 86400000 : null,
    }, controller.signal).then(list => {
      if (controller.signal.aborted) return;
      hasLoadedListRef.current = true;
      setData(list);
      setLoading(false);
    }).catch(err => {
      if (controller.signal.aborted) return;
      setError(err.message || "Unable to load service history");
      setLoading(false);
    });
    return () => controller.abort();
  }, [page, status, source, search, parsedPort, invalidPort, lastSeenWindow, version, pinnedOnly]);

  useEffect(() => {
    const controller = new AbortController();
    getRegistryScanStatus(controller.signal).then(result => {
      if (!controller.signal.aborted) setScan(result);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [version]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); setDetailError(""); return; }
    const controller = new AbortController();
    setDetail(previous => previous?.id === selectedId ? previous : null);
    setDetailError("");
    getRegistryService(selectedId, controller.signal).then(result => {
      if (!controller.signal.aborted) setDetail(result);
    }).catch(err => {
      if (!controller.signal.aborted) setDetailError(err.message);
    });
    return () => controller.abort();
  }, [selectedId, version]);

  const refresh = useCallback(() => setVersion(value => value + 1), []);
  const handleScanNow = useCallback(async () => {
    if (scanning || !scan?.enabled) return;
    setScanning(true);
    setScanMessage("");
    setScanError("");
    try {
      const result = await scanRegistryNow();
      setScanMessage("Scan finished: " + (result.results || []).map(item =>
        item.source + " " + item.outcome
      ).join(" · "));
      refresh();
    } catch (error) {
      setScanError(error.message || "Unable to start manual scan");
      refresh();
    } finally {
      setScanning(false);
    }
  }, [scanning, scan?.enabled, refresh]);
  const handlePinToggle = useCallback(async (service) => {
    if (!service || pinBusyId) return;
    setPinBusyId(service.id);
    setPinError("");
    try {
      const result = await setRegistryServicePinned(service.id, !service.pinned);
      setData(previous => ({
        ...previous,
        items: (pinnedOnly && !result.pinned
          ? previous.items.filter(item => item.id !== service.id)
          : previous.items.map(item => item.id === service.id
            ? { ...item, pinned: result.pinned, pinnedAt: result.pinnedAt } : item)),
        total: pinnedOnly && !result.pinned ? Math.max(0, previous.total - 1) : previous.total,
      }));
      setDetail(previous => previous?.id === service.id
        ? { ...previous, pinned: result.pinned, pinnedAt: result.pinnedAt } : previous);
      if (pinnedOnly && !result.pinned && selectedId === service.id) setSelectedId(null);
      refresh();
    } catch (error) {
      setPinError(error.message || "Unable to update the service pin");
    } finally {
      setPinBusyId(null);
    }
  }, [pinBusyId, pinnedOnly, selectedId, refresh]);

  const handleForget = useCallback(async () => {
    if (!selectedId || forgetting) return;
    setForgetting(true);
    setDetailError("");
    savedScrollRef.current = rememberScrollContainers(historyRef.current);
    try {
      await forgetRegistryService(selectedId);
      setData(previous => ({
        ...previous,
        items: previous.items.filter(item => item.id !== selectedId),
        total: Math.max(0, previous.total - 1),
      }));
      setSelectedId(null);
      setDetail(null);
      setForgetDialogOpen(false);
      if (data.items.length <= 1 && page > 0) {
        setPage(previous => Math.max(0, previous - 1));
      } else {
        refresh();
      }
    } catch (err) {
      savedScrollRef.current = null;
      setDetailError(err.message || "Unable to forget saved service");
    } finally {
      setForgetting(false);
    }
  }, [selectedId, forgetting, data.items.length, page, refresh]);

  useLayoutEffect(() => {
    if (!savedScrollRef.current) return;
    for (const { node, top } of savedScrollRef.current) {
      if (node.isConnected) node.scrollTop = top;
    }
    savedScrollRef.current = null;
  }, [data, page, selectedId]);

  const pages = registryPageCount(data.total);

  return (
    <section ref={historyRef} aria-label="Saved service history" className="space-y-5">
      <div className="flex flex-wrap gap-3 items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2 text-slate-900 dark:text-white">
            {pinnedOnly ? <Pin className="w-6 h-6" /> : <History className="w-6 h-6" />}
            {pinnedOnly ? "Pinned services" : "Service history"}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            {pinnedOnly
              ? "Your important services, available even when offline. Offline services are shown first."
              : "Remembered TCP listeners on this Portracker host, including services that are no longer running."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" onClick={refresh} title="Reload saved history; does not scan"
            className={FIELD_CLASS + " inline-flex items-center gap-2"}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Refresh
          </button>
          <button type="button" onClick={handleScanNow} disabled={scanning || !scan?.enabled}
            title="Collect current listening services now"
            className={FIELD_CLASS + " inline-flex items-center gap-2 disabled:opacity-50"}>
            <ScanSearch className="w-4 h-4" aria-hidden="true" />
            {scanning ? "Scanning…" : "Scan now"}
          </button>
        </div>
      </div>

      <ScanSummary scan={scan} />
      <RegistryCapabilities scan={scan} />
      {scanMessage && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{scanMessage}</p>}
      {scanError && <p role="alert" className="text-sm text-red-600">{scanError}</p>}
      {pinError && <p role="alert" className="text-sm text-red-600">{pinError}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3" aria-label="History filters">
        <label className="text-sm space-y-1">
          <span className="text-slate-600 dark:text-slate-300">Name</span>
          <span className="relative block">
            <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" aria-hidden="true" />
            <input aria-label="Search saved service names" value={query} maxLength={100}
              placeholder="Search saved services" onChange={e => setQuery(e.target.value)}
              className={FIELD_CLASS + " pl-9 w-full"} />
          </span>
        </label>
        <label className="text-sm space-y-1">
          <span className="text-slate-600 dark:text-slate-300">Port (starts with)</span>
          <input aria-label="Filter by port" inputMode="numeric" maxLength={5} value={portText}
            placeholder="e.g. 41" onChange={e => { setPortText(e.target.value); setPage(0); }}
            className={FIELD_CLASS + " w-full"} />
        </label>
        <label className="text-sm space-y-1">
          <span className="text-slate-600 dark:text-slate-300">Status</span>
          <select aria-label="Filter by status" value={status}
            onChange={e => { setStatus(e.target.value); setPage(0); }} className={FIELD_CLASS + " w-full"}>
            <option value="">All statuses</option>
            <option value="listening">Listening</option>
            <option value="offline">Offline</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label className="text-sm space-y-1">
          <span className="text-slate-600 dark:text-slate-300">Last seen</span>
          <select aria-label="Filter by last seen" value={lastSeenWindow}
            onChange={event => { setLastSeenWindow(event.target.value); setPage(0); }}
            className={FIELD_CLASS + " w-full"}>
            <option value="">Any time</option>
            <option value="1">Past 24 hours</option>
            <option value="7">Past 7 days</option>
            <option value="30">Past 30 days</option>
          </select>
        </label>
        <label className="text-sm space-y-1">
          <span className="text-slate-600 dark:text-slate-300">Source</span>
          <select aria-label="Filter by source" value={source}
            onChange={e => { setSource(e.target.value); setPage(0); }} className={FIELD_CLASS + " w-full"}>
            <option value="">All sources</option>
            <option value="system">Native system</option>
            <option value="docker">Docker</option>
          </select>
        </label>
      </div>

      {invalidPort && <p role="alert" className="text-sm text-red-600">Enter a numeric port prefix (1–5 digits, 1–65535).</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading && <p role="status" className="text-sm text-slate-500">Loading service history…</p>}

      {!loading && !error && !invalidPort && data.items.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center text-slate-600 dark:text-slate-400">
          {pinnedOnly
            ? "No pinned services match these filters. Pin a service from History or adjust your filters."
            : "No saved services match these filters. Services can only appear after they have been observed."}
          {pinnedOnly && onBrowseHistory && (
            <button type="button" onClick={onBrowseHistory}
              className="block mx-auto mt-4 rounded-lg bg-indigo-600 px-3 py-2 text-white text-sm">
              Browse History
            </button>
          )}
        </div>
      )}

      {!invalidPort && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {data.items.map(service => (
            <article key={service.id}
              className={"min-w-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 " +
                (selectedId === service.id ? "col-span-full" : "")}>
              <div className="flex items-start gap-3">
                <button type="button" onClick={() => {
                  setForgetDialogOpen(false);
                  setSelectedId(service.id);
                }}
                  aria-pressed={selectedId === service.id}
                  className="min-w-0 flex-1 text-left space-y-2 hover:text-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  {service.iconHash && (
                    <img alt="" loading="lazy" width="24" height="24"
                      className="w-6 h-6 flex-none object-contain"
                      src={"/api/service-registry/icons/" + service.iconHash} />
                  )}
                  <div className="min-w-0">
                    <strong className="block truncate text-slate-900 dark:text-white">
                      {service.displayName}
                    </strong>
                    {service.httpTitle && (
                      <p className="text-sm truncate text-slate-600 dark:text-slate-300"
                        title={service.httpTitle}>{service.httpTitle}</p>
                    )}
                  </div>
                </div>
                <StatusBadge status={service.status} />
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {service.previewHostIp || "Unknown host"}:{service.previewPort ?? "?"}
                {" · "}{(service.sources || [service.source]).join(" + ")}{" · "}{service.endpointCount || 0} endpoint(s)
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Last seen {registryTimestamp(service.lastSeenAt)}
              </p>
              {service.identityConfidence === "uncertain" && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Identity uncertain: a port can be reused by a different app
                </p>
              )}

                </button>
                <button type="button" onClick={() => handlePinToggle(service)}
                  disabled={Boolean(pinBusyId)}
                  aria-label={(service.pinned ? "Unpin " : "Pin ") + service.displayName}
                  aria-pressed={service.pinned}
                  title={service.pinned ? "Unpin service" : "Pin service"}
                  className={"shrink-0 rounded-lg border p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-50 " +
                    (service.pinned
                      ? "border-indigo-300 text-indigo-600 dark:text-indigo-300"
                      : "border-slate-200 dark:border-slate-700 text-slate-500")}>
                  <Pin className="w-4 h-4" fill={service.pinned ? "currentColor" : "none"} aria-hidden="true" />
                </button>
              </div>
              {selectedId === service.id && (
                <div className="mt-4 min-w-0">
                  <RegistryServiceDetails
                    detail={detail?.id === service.id ? detail : null}
                    detailError={detailError}
                    onPinToggle={handlePinToggle}
                    onForget={() => setForgetDialogOpen(true)}
                    onClose={() => { setSelectedId(null); setForgetDialogOpen(false); }}
                    pinBusy={Boolean(pinBusyId)}
                    forgetting={forgetting}
                  />
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {!invalidPort && !loading && pages > 1 && (
        <nav aria-label="History pages" className="flex gap-3 items-center justify-center text-sm">
          <button type="button" className={FIELD_CLASS} disabled={page === 0}
            onClick={() => setPage(value => Math.max(0, value - 1))}>Previous</button>
          <span>Page {page + 1} of {pages} · {data.total} services</span>
          <button type="button" className={FIELD_CLASS} disabled={page >= pages - 1}
            onClick={() => setPage(value => value + 1)}>Next</button>
        </nav>
      )}

      <Dialog open={forgetDialogOpen} onOpenChange={open => {
        if (!forgetting) setForgetDialogOpen(open);
      }}>
        <DialogContent onCloseAutoFocus={event => { if (!selectedId) event.preventDefault(); }}>
          <DialogHeader>
            <DialogTitle>Forget saved service?</DialogTitle>
            <DialogDescription>
              Forget {detail?.displayName || "this service"} permanently? This deletes its saved
              history, pins, recovery notes and metadata. It does not stop the running service.
            </DialogDescription>
          </DialogHeader>
          {detailError && <p role="alert" className="text-sm text-red-600">{detailError}</p>}
          <DialogFooter>
            <button type="button" disabled={forgetting} onClick={() => setForgetDialogOpen(false)}
              className={FIELD_CLASS}>Cancel</button>
            <button type="button" disabled={forgetting} onClick={handleForget}
              className="rounded-lg bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-50">
              {forgetting ? "Forgetting…" : "Forget service"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
