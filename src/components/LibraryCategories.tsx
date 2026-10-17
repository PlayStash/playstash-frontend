import { createUuid } from "@/utils/uuid";
import { useEffect, useState } from "react";
import { Button } from "./tailwind/button";
import { Input } from "./tailwind/input";
import {
  LibraryCategory,
  readLibraryCategories,
} from "@/utils/libraryCategories";
import { useTranslation } from "@/i18n";
import { AdjustmentsHorizontalIcon } from "@heroicons/react/24/outline";

export function LibraryCategories({
  storageKey,
  tags,
  folder,
  onFolderChange,
  onSelect,
}: {
  storageKey: string;
  tags: string[];
  folder: string;
  onFolderChange: (folder: string) => void;
  onSelect: (category: LibraryCategory | null) => void;
}) {
  const { t } = useTranslation();
  const [categories, setCategories] = useState(() =>
    readLibraryCategories(storageKey),
  );
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setCategories(readLibraryCategories(storageKey));
    setSelected("");
  }, [storageKey]);
  useEffect(() => {
    const category = categories.find((item) => item.id === selected);
    if (
      category &&
      (category.folder !== folder ||
        [...category.tags].sort().join("\u0000") !==
          [...tags].sort().join("\u0000"))
    ) {
      setSelected("");
    }
  }, [categories, selected, folder, tags]);
  const save = (next: LibraryCategory[]) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setCategories(next);
      setError(false);
    } catch {
      setError(true);
    }
  };
  return (
    <div className="ps-library-categories">
      <div
        className="ps-library-category-tabs"
        aria-label={t("library.categories.select")}
      >
        <button
          type="button"
          aria-pressed={!selected}
          onClick={() => {
            setSelected("");
            onSelect(null);
          }}
        >
          {t("library.categories.allGames")}
        </button>
        {categories.map((category) => (
          <button
            type="button"
            key={category.id}
            aria-pressed={selected === category.id}
            onClick={() => {
              setSelected(category.id);
              onSelect(category);
            }}
          >
            {category.name}
          </button>
        ))}
        <button
          type="button"
          className="ps-library-categories-manage"
          aria-expanded={editing}
          onClick={() => setEditing((open) => !open)}
        >
          <AdjustmentsHorizontalIcon aria-hidden="true" />
          {t("library.categories.manage")}
        </button>
      </div>
      {editing && (
        <div className="ps-library-category-editor space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-40 flex-1 text-sm text-ps-muted">
              {t("library.categories.category")}
              <select
                aria-label={t("library.categories.select")}
                value={selected}
                className="mt-1 block min-h-11 w-full bg-ps-panel px-3 text-ps-text"
                onChange={(event) => {
                  setSelected(event.target.value);
                  onSelect(
                    categories.find(
                      (category) => category.id === event.target.value,
                    ) || null,
                  );
                }}
              >
                <option value="">{t("library.categories.allGames")}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-52 flex-1 text-sm text-ps-muted">
              {t("library.categories.folder")}
              <Input
                aria-label={t("library.categories.folder")}
                value={folder}
                onChange={(event) => {
                  onFolderChange(event.target.value);
                  setSelected("");
                }}
                placeholder={t("library.categories.folderPlaceholder")}
              />
            </label>
            <label className="min-w-40 flex-1 text-sm text-ps-muted">
              {t("library.categories.saveAs")}
              <Input
                aria-label={t("library.categories.name")}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("library.categories.name")}
              />
            </label>
            <Button
              outline
              disabled={!name.trim() || (!tags.length && !folder.trim())}
              onClick={() => {
                const id = createUuid();
                save([
                  ...categories,
                  { id, name: name.trim(), tags, folder: folder.trim() },
                ]);
                setName("");
                setSelected(id);
              }}
            >
              {t("library.categories.save")}
            </Button>
            {selected && (
              <Button
                outline
                onClick={() => {
                  save(
                    categories.filter((category) => category.id !== selected),
                  );
                  setSelected("");
                  onSelect(null);
                }}
              >
                {t("library.categories.delete")}
              </Button>
            )}
          </div>
          <p className="text-xs text-ps-muted">
            {t("library.categories.hint")}
          </p>
          {error && (
            <p role="alert" className="text-sm text-ps-danger">
              {t("library.categories.saveFailed")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
