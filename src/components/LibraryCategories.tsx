import { createUuid } from "@/utils/uuid";
import { useEffect, useState } from "react";
import { Button } from "./tailwind/button";
import { Input } from "./tailwind/input";
import {
  LibraryCategory,
  readLibraryCategories,
} from "@/utils/libraryCategories";

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
  const [categories, setCategories] = useState(() =>
    readLibraryCategories(storageKey),
  );
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setCategories(readLibraryCategories(storageKey));
    setSelected("");
  }, [storageKey]);
  const save = (next: LibraryCategory[]) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setCategories(next);
      setError("");
    } catch {
      setError("Couldn't save categories. Check browser storage permissions.");
    }
  };
  return (
    <div className="mb-4 space-y-2 rounded-2xl bg-ps-panel-soft p-3 text-left">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-40 flex-1 text-sm text-ps-muted">
          Category
          <select
            aria-label="Library category"
            value={selected}
            className="mt-1 block min-h-11 w-full rounded-lg bg-ps-panel px-3 text-ps-text"
            onChange={(event) => {
              setSelected(event.target.value);
              onSelect(
                categories.find(
                  (category) => category.id === event.target.value,
                ) || null,
              );
            }}
          >
            <option value="">All games</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-52 flex-1 text-sm text-ps-muted">
          Library folder
          <Input
            aria-label="Library folder"
            value={folder}
            onChange={(event) => {
              onFolderChange(event.target.value);
              setSelected("");
            }}
            placeholder="Server folder, e.g. /games/RPG"
          />
        </label>
        <label className="min-w-40 flex-1 text-sm text-ps-muted">
          Save current tags and folder as
          <Input
            aria-label="Category name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Category name"
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
          Save category
        </Button>
        {selected && (
          <Button
            outline
            onClick={() => {
              save(categories.filter((category) => category.id !== selected));
              setSelected("");
              onSelect(null);
            }}
          >
            Delete category
          </Button>
        )}
      </div>
      <p className="text-xs text-ps-muted">
        Categories are saved for this account on this device. Choose tags in
        Filters; new matching games appear automatically.
      </p>
      {error && (
        <p role="alert" className="text-sm text-ps-danger">
          {error}
        </p>
      )}
    </div>
  );
}
