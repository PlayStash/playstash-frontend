import { setStreamerMode, useStreamerMode } from "@/utils/streamerMode";
import { Switch, SwitchField, SwitchGroup } from "@tw/switch";
import { useTranslation } from "@/i18n";

export default function StreamerModeToggle({
  className,
}: {
  className?: string;
}) {
  const streamerMode = useStreamerMode();
  const { t } = useTranslation();

  return (
    <SwitchGroup className={className}>
      <SwitchField>
        <Switch
          aria-label={t("appearance.streamerMode.toggle")}
          checked={streamerMode}
          onChange={setStreamerMode}
          color="dark/zinc"
          className="cursor-pointer"
        />
      </SwitchField>
    </SwitchGroup>
  );
}
