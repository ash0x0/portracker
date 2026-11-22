import React, { useEffect, useId, useState } from "react";
import { Code2, Container, Database, Globe, HardDrive, ImagePlus, Monitor, Network, RotateCcw, Server, Settings, ShieldCheck, TerminalSquare } from "lucide-react";
import { RegistryServiceIcon } from "./RegistryServiceIcon";
import { uploadRegistryCustomIcon } from "../../lib/api/serviceRegistry";

// Keep this gallery aligned with the server-side built-in icon allowlist (#77).
const BUILTINS = [
  { name: "editor", label: "Code editor", Icon: Code2 },
  { name: "terminal", label: "Terminal", Icon: TerminalSquare },
  { name: "container", label: "Container", Icon: Container },
  { name: "server", label: "Server", Icon: Server },
  { name: "globe", label: "Web", Icon: Globe },
  { name: "database", label: "Database", Icon: Database },
  { name: "code", label: "Code", Icon: Code2 },
  { name: "monitor", label: "Monitor", Icon: Monitor },
  { name: "network", label: "Network", Icon: Network },
  { name: "shield", label: "Security", Icon: ShieldCheck },
  { name: "settings", label: "Settings", Icon: Settings },
  { name: "hard-drive", label: "Storage", Icon: HardDrive },
];
const FIELD = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const BUTTON = "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-700";

function getIconChoice(item) {
  const value = item.iconChoice || item.appearance?.icon;
  if (value?.type === "glyph" && BUILTINS.some(icon => icon.name === value.name)) {
    return { type: "glyph", name: value.name };
  }
  if (value?.type === "upload" && /^[a-f0-9]{64}$/.test(value.hash || "")) {
    return { type: "upload", hash: value.hash };
  }
  return { type: "automatic" };
}

