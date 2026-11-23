import { RegistryCapabilities } from "./RegistryCapabilities";
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pin, RefreshCw, ScanSearch, Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  forgetRegistryService, getRegistryPinnedGroups, getRegistryScanStatus,
  getRegistryService, scanRegistryNow, setRegistryServicePinned,
  saveRegistryServiceAppearance, saveRegistryComposeAppearance,
} from "../../lib/api/serviceRegistry";
import { PAGE_SIZE, parseRegistryPortPrefix, registryPageCount } from "../../lib/registry-utils.mjs";
import { RegistryPinnedGroup } from "./RegistryPinnedGroup";
import { RegistryMergeDialog } from "./RegistryMergeDialog";

const FIELD = "rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-3 py-2 text-sm";

function withoutPinnedService(data, id) {
  let removedGroups = 0;
  const items = data.items.map(group => {
    const services = group.services.filter(service => service.id !== id);
    if (services.length === group.services.length) return group;
    if (services.length === 0) { removedGroups += 1; return null; }
    const ids = new Set(services.map(service => service.id));
    const ports = group.ports.map(port => ({
      ...port, serviceIds: port.serviceIds.filter(value => ids.has(value)),
    })).filter(port => port.serviceIds.length > 0);
    const rank = { offline: 0, unknown: 1, listening: 2 };
    const status = services.reduce((result, service) =>
      rank[service.status] < rank[result] ? service.status : result, "listening");
    return { ...group, services, ports, status, serviceCount: services.length,
      sources: [...new Set(services.flatMap(service => service.sources || [service.source]))],
      iconHash: services.find(service => service.iconHash)?.iconHash || null };
  }).filter(Boolean);
  return { ...data, items, total: Math.max(0, data.total - removedGroups),
    serviceTotal: Math.max(0, data.serviceTotal - 1) };
}

function scrollSnapshot(element) {
  const containers = [];
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const overflow = window.getComputedStyle(node).overflowY;
    if (node.scrollHeight > node.clientHeight &&
        (overflow === "auto" || overflow === "scroll")) {
      containers.push({ node, top: node.scrollTop });
    }
  }
  return containers;
}

