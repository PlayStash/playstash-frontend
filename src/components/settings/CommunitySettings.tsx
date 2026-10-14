import { useEffect, useState } from "react";
import { Switch } from "@tw/switch";
import {
  SettingsGroup,
  SettingsLabel,
  SettingsRow,
} from "@/components/settings/SettingsPrimitives";
import { useTranslation } from "@/i18n";
import type { SettingsSectionProps } from "@/settings/types";
import {
  COMMUNITY_NOTIFICATIONS_EVENT,
  getCommunityNotificationsEnabled,
  setCommunityNotificationsEnabled,
  type CommunityNotificationKind,
} from "@/utils/communityNotifications";

function useNotificationSetting(kind: CommunityNotificationKind) {
  const [enabled, setEnabled] = useState(() =>
    getCommunityNotificationsEnabled(kind),
  );
  useEffect(() => {
    const sync = () => setEnabled(getCommunityNotificationsEnabled(kind));
    window.addEventListener(COMMUNITY_NOTIFICATIONS_EVENT, sync);
    return () =>
      window.removeEventListener(COMMUNITY_NOTIFICATIONS_EVENT, sync);
  }, [kind]);
  const update = (next: boolean) => {
    setEnabled(next);
    setCommunityNotificationsEnabled(kind, next);
  };
  return [enabled, update] as const;
}

/** Settings → Community: chat and activity OS notifications (desktop). */
export default function CommunitySettings({
  rowHighlight,
}: SettingsSectionProps) {
  const { t } = useTranslation();
  const [chat, setChat] = useNotificationSetting("chat");
  const [activity, setActivity] = useNotificationSetting("activity");
  return (
    <SettingsGroup caption={t("communitySettings.notifications")}>
      <SettingsRow
        id="setting-community-chat-notifications"
        className={rowHighlight("community-chat-notifications")}
      >
        <SettingsLabel
          title={t("communitySettings.chat")}
          description={t("communitySettings.chatDescription")}
        />
        <Switch
          name="chatNotifications"
          color="indigo"
          aria-label={t("communitySettings.chat")}
          checked={chat}
          onChange={(value: boolean) => setChat(value)}
        />
      </SettingsRow>
      <SettingsRow
        id="setting-community-activity-notifications"
        className={rowHighlight("community-activity-notifications")}
      >
        <SettingsLabel
          title={t("communitySettings.activity")}
          description={t("communitySettings.activityDescription")}
        />
        <Switch
          name="activityNotifications"
          color="indigo"
          aria-label={t("communitySettings.activity")}
          checked={activity}
          onChange={(value: boolean) => setActivity(value)}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
