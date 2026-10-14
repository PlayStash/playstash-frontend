import { useEffect, useState } from "react";
import {
  Cog6ToothIcon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { Button } from "@tw/button";
import { Checkbox, CheckboxField } from "@tw/checkbox";
import {
  Dropdown,
  DropdownButton,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
} from "@tw/dropdown";
import { Label } from "@tw/fieldset";
import { Heading } from "@tw/heading";
import { Text } from "@tw/text";
import { useTranslation } from "@/i18n";
import { createDicebearAvatar } from "@/utils/dicebearAvatar";
import { getCachedMediaBlob } from "@/utils/mediaCache";
import { profileHost, type Profile } from "@/utils/profiles";

/** The profile's avatar from the media cache, else the generated placeholder. */
function ProfileAvatar({ profile }: { profile: Profile }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    if (profile.avatarMediaId) {
      void getCachedMediaBlob(profile.serverUrl, profile.avatarMediaId).then(
        (blob) => {
          if (cancelled || !blob) return;
          url = URL.createObjectURL(blob);
          setSrc(url);
        },
      );
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [profile.serverUrl, profile.avatarMediaId]);
  const seed = profile.userId != null ? String(profile.userId) : profile.id;
  return (
    <img
      src={src ?? createDicebearAvatar(seed)}
      alt=""
      className="size-14 shrink-0 rounded-[20%] object-cover"
    />
  );
}

/** "Choose Your Profile": one card per profile; click logs in. */
export function ProfilePicker({
  profiles,
  rememberMe,
  busyProfileId,
  onSelect,
  onEdit,
  onDelete,
  onNewProfile,
  onClientSettings,
  onRememberMeChange,
}: {
  profiles: Profile[];
  rememberMe: boolean;
  busyProfileId: string | null;
  onSelect: (profile: Profile) => void;
  onEdit: (profile: Profile) => void;
  onDelete: (profile: Profile) => void;
  onNewProfile: () => void;
  onClientSettings: () => void;
  onRememberMeChange: (rememberMe: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid w-full max-w-md grid-cols-1 gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Heading>{t("accounts.picker.title")}</Heading>
          <Text>{t("accounts.picker.description")}</Text>
        </div>
        <Button
          plain
          aria-label={t("accounts.clientSettings")}
          title={t("accounts.clientSettings")}
          onClick={onClientSettings}
        >
          <Cog6ToothIcon />
        </Button>
      </div>

      <ul
        className="grid grid-cols-1 gap-3"
        aria-label={t("accounts.picker.title")}
      >
        {profiles.map((profile) => {
          const name =
            profile.username ||
            profile.displayName ||
            profileHost(profile.serverUrl);
          return (
            <li
              key={profile.id}
              className="flex items-center gap-3 rounded-2xl border border-ps-line bg-ps-panel-strong p-3 shadow-sm"
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-ps-accent disabled:opacity-60"
                onClick={() => onSelect(profile)}
                disabled={!!busyProfileId}
                aria-busy={busyProfileId === profile.id}
              >
                <ProfileAvatar profile={profile} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ps-text">
                    {name}
                  </span>
                  <span className="block truncate text-xs text-ps-muted">
                    {profileHost(profile.serverUrl)}
                    {profile.sso ? ` · ${t("accounts.picker.sso")}` : ""}
                  </span>
                  {busyProfileId === profile.id && (
                    <span className="block text-xs text-ps-accent">
                      {t("accounts.status.loggingIn")}
                    </span>
                  )}
                </span>
              </button>
              <Dropdown>
                <DropdownButton
                  plain
                  aria-label={t("accounts.picker.actions").replace(
                    "{name}",
                    name,
                  )}
                >
                  <EllipsisVerticalIcon />
                </DropdownButton>
                <DropdownMenu anchor="bottom end">
                  <DropdownItem onClick={() => onEdit(profile)}>
                    <PencilSquareIcon />
                    <DropdownLabel>{t("accounts.picker.edit")}</DropdownLabel>
                  </DropdownItem>
                  <DropdownItem onClick={() => onDelete(profile)}>
                    <TrashIcon />
                    <DropdownLabel>{t("accounts.picker.delete")}</DropdownLabel>
                  </DropdownItem>
                </DropdownMenu>
              </Dropdown>
            </li>
          );
        })}
      </ul>

      <CheckboxField>
        <Checkbox
          color="indigo"
          checked={rememberMe}
          onChange={(checked: boolean) => onRememberMeChange(!!checked)}
        />
        <Label>{t("accounts.picker.rememberMe")}</Label>
      </CheckboxField>

      <Button color="indigo" onClick={onNewProfile}>
        <PlusIcon />
        {t("accounts.picker.newProfile")}
      </Button>
    </div>
  );
}