export function RegistryPinned({ onBrowseHistory }) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [portText, setPortText] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [lastSeenWindow, setLastSeenWindow] = useState("");
  const [page, setPage] = useState(0);
  const [version, setVersion] = useState(0);
  const [data, setData] = useState({ items: [], total: 0, serviceTotal: 0 });
  const [loading, setLoading] = useState(true);
  const loaded = useRef(false);
  const [error, setError] = useState("");
  const [scan, setScan] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [expandedGroupId, setExpandedGroupId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState("");
  const [forgetting, setForgetting] = useState(false);
  const [forgetDialogOpen, setForgetDialogOpen] = useState(false);
  const [forgetTargetId, setForgetTargetId] = useState(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [editor, setEditor] = useState(null);
  const editorRef = useRef(null);
  const editorTrigger = useRef(null);
  const [appearanceMessage, setAppearanceMessage] = useState("");
  const [retainedGroup, setRetainedGroup] = useState(null);
  const root = useRef(null);
  const savedScroll = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(0);
      setSearch(query.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const timer = setInterval(() => setVersion(value => value + 1), 30000);
    return () => clearInterval(timer);
  }, []);
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => setRetainedGroup(null), [search, portText, status, source, lastSeenWindow, page]);
  const portPrefix = parseRegistryPortPrefix(portText);
  const invalidPort = Boolean(portText.trim()) && portPrefix === null;

  useEffect(() => {
    if (invalidPort) return;
    const controller = new AbortController();
    if (!loaded.current) setLoading(true);
    setError("");
    getRegistryPinnedGroups({
      serverId: "local", limit: PAGE_SIZE, offset: page * PAGE_SIZE,
      status, source, search, portPrefix,
      seenSince: lastSeenWindow
        ? Date.now() - Number(lastSeenWindow) * 86400000 : null,
    }, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      loaded.current = true;
      // Keep the currently expanded row and its draft mounted during polling.
      // Refresh the list once Save/Cancel closes the editor.
      if (!editorRef.current) setData(result);
      setLoading(false);
    }).catch(failure => {
      if (controller.signal.aborted) return;
      setError(failure.message || "Unable to load pinned services");
      setLoading(false);
    });
    return () => controller.abort();
  }, [page, status, source, search, portPrefix, invalidPort, lastSeenWindow, version]);

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
    }).catch(failure => {
      if (!controller.signal.aborted) setDetailError(failure.message);
    });
    return () => controller.abort();
  }, [selectedId, version]);

  useLayoutEffect(() => {
    if (!savedScroll.current) return;
    for (const { node, top } of savedScroll.current) {
      if (node.isConnected) node.scrollTop = top;
    }
    savedScroll.current = null;
  }, [data, page, selectedId]);

  const restoreEditorFocus = () => {
    const trigger = editorTrigger.current;
    editorTrigger.current = null;
    requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  };

  const closeEditor = () => {
    editorRef.current = null;
    setEditor(null);
    restoreEditorFocus();
    refresh();
  };

  const openEditor = (scope, item, groupId) => {
    const target = { scope, id: item.id, groupId, item };
    editorTrigger.current = document.activeElement;
    editorRef.current = target;
    setEditor(target);
    setAppearanceMessage("");
  };

  const editGroup = group => {
    if (group.kind === "compose") openEditor("compose", group, group.id);
    else if (group.services[0]) openEditor("service", group.services[0], group.id);
  };

  const editService = service => {
    const group = data.items.find(item =>
      item.services.some(member => member.id === service.id));
    if (group) openEditor("service", group.services.find(member => member.id === service.id) || service, group.id);
  };

  const saveAppearance = async patch => {
    const target = editorRef.current;
    if (!target) return;
    savedScroll.current = scrollSnapshot(root.current);
    try {
      const saved = target.scope === "compose"
        ? await saveRegistryComposeAppearance(target.id, patch)
        : await saveRegistryServiceAppearance(target.id, patch);
      const updated = current => {
        if (!current || current.id !== target.id) return current;
        const name = Object.hasOwn(patch, "name")
          ? (patch.name === null
            ? (saved?.detectedName || current.detectedName ||
              current.appearance?.detectedName || current.displayName || current.name)
            : patch.name)
          : (current.displayName || current.name);
        const iconChoice = patch.icon === "automatic"
          ? { type: "automatic" } : patch.icon;
        const appearance = {
          ...current.appearance,
          ...(Object.hasOwn(patch, "name") ? { name: patch.name } : {}),
          ...(Object.hasOwn(patch, "icon") ? { icon: iconChoice } : {}),
          revision: saved?.appearanceRevision ?? patch.revision + 1,
        };
        return {
          ...current, appearance,
          appearanceRevision: saved?.appearanceRevision ?? patch.revision + 1,
          ...(Object.hasOwn(patch, "name")
            ? (target.scope === "compose" ? { name, customName: patch.name } : { displayName: name, customName: patch.name }) : {}),
          ...(Object.hasOwn(patch, "icon") ? { iconChoice } : {}),
        };
      };
      const updateGroup = group => {
        if (target.scope === "compose") return updated(group);
        if (!group.services.some(service => service.id === target.id)) return group;
        const services = group.services.map(updated);
        return {
          ...group, services,
          ...(group.kind === "service" ? {
            name: services[0].displayName,
            customName: services[0].customName,
            appearanceRevision: services[0].appearanceRevision,
            iconChoice: services[0].iconChoice,
          } : {}),
        };
      };
      setData(previous => ({ ...previous, items: previous.items.map(updateGroup) }));
      const before = data.items.find(group => group.id === target.groupId);
      const noLongerMatches = Object.hasOwn(patch, "name") && search &&
        !String(patch.name || saved?.detectedName || "").toLocaleLowerCase()
          .includes(search.toLocaleLowerCase());
      setRetainedGroup(noLongerMatches && before
        ? { id: before.id, group: updateGroup(before) } : null);
      if (target.scope === "service") setDetail(previous => updated(previous));
      editorRef.current = null;
      setEditor(null);
      restoreEditorFocus();
      setAppearanceMessage("Appearance saved.");
      refresh();
    } catch (failure) {
      savedScroll.current = null;
      throw failure;
    }
  };

  const reloadAppearance = async () => {
    const target = editorRef.current;
    if (target?.scope === "service") {
      const latest = await getRegistryService(target.id);
      setDetail(latest);
      setData(previous => ({
        ...previous,
        items: previous.items.map(group => {
          if (!group.services.some(item => item.id === target.id)) return group;
          const services = group.services.map(item =>
            item.id === target.id ? { ...item, ...latest } : item);
          return { ...group, services };
        }),
      }));
    }
    closeEditor();
  };

  const toggleGroup = group => {
    if (editorRef.current) closeEditor();
    if (expandedGroupId === group.id) {
      setExpandedGroupId(null);
      setSelectedId(null);
    } else {
      setExpandedGroupId(group.id);
      setSelectedId(group.services[0]?.id || null);
    }
    setForgetDialogOpen(false);
  };

  const handleUnpin = async service => {
    if (!service?.pinned || pinBusy) return;
    setPinBusy(true);
    setPinError("");
    savedScroll.current = scrollSnapshot(root.current);
    try {
      await setRegistryServicePinned(service.id, false);
      setRetainedGroup(null);
      const group = data.items.find(item =>
        item.services.some(member => member.id === service.id));
      const next = group?.services.find(member => member.id !== service.id);
      setData(previous => withoutPinnedService(previous, service.id));
      setSelectedId(next?.id || null);
      if (!next) setExpandedGroupId(null);
      setDetail(null);
      setPinError("");
      if (data.items.length === 1 && data.items[0].services.length === 1 && page > 0) {
        setPage(value => Math.max(0, value - 1));
      } else {
        refresh();
      }
    } catch (failure) {
      savedScroll.current = null;
      setPinError(failure.message || "Unable to unpin service");
    } finally {
      setPinBusy(false);
    }
  };

  const handleForget = async () => {
    if (!forgetTargetId || forgetting) return;
    setForgetting(true);
    setDetailError("");
    savedScroll.current = scrollSnapshot(root.current);
    try {
      await forgetRegistryService(forgetTargetId);
      setRetainedGroup(null);
      const group = data.items.find(item =>
        item.services.some(member => member.id === forgetTargetId));
      const next = group?.services.find(member => member.id !== forgetTargetId);
      setData(previous => withoutPinnedService(previous, forgetTargetId));
      setSelectedId(previous => previous === forgetTargetId ? (next?.id || null) : previous);
      if (!next) setExpandedGroupId(previous => previous === group?.id ? null : previous);
      setDetail(previous => previous?.id === forgetTargetId ? null : previous);
      setForgetDialogOpen(false);
      setForgetTargetId(null);
      if (data.items.length === 1 && data.items[0].services.length === 1 && page > 0) {
        setPage(value => Math.max(0, value - 1));
      } else {
        refresh();
      }
    } catch (failure) {
      savedScroll.current = null;
      setDetailError(failure.message || "Unable to forget service");
    } finally {
      setForgetting(false);
    }
  };

  const handleScanNow = async () => {
    if (scanning || !scan?.enabled) return;
    setScanning(true);
    setScanMessage("");
    try {
      const result = await scanRegistryNow();
      setScanMessage("Scan finished: " + (result.results || []).map(item =>
        item.source + " " + item.outcome).join(" · "));
      refresh();
    } catch (failure) {
      setScanMessage(failure.message || "Unable to scan services");
    } finally {
      setScanning(false);
    }
  };

  const mergeTarget = data.items.flatMap(group => group.services)
    .find(service => service.id === selectedId);
  const pages = registryPageCount(data.total);
  const visibleItems = retainedGroup
    ? [retainedGroup.group, ...data.items.filter(group => group.id !== retainedGroup.id)]
    : data.items;
  return (
    <section ref={root} aria-label="Pinned service groups" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900 dark:text-white">
            <Pin className="h-6 w-6" /> Pinned services
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Favorite service groups with all their remembered ports, including offline services.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={refresh}
            title="Reload saved services without scanning. The list also updates every 30 seconds."
            className={FIELD + " flex items-center gap-2"}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reload list
          </button>
          <button type="button" onClick={handleScanNow} disabled={scanning || !scan?.enabled}
            title="Discover currently listening services, then reload the saved list"
            className={FIELD + " flex items-center gap-2 disabled:opacity-50"}>
            <ScanSearch className="h-4 w-4" aria-hidden="true" /> {scanning ? "Scanning…" : "Scan now"}
          </button>
        </div>
      </div>
      <RegistryCapabilities scan={scan} />
      {scanMessage && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{scanMessage}</p>}
      {scan && !scan.enabled && <p className="text-sm text-amber-600">Discovery is disabled. Saved pins remain accessible.</p>}
      {pinError && <p role="alert" className="text-sm text-red-600">{pinError}</p>}
      {appearanceMessage && (
        <p role="status" className="text-sm text-indigo-700 dark:text-indigo-300">
          {appearanceMessage}
          {retainedGroup && (
            <>
              {" "}The renamed item stays visible outside the current name filter
              until you change filters or page.
              <button type="button" className="ml-2 underline focus-visible:outline-2"
                onClick={() => { setQuery(""); setSearch(""); setPage(0);
                  setRetainedGroup(null); refresh(); }}>
                Clear name filter
              </button>
            </>
          )}
        </p>
      )}
      <div aria-label="Pinned filters" className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <label className="space-y-1 text-sm">
          <span>Name</span>
          <span className="relative block">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input aria-label="Search pinned services" value={query} maxLength={100}
              placeholder="Search saved services" onChange={event => setQuery(event.target.value)}
              className={FIELD + " w-full pl-9"} />
          </span>
        </label>
        <label className="space-y-1 text-sm">
          <span>Port (starts with)</span>
          <input aria-label="Filter pinned ports" value={portText} maxLength={5}
            inputMode="numeric" onChange={event => { setPortText(event.target.value); setPage(0); }}
            className={FIELD + " w-full"} />
        </label>
        <label className="space-y-1 text-sm">
          <span>Status</span>
          <select aria-label="Filter pinned status" value={status}
            onChange={event => { setStatus(event.target.value); setPage(0); }}
            className={FIELD + " w-full"}>
            <option value="">All statuses</option>
            <option value="listening">Listening</option>
            <option value="offline">Offline</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>Last seen</span>
          <select aria-label="Filter pinned last seen" value={lastSeenWindow}
            onChange={event => { setLastSeenWindow(event.target.value); setPage(0); }}
            className={FIELD + " w-full"}>
            <option value="">Any time</option>
            <option value="1">Past 24 hours</option>
            <option value="7">Past 7 days</option>
            <option value="30">Past 30 days</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>Source</span>
          <select aria-label="Filter pinned source" value={source}
            onChange={event => { setSource(event.target.value); setPage(0); }}
            className={FIELD + " w-full"}>
            <option value="">All sources</option>
            <option value="docker">Docker</option>
            <option value="system">Native system</option>
          </select>
        </label>
      </div>
      {invalidPort && <p role="alert" className="text-sm text-red-600">Enter a numeric port prefix (1–65535).</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading && <p role="status" className="text-sm text-slate-500">Loading pinned services…</p>}
      {!loading && !error && !invalidPort && visibleItems.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center text-slate-600 dark:text-slate-400">
          No pinned services match these filters. Pin a service from History or adjust your filters.
          <button type="button" onClick={onBrowseHistory}
            className="mx-auto mt-4 block rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white">
            Browse History
          </button>
        </div>
      )}
      {!invalidPort && visibleItems.length > 0 && (
        <div data-pinned-service-list className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Services ({data.total})
            </h2>
            <span className="text-xs text-slate-500">{data.serviceTotal} pinned records</span>
          </div>
          <div className="space-y-3">
            {visibleItems.map(group => (
              <RegistryPinnedGroup key={group.id} group={group}
                expanded={expandedGroupId === group.id} selectedId={selectedId}
                detail={detail} detailError={detailError}
                onToggle={toggleGroup} onSelect={setSelectedId}
                onPinToggle={handleUnpin}
                onForget={service => { setForgetTargetId(service.id); setDetailError(""); setForgetDialogOpen(true); }}
                 onMerge={() => setMergeOpen(true)}
                onClose={() => { setExpandedGroupId(null); setSelectedId(null); closeEditor(); }}
                onEditGroup={editGroup} onEditService={editService}
                editor={editor?.groupId === group.id ? editor : null}
                onSaveAppearance={saveAppearance} onCancelAppearance={closeEditor}
                onReloadAppearance={reloadAppearance}
                pinBusy={pinBusy} forgetting={forgetting}
              />
            ))}
          </div>
        </div>
      )}
      {!invalidPort && !loading && pages > 1 && (
        <nav aria-label="Pinned pages" className="flex items-center justify-center gap-3 text-sm">
          <button type="button" className={FIELD} disabled={page === 0}
            onClick={() => setPage(value => Math.max(0, value - 1))}>Previous</button>
          <span>Page {page + 1} of {pages} · {data.total} groups</span>
          <button type="button" className={FIELD} disabled={page >= pages - 1}
            onClick={() => { setPage(value => value + 1); setExpandedGroupId(null); setSelectedId(null); }}>
            Next
          </button>
        </nav>
      )}
      {mergeOpen && mergeTarget && (
        <RegistryMergeDialog target={mergeTarget}
          onClose={() => setMergeOpen(false)}
          onMerged={updated => {
            savedScroll.current = scrollSnapshot(root.current);
            setDetail(updated);
            setMergeOpen(false);
            setRetainedGroup(null);
            refresh();
          }} />
      )}
      <Dialog open={forgetDialogOpen} onOpenChange={open => {
        if (!forgetting) setForgetDialogOpen(open);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Forget saved service?</DialogTitle>
            <DialogDescription>
              Forget {data.items.flatMap(group => group.services).find(service => service.id === forgetTargetId)?.displayName || "this service"}? This removes only its own saved
              history, pins, and recovery notes. It does not stop any running process
              or delete other services in the group.
            </DialogDescription>
          </DialogHeader>
          {detailError && <p role="alert" className="text-sm text-red-600">{detailError}</p>}
          <DialogFooter>
            <button type="button" className={FIELD} disabled={forgetting}
              onClick={() => setForgetDialogOpen(false)}>Cancel</button>
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
