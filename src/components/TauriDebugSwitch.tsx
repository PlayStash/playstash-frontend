import { isDebugTauriOverride, setDebugTauriOverride } from "@/utils/tauri";
import { ComputerDesktopIcon } from "@heroicons/react/16/solid";
import { Switch, SwitchField, SwitchGroup } from "@tw/switch";
import { useCallback, useState } from "react";
import { useTranslation } from "@/i18n";

export default function TauriDebugSwitch({
  className,
}: {
  className?: string;
}) {
  const { t } = useTranslation();
  const [checked, setChecked] = useState(isDebugTauriOverride);

  const handleChange = useCallback((next: boolean) => {
    setChecked(next);
    setDebugTauriOverride(next);
    // Force a full page reload so all components pick up the new mode
    window.location.reload();
  }, []);

  return (
    <SwitchGroup className={className}>
      <SwitchField>
        <div
          data-slot="label"
          className="flex items-center gap-2 text-sm text-ps-muted"
        >
          <ComputerDesktopIcon className="size-4" aria-hidden="true" />
          <span>{t("appearance.debug.simulateDesktop")}</span>
        </div>

        <Switch
          aria-label={t("appearance.debug.simulateDesktopToggle")}
          checked={checked}
          onChange={handleChange}
          color="dark/zinc"
          className="cursor-pointer"
        />
      </SwitchField>
    </SwitchGroup>
  );
}
