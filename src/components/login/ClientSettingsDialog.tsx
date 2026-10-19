import { useEffect, useState } from "react";
import { PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { Button } from "@tw/button";
import { Checkbox, CheckboxField } from "@tw/checkbox";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from "@tw/dialog";
import { Description, Label } from "@tw/fieldset";
import { Input } from "@tw/input";
import { Text } from "@tw/text";
import { useTranslation } from "@/i18n";
import {
  getAdditionalRequestHeaderList,
  initRequestHeaders,
  isNativeServerRequestsEnabled,
  saveAdditionalRequestHeaders,
  setNativeServerRequestsEnabled,
  type RequestHeader,
} from "@/utils/requestHeaders";

/**
 * "Client Settings": additional request headers sent with every request to
 * the PlayStash server (e.g. Cloudflare Access service tokens). Global for all
 * profiles. Desktop only.
 */
export function ClientSettingsDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after a successful save (e.g. to show a toast). */
  onSaved?: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<RequestHeader[]>([]);
  const [nativeRequests, setNativeRequests] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);

  // Clear the last error whenever the dialog opens again.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setError(null);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void initRequestHeaders().then(() => {
      if (cancelled) return;
      setRows(getAdditionalRequestHeaderList());
      setNativeRequests(isNativeServerRequestsEnabled());
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const update = (index: number, patch: Partial<RequestHeader>) =>
    setRows((current) =>
      current.map((row, position) =>
        position === index ? { ...row, ...patch } : row,
      ),
    );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveAdditionalRequestHeaders(rows);
      setNativeServerRequestsEnabled(nativeRequests);
      setRows(saved);
      onSaved?.(t("accounts.headers.saved"));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="2xl">
      <DialogTitle>{t("accounts.headers.title")}</DialogTitle>
      <DialogDescription>{t("accounts.headers.description")}</DialogDescription>
      <DialogBody className="space-y-3">
        {rows.length === 0 && (
          <Text className="text-sm">{t("accounts.headers.empty")}</Text>
        )}
        {rows.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              aria-label={t("accounts.headers.name")}
              placeholder={t("accounts.headers.name")}
              value={row.name}
              onChange={(event) => update(index, { name: event.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
            <Input
              aria-label={t("accounts.headers.value")}
              placeholder={t("accounts.headers.value")}
              value={row.value}
              onChange={(event) => update(index, { value: event.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              plain
              aria-label={t("accounts.headers.remove")}
              title={t("accounts.headers.remove")}
              onClick={() =>
                setRows((current) =>
                  current.filter((_, position) => position !== index),
                )
              }
            >
              <TrashIcon />
            </Button>
          </div>
        ))}
        <Button
          outline
          onClick={() =>
            setRows((current) => [...current, { name: "", value: "" }])
          }
        >
          <PlusIcon />
          {t("accounts.headers.add")}
        </Button>
        <CheckboxField className="pt-2">
          <Checkbox
            color="indigo"
            checked={nativeRequests}
            onChange={(checked: boolean) => setNativeRequests(!!checked)}
          />
          <Label>{t("accounts.headers.native")}</Label>
          <Description>{t("accounts.headers.nativeDescription")}</Description>
        </CheckboxField>
        {error && (
          <div
            className="rounded-2xl bg-rose-500/10 px-3 py-2 text-sm text-rose-500"
            role="alert"
          >
            {error}
          </div>
        )}
      </DialogBody>
      <DialogActions>
        <Button plain onClick={onClose}>
          {t("accounts.common.cancel")}
        </Button>
        <Button color="indigo" disabled={saving} onClick={() => void save()}>
          {t("accounts.common.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