export function RegistryAppearanceEditor({ item, scope, onSave, onCancel, onReload }) {
  const formId = useId();
  // An editor mounts for one scope and is keyed by scope+ID by its parent.
  // Never reinitialize its draft from the 30-second list refresh.
  const detectedName = item.detectedName || item.appearance?.detectedName ||
    (scope === "compose" ? item.name : item.displayName);
  const effectiveName = scope === "compose" ? item.name : item.displayName;
  const [name, setName] = useState(effectiveName || "");
  const [nameChanged, setNameChanged] = useState(false);
  const [resetName, setResetName] = useState(false);
  const [icon, setIcon] = useState(() => getIconChoice(item));
  const [iconChanged, setIconChanged] = useState(false);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const revision = item.appearance?.revision ?? item.appearanceRevision ?? 0;

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return undefined; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const choose = value => {
    setFile(null);
    setIcon(value);
    setIconChanged(true);
    setError("");
  };

  const handleFile = event => {
    const candidate = event.target.files?.[0];
    event.target.value = "";
    if (!candidate) return;
    if (candidate.size > 128 * 1024 || candidate.size === 0) {
      setError("Choose an image smaller than 128 KiB.");
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp", "image/x-icon",
      "image/vnd.microsoft.icon"].includes(candidate.type) &&
      !(candidate.type === "" && /\.ico$/i.test(candidate.name))) {
      setError("Choose a PNG, JPEG, WebP, or ICO image.");
      return;
    }
    setFile(candidate.type === "" && /\.ico$/i.test(candidate.name)
      ? new File([candidate], candidate.name, { type: "image/x-icon" })
      : candidate);
    setIcon({ type: "upload" });
    setIconChanged(true);
    setError("");
  };

  const reloadLatest = async () => {
    setBusy(true);
    setError("");
    try { await onReload(); }
    catch (failure) { setError(failure.message || "Unable to reload appearance."); }
    finally { setBusy(false); }
  };

  const handleSave = async event => {
    event.preventDefault();
    if (busy || (!nameChanged && !iconChanged)) return;
    const trimmedName = name.trim();
    if (nameChanged && !resetName && (!trimmedName || [...trimmedName].length > 80)) {
      setError("Enter a name between 1 and 80 characters, or reset to automatic.");
      return;
    }
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      const patch = { revision };
      if (nameChanged) patch.name = resetName ? null : trimmedName;
      if (iconChanged) {
        const uploaded = file ? await uploadRegistryCustomIcon(file) : null;
        patch.icon = uploaded ? { type: "upload", hash: uploaded.hash }
          : icon.type === "automatic" ? "automatic" : icon;
      }
      await onSave(patch);
    } catch (failure) {
      setConflict(failure.status === 409);
      setError(failure.status === 409
        ? "Appearance changed in another session. Reload the latest version before retrying; your draft is still here."
        : (failure.message || "Unable to save appearance. Your draft has been preserved."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form aria-label={"Edit " + (scope === "compose" ? "Compose group" : "service") + " appearance"}
      data-appearance-editor={scope} onSubmit={handleSave}
      onKeyDown={event => {
        if (event.key === "Escape" && !busy) {
          event.stopPropagation();
          onCancel();
        }
      }}
      className="space-y-4 rounded-lg border border-indigo-200 bg-indigo-50/40 p-4 dark:border-indigo-900 dark:bg-slate-900/50">
      <div>
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {scope === "compose" ? "Edit Compose project appearance" : "Edit selected service appearance"}
        </h3>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          Editing: <strong>{effectiveName}</strong>.{" "}
          {scope === "compose"
            ? "Only this project's visible header changes. Member services keep their names and icons."
            : "Only this saved service changes. Its identity, pins and other group members are unchanged."}
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor={formId + "-name"} className="block text-sm font-medium">Display name</label>
        <input id={formId + "-name"} type="text" maxLength={80} autoFocus className={FIELD}
          value={resetName ? detectedName : name} disabled={busy || resetName}
          onChange={event => { setName(event.target.value); setNameChanged(true); }} />
        <p className="text-xs text-slate-600 dark:text-slate-400">Detected name: {detectedName}</p>
        <button type="button" disabled={busy} className={BUTTON}
          onClick={() => {
            if (resetName) { setResetName(false); setName(effectiveName || ""); }
            else { setResetName(true); setNameChanged(true); }
          }}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {resetName ? "Undo name reset" : "Reset name"}
        </button>
      </div>
      <fieldset className="space-y-2" disabled={busy}>
        <legend className="text-sm font-medium">Icon</legend>
        <div className="flex items-center gap-2 text-sm">
          {previewUrl
            ? <img alt="New selected image preview" src={previewUrl} width={32} height={32}
              className="h-8 w-8 object-contain" />
            : <RegistryServiceIcon name={detectedName} source={item.source ||
                (item.sources?.includes("docker") ? "docker" : "system")}
                iconHash={item.iconHash} iconChoice={icon} size={32} />}
          <span>Preview</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <label className={"flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm focus-within:ring-2 focus-within:ring-indigo-500 " +
            (icon.type === "automatic" ? "border-indigo-500 bg-indigo-100/70 dark:bg-indigo-950" : "border-slate-300 dark:border-slate-700")}>
            <input type="radio" name={formId + "-icon"} checked={icon.type === "automatic"}
              onChange={() => choose({ type: "automatic" })} />
            Automatic
          </label>
          {BUILTINS.map(({ name: choice, label, Icon }) => (
            <label key={choice}
              className={"flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm focus-within:ring-2 focus-within:ring-indigo-500 " +
                (icon.type === "glyph" && icon.name === choice
                  ? "border-indigo-500 bg-indigo-100/70 dark:bg-indigo-950"
                  : "border-slate-300 dark:border-slate-700")}>
              <input type="radio" name={formId + "-icon"}
                checked={icon.type === "glyph" && icon.name === choice}
                onChange={() => choose({ type: "glyph", name: choice })} />
              <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              {label}
            </label>
          ))}
          <label className={BUTTON + " cursor-pointer"}>
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
            Upload image
            <input type="file" className="sr-only" aria-label="Upload custom appearance icon"
              accept=".png,.jpg,.jpeg,.webp,.ico,image/png,image/jpeg,image/webp,image/x-icon"
              onChange={handleFile} />
          </label>
        </div>
        <button type="button" disabled={busy} className={BUTTON}
          onClick={() => choose({ type: "automatic" })}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset icon
        </button>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Images stay local to this dashboard. PNG, JPEG, WebP or ICO, at most 128 KiB.
          Uploads are validated on the server when you save.
        </p>
      </fieldset>
      {error && <div role="alert" className="space-y-2 text-sm text-red-700 dark:text-red-300">
        <p>{error}</p>
        {conflict && <button type="button" className={BUTTON} disabled={busy} onClick={reloadLatest}>
          Reload latest and discard draft
        </button>}
      </div>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={BUTTON} disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="submit" disabled={busy || (!nameChanged && !iconChanged)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-50">
          {busy ? "Saving…" : "Save appearance"}
        </button>
      </div>
    </form>
  );
}
