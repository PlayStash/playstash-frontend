import { useEffect, useState } from "react";
import { Button } from "./tailwind/button";
import { Input } from "./tailwind/input";
import { translate, useTranslation } from "@/i18n";

export function PostInstallSettings() {
  const { t } = useTranslation();
  const [script, setScript] = useState("");
  const [argumentsJson, setArgumentsJson] = useState('["%F"]');
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let cancelled = false;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke<{ script: string | null; arguments: string[] }>(
          "get_post_install_config",
        ),
      )
      .then((config) => {
        if (cancelled) return;
        setScript(config.script || "");
        setArgumentsJson(
          JSON.stringify(config.arguments.length ? config.arguments : ["%F"]),
        );
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setMessage(translate("game.postInstall.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div
      id="setting-downloads-post-install"
      className="space-y-3 px-4 py-3 text-left"
    >
      <p className="text-sm font-medium text-ps-text">
        {t("game.postInstall.title")}
      </p>
      <p className="text-xs text-ps-muted">
        {t("game.postInstall.description")}
      </p>
      <label className="block text-sm text-ps-muted">
        {t("game.postInstall.path")}
        <Input
          aria-label={t("game.postInstall.pathLabel")}
          value={script}
          onChange={(event) => setScript(event.target.value)}
          placeholder="/media/cleanup.sh"
        />
      </label>
      <label className="block text-sm text-ps-muted">
        {t("game.postInstall.arguments")}
        <Input
          aria-label={t("game.postInstall.argumentsLabel")}
          value={argumentsJson}
          onChange={(event) => setArgumentsJson(event.target.value)}
        />
      </label>
      <p className="text-xs text-ps-muted">{t("game.postInstall.hint")}</p>
      <Button
        outline
        disabled={!loaded}
        onClick={async () => {
          try {
            const args: unknown = JSON.parse(argumentsJson);
            if (
              !Array.isArray(args) ||
              args.some((argument) => typeof argument !== "string")
            )
              throw new Error(t("game.postInstall.argumentsInvalid"));
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("set_post_install_config", {
              config: { script: script.trim() || null, arguments: args },
            });
            setMessage(
              script.trim()
                ? t("game.postInstall.enabled")
                : t("game.postInstall.disabled"),
            );
          } catch (error) {
            setMessage(String(error));
          }
        }}
      >
        {t("game.postInstall.save")}
      </Button>
      {message && (
        <p role="status" className="text-sm text-ps-muted">
          {message}
        </p>
      )}
    </div>
  );
}
