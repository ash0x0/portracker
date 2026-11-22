import React from "react";
import {
  Code2, Container, Database, Globe, HardDrive, Monitor,
  Network, Server, Settings, ShieldCheck, TerminalSquare,
} from "lucide-react";
import { registryIconKind } from "../../lib/registry-icon-fallback.mjs";

// Curated icons only. Neither the API nor this renderer accepts arbitrary
// Lucide component names, SVG markup, CSS, file paths or remote URLs.
const GLYPHS = {
  editor: { Icon: Code2, label: "Generic code editor icon" },
  terminal: { Icon: TerminalSquare, label: "Generic terminal icon" },
  container: { Icon: Container, label: "Generic Docker service icon" },
  server: { Icon: Server, label: "Generic native service icon" },
  globe: { Icon: Globe, label: "Generic web service icon" },
  database: { Icon: Database, label: "Generic database icon" },
  code: { Icon: Code2, label: "Generic code icon" },
  monitor: { Icon: Monitor, label: "Generic monitor icon" },
  network: { Icon: Network, label: "Generic network icon" },
  shield: { Icon: ShieldCheck, label: "Generic security icon" },
  settings: { Icon: Settings, label: "Generic settings icon" },
  "hard-drive": { Icon: HardDrive, label: "Generic storage icon" },
};
const HASH = /^[a-f0-9]{64}$/;

export function RegistryServiceIcon({
  iconHash, iconChoice, name, source = "system", size = 24,
}) {
  const isUpload = iconChoice?.type === "upload" &&
    typeof iconChoice.hash === "string" && HASH.test(iconChoice.hash);
  if (isUpload) {
    return <img alt="" title="User-selected uploaded icon" loading="lazy"
      width={size} height={size} className="shrink-0 object-contain"
      src={"/api/service-registry/custom-icons/" + iconChoice.hash} />;
  }
  const selected = iconChoice?.type === "glyph" &&
    Object.prototype.hasOwnProperty.call(GLYPHS, iconChoice.name) ?
    GLYPHS[iconChoice.name] : null;
  if (selected) {
    const { Icon, label } = selected;
    return <Icon aria-hidden="true" title={"Selected " + label} size={size}
      className="shrink-0 text-indigo-500" />;
  }
  if (iconHash && HASH.test(iconHash)) {
    return <img alt="" title="Verified cached site favicon" loading="lazy"
      width={size} height={size} className="shrink-0 object-contain"
      src={"/api/service-registry/icons/" + iconHash} />;
  }
  const { Icon, label } = GLYPHS[registryIconKind(name, source)];
  return <Icon aria-hidden="true" title={label + " (not a verified favicon)"} size={size}
    className={"shrink-0 " + (source === "docker" ? "text-blue-500" : "text-slate-500")} />;
}
