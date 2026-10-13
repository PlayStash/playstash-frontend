import { useEffect, useState } from "react";
import { Button } from "./tailwind/button";
import { Input } from "./tailwind/input";

export function PostInstallSettings() {
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
        if (!cancelled) setMessage("Couldn't load post-install settings.");
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
      <p className="text-sm font-medium text-ps-text">Post-install script</p>
      <p className="text-xs text-ps-muted">
        Optional script on this computer, run once after each successful
        installation. Leave the path empty to disable. Scripts run with your
        account permissions.
      </p>
      <label className="block text-sm text-ps-muted">
        Absolute script or executable path
        <Input
          aria-label="Post-install script path"
          value={script}
          onChange={(event) => setScript(event.target.value)}
          placeholder="/media/cleanup.sh"
        />
      </label>
      <label className="block text-sm text-ps-muted">
        Arguments (JSON array)
        <Input
          aria-label="Post-install script arguments"
          value={argumentsJson}
          onChange={(event) => setArgumentsJson(event.target.value)}
        />
      </label>
      <p className="text-xs text-ps-muted">
        %F is replaced with the installation folder as one literal argument.
        Executables, .sh and .ps1 scripts are supported.
      </p>
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
              throw new Error("Arguments must be a JSON array of strings.");
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("set_post_install_config", {
              config: { script: script.trim() || null, arguments: args },
            });
            setMessage(
              script.trim()
                ? "Post-install script enabled."
                : "Post-install script disabled.",
            );
          } catch (error) {
            setMessage(String(error));
          }
        }}
      >
        Save post-install settings
      </Button>
      {message && (
        <p role="status" className="text-sm text-ps-muted">
          {message}
        </p>
      )}
    </div>
  );
}
