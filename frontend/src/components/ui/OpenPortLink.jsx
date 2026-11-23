import React from "react";
import { ExternalLink } from "lucide-react";
import { localPortUrl } from "@/lib/local-port-url.mjs";

export function OpenPortLink({
  port, protocol = "tcp", internal = false, httpRootUrl = null,
  offline = false, showPort = false, className = "",
}) {
  const href = localPortUrl(port, { protocol, internal, httpRootUrl });
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      aria-label={`Open link for localhost port ${Number(port)} in a new tab`}
      title={offline
        ? `Open localhost:${Number(port)} (last seen; service may be offline)`
        : `Open ${href} in a new tab`}
      onClick={event => event.stopPropagation()}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-indigo-300 px-2.5 py-2 text-sm font-medium text-indigo-700 hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-indigo-400/60 dark:text-indigo-300 dark:hover:bg-indigo-400/10 ${className}`}>
      <ExternalLink className="h-4 w-4" aria-hidden="true" />
      <span>Open link{showPort ? ` :${Number(port)}` : ""}</span>
    </a>
  );
}
