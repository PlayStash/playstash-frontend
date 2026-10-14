import { useState, type FormEvent } from "react";
import { Button } from "@tw/button";
import { Description, Field, Label } from "@tw/fieldset";
import { Heading } from "@tw/heading";
import { Input } from "@tw/input";
import { Text } from "@tw/text";
import { useTranslation } from "@/i18n";
import type { Profile } from "@/utils/profiles";

/**
 * Edit a profile's server URL and username. Passwords are not stored, so a
 * password change simply happens at the next login.
 */
export function ProfileEditor({
  profile,
  onSave,
  onCancel,
}: {
  profile: Profile;
  onSave: (changes: { serverUrl: string; username: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [serverUrl, setServerUrl] = useState(profile.serverUrl);
  const [username, setUsername] = useState(profile.username);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({ serverUrl, username });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid w-full max-w-sm grid-cols-1 gap-6">
      <div className="space-y-2">
        <Heading>{t("accounts.editor.title")}</Heading>
        <Text>{t("accounts.editor.description")}</Text>
      </div>
      <Field>
        <Label>{t("accounts.form.server")}</Label>
        <Input
          name="server"
          value={serverUrl}
          onChange={(event) => setServerUrl(event.target.value)}
          autoComplete="url"
          required
        />
        <Description>{t("accounts.editor.serverHint")}</Description>
      </Field>
      {!profile.sso && (
        <Field>
          <Label>{t("accounts.form.username")}</Label>
          <Input
            name="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </Field>
      )}
      {error && (
        <div
          className="rounded-2xl bg-rose-500/10 px-3 py-2 text-sm text-rose-500"
          role="alert"
        >
          {error}
        </div>
      )}
      <div className="flex gap-3">
        <Button type="button" outline onClick={onCancel} className="flex-1">
          {t("accounts.common.back")}
        </Button>
        <Button
          type="submit"
          color="indigo"
          disabled={saving}
          className="flex-1"
        >
          {t("accounts.common.save")}
        </Button>
      </div>
    </form>
  );
}
