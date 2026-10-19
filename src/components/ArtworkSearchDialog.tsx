import { useState } from "react";
import clsx from "clsx";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/tailwind/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from "@/components/tailwind/dialog";
import { Input } from "@/components/tailwind/input";
import { useTranslation } from "@/i18n";
import {
  ARTWORK_PROVIDER_NAME_MAX,
  ARTWORK_PROVIDER_URL_MAX,
  buildArtworkSearchUrl,
  isSafeSearchUrl,
  loadArtworkProviders,
  saveArtworkProviders,
  validateArtworkProvider,
  type ArtworkProvider,
} from "@/utils/artworkProviders";
import { openExternalUrl } from "@/utils/tauri";

/** "Artwork Search Providers" dialog (Game Settings › Images › Box Art). */
export function ArtworkSearchDialog({
  open,
  onClose,
  title,
}: {
  open: boolean;
  onClose: () => void;
  /** Game title used for `$GAME`. */
  title: string;
}) {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<ArtworkProvider[]>([]);
  const [selected, setSelected] = useState(0);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [wasOpen, setWasOpen] = useState(false);

  // Reload the saved providers each time the dialog opens.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setProviders(loadArtworkProviders());
      setSelected(0);
      setStatus("");
    }
  }

  const update = (next: ArtworkProvider[]) => {
    saveArtworkProviders(next);
    setProviders(next);
    setSelected(0);
  };

  const add = () => {
    const result = validateArtworkProvider(name, url, title);
    if ("error" in result) {
      setStatus(t(result.error));
      return;
    }
    update([...providers, result.provider]);
    setName("");
    setUrl("");
    setStatus(t("artwork.added"));
  };

  const remove = () => {
    if (!providers[selected]) return;
    update(providers.filter((_, index) => index !== selected));
  };

  const search = async () => {
    const provider = providers[selected];
    if (!provider) return;
    const target = buildArtworkSearchUrl(provider.url, title);
    if (!provider.url.includes("$GAME") || !isSafeSearchUrl(target)) {
      setStatus(t("artwork.error.url"));
      return;
    }
    try {
      await openExternalUrl(target);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="2xl">
      <DialogTitle>{t("artwork.title")}</DialogTitle>
      <DialogDescription>{t("artwork.description")}</DialogDescription>
      <DialogBody className="space-y-4">
        <ul
          role="listbox"
          aria-label={t("artwork.title")}
          className="max-h-56 overflow-y-auto rounded-2xl border border-ps-line bg-ps-panel-soft p-1"
        >
          {providers.length === 0 && (
            <li className="px-3 py-2 text-sm text-ps-muted">
              {t("artwork.empty")}
            </li>
          )}
          {providers.map((provider, index) => (
            <li key={`${provider.name}-${index}`}>
              <button
                type="button"
                role="option"
                aria-selected={index === selected}
                onClick={() => setSelected(index)}
                onDoubleClick={() => void search()}
                title={provider.url}
                className={clsx(
                  "w-full truncate rounded-xl px-3 py-2 text-left text-sm",
                  index === selected
                    ? "bg-ps-accent text-ps-on-accent"
                    : "text-ps-text hover:bg-ps-panel",
                )}
              >
                {provider.name}
              </button>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <Input
            aria-label={t("artwork.name")}
            placeholder={t("artwork.name")}
            maxLength={ARTWORK_PROVIDER_NAME_MAX}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            aria-label={t("artwork.url")}
            placeholder={t("artwork.url")}
            maxLength={ARTWORK_PROVIDER_URL_MAX}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") add();
            }}
          />
          <Button outline onClick={add}>
            {t("artwork.add")}
          </Button>
        </div>
        {status && (
          <p role="status" className="text-sm text-ps-muted">
            {status}
          </p>
        )}
      </DialogBody>
      <DialogActions>
        <Button plain onClick={onClose}>
          {t("artwork.close")}
        </Button>
        <Button outline disabled={!providers[selected]} onClick={remove}>
          {t("artwork.remove")}
        </Button>
        <Button
          color="indigo"
          disabled={!providers[selected]}
          onClick={() => void search()}
        >
          {t("artwork.search")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Box Art panel button that opens the {@link ArtworkSearchDialog}. */
export function ArtworkSearchButton({ title }: { title: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        outline
        onClick={() => setOpen(true)}
        className="w-full"
      >
        <MagnifyingGlassIcon className="h-4 w-4" />
        {t("artwork.title")}
      </Button>
      <ArtworkSearchDialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
      />
    </>
  );
}
