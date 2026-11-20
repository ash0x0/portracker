import React from "react";
import { ChevronRight, Container, Pin, Server } from "lucide-react";
import { RegistryServiceDetails } from "./RegistryServiceDetails";

function PortChip({ item }) {
  return (
    <span title={(item.active ? "Current" : "Remembered") + " " +
        item.protocol.toUpperCase() + " endpoint" + (item.internal ? " · internal" : "")}
      className={"rounded-full px-2 py-0.5 font-mono text-xs tabular-nums " +
        (item.active
          ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200"
          : "bg-slate-200 text-slate-600 dark:bg-slate-700/70 dark:text-slate-300")}>
      {item.port}
    </span>
  );
}

function SourceIndicator({ group }) {
  const docker = group.sources.includes("docker");
  return (
    <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      <span className={"rounded px-1.5 py-0.5 " + (docker
        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200"
        : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200")}>
        {group.sources.join(" + ")}
      </span>
      {group.serviceCount > 1 && <span>{group.serviceCount} services</span>}
      <span>{group.ports.length} port{group.ports.length === 1 ? "" : "s"}</span>
    </span>
  );
}

function GroupMemberSelector({ group, selectedId, onSelect }) {
  if (group.services.length < 2) return null;
  return (
    <div className="space-y-1 border-b border-slate-200 dark:border-slate-700 pb-3"
      aria-label="Services in Compose project">
      {group.services.map(service => (
        <button key={service.id} type="button" onClick={() => onSelect(service.id)}
          aria-pressed={selectedId === service.id}
          className={"flex w-full flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm " +
            (selectedId === service.id
              ? "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-200"
              : "hover:bg-slate-100 dark:hover:bg-slate-800")}>
          <span className="font-medium">{service.composeService || service.displayName}</span>
          <span className="flex flex-wrap gap-1">
            {service.endpoints.slice(0, 5).map(endpoint =>
              <PortChip key={endpoint.id} item={{
                port: endpoint.hostPort, protocol: endpoint.protocol,
                active: service.status === "listening" &&
                  endpoint.lastSeenAt === service.lastSeenAt,
                internal: endpoint.internal,
              }} />)}
            {service.endpoints.length > 5 && <span>+{service.endpoints.length - 5}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

export function RegistryPinnedGroup({
  group, expanded, selectedId, detail, detailError, onToggle, onSelect,
  onPinToggle, onForget, onClose, pinBusy, forgetting,
}) {
  const selected = group.services.find(service => service.id === selectedId);
  return (
    <article data-pinned-group={group.id}
      className="min-w-0 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40">
      <button type="button" onClick={() => onToggle(group)}
        aria-expanded={expanded} aria-label={group.name + " service group"}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <ChevronRight className={"h-5 w-5 shrink-0 text-slate-400 transition-transform " +
            (expanded ? "rotate-90" : "")} aria-hidden="true" />
          {group.iconHash
            ? <img alt="" src={"/api/service-registry/icons/" + group.iconHash}
                width="24" height="24" className="h-6 w-6 shrink-0 object-contain" />
            : group.sources.includes("docker")
              ? <Container aria-hidden="true" className="h-6 w-6 shrink-0 text-blue-500" />
              : <Server aria-hidden="true" className="h-6 w-6 shrink-0 text-slate-500" />}
          <span aria-label={group.status}
            title={group.status}
            className={"h-2.5 w-2.5 shrink-0 rounded-full " +
              (group.status === "listening" ? "bg-emerald-500" :
                group.status === "offline" ? "bg-slate-400" : "bg-amber-500")} />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-slate-900 dark:text-slate-100">
              {group.name}
            </span>
            <SourceIndicator group={group} />
          </span>
          <Pin className="h-3.5 w-3.5 shrink-0 text-indigo-400" aria-hidden="true" />
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {group.ports.slice(0, 5).map(item =>
            <PortChip key={item.protocol + ":" + item.port} item={item} />)}
          {group.ports.length > 5 && (
            <span className="text-xs text-slate-500">+{group.ports.length - 5} more</span>
          )}
        </span>
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-slate-200 dark:border-slate-700 p-3">
          {group.ports.length > 0 && (
            <div aria-label="All remembered group ports" className="flex flex-wrap items-center gap-2 px-1">
              <span className="mr-1 text-xs text-slate-500">Ports</span>
              {group.ports.map(item => (
                <PortChip key={item.protocol + ":" + item.port} item={item} />
              ))}
            </div>
          )}
          <GroupMemberSelector group={group} selectedId={selectedId} onSelect={onSelect} />
          {selected && (
            <RegistryServiceDetails
              detail={detail?.id === selected.id ? detail : null}
              detailError={detailError}
              onPinToggle={onPinToggle}
              onForget={onForget}
              onClose={onClose}
              pinBusy={pinBusy}
              forgetting={forgetting}
            />
          )}
        </div>
      )}
    </article>
  );
}
