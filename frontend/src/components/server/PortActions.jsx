import { Copy, Edit, EyeOff, Eye } from "lucide-react";
import { ActionButton } from "./ActionButton";
import { LiveRegistryPinButton } from "@/components/registry/LiveRegistryPinButton";
import { OpenPortLink } from "@/components/ui/OpenPortLink";

export function PortActions({
  port,
  serverId,
  itemKey,
  actionFeedback,
  onCopy,
  onEdit,
  onHide,
  size,
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <LiveRegistryPinButton ports={[port]} serverId={serverId} compact />
      {serverId === "local" && <OpenPortLink port={port.host_port} protocol={port.protocol} internal={port.internal} />}
      <ActionButton
        type="copy"
        itemKey={itemKey}
        actionFeedback={actionFeedback}
        onClick={onCopy}
        icon={Copy}
        title="Copy URL to clipboard"
        size={size}
      />
      <ActionButton
        type="edit"
        itemKey={itemKey}
        actionFeedback={actionFeedback}
        onClick={onEdit}
        icon={Edit}
        title="Edit note"
        size={size}
      />
      <ActionButton
        type={port.ignored ? "unhide" : "hide"}
        itemKey={itemKey}
        actionFeedback={actionFeedback}
        onClick={onHide}
        icon={port.ignored ? Eye : EyeOff}
        title={port.ignored ? "Unhide this port" : "Hide this port"}
        size={size}
      />
    </div>
  );
}
