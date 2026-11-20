import React from "react";
import { Code2, Container, Server, TerminalSquare } from "lucide-react";

function iconFallback(name, source) {
  const token = String(name || "").toLowerCase().replace(/[_\s]+/g, "-");
  if (/(^|-)(vscode|code-server|openvscode-server|visual-studio-code)(-|$)/.test(token)) {
    return { Icon: Code2, label: "Generic code editor icon, not a verified favicon" };
  }
  if (/(^|-)hermes(-|$)/.test(token)) {
    return { Icon: TerminalSquare, label: "Generic terminal icon, not a verified favicon" };
  }
  return source === "docker"
    ? { Icon: Container, label: "Generic Docker service icon, not a verified favicon" }
    : { Icon: Server, label: "Generic native service icon, not a verified favicon" };
}

export function RegistryServiceIcon({ iconHash, name, source = "system", size = 24 }) {
  const { Icon, label } = iconFallback(name, source);
  if (iconHash && /^[a-f0-9]{64}$/.test(iconHash)) {
    return <img alt="" title="Verified cached site favicon" loading="lazy"
      width={size} height={size} className="shrink-0 object-contain"
      src={"/api/service-registry/icons/" + iconHash} />;
  }
  return <Icon aria-hidden="true" title={label} size={size}
    className={"shrink-0 " + (source === "docker" ? "text-blue-500" : "text-slate-500")} />;
}
