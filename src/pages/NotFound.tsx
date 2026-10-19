import { Button } from "@tw/button";
import { useSound } from "@/hooks/useSound";
import { useTranslation } from "@/i18n";
import { Logo } from "@/components/Logo";
import "@/styles/workspaces.css";

export default function NotFound() {
  const { isPlaying, toggle } = useSound("wellerman");
  const { t } = useTranslation();

  return (
    <div className="not-found-workspace min-h-dvh">
      <img
        src="/ships.png"
        alt={t("shell.notFound.backgroundAlt")}
        className={`absolute inset-0 w-full h-full object-cover ${
          isPlaying
            ? "opacity-25 transition-opacity duration-1000 motion-reduce:transition-none"
            : "opacity-0"
        }`}
      />
      <div className="not-found-content">
        <Logo variant="brand" height="h-8" wrapperClassName="mb-8 w-48" />
        <p className="not-found-code">404</p>
        <button
          type="button"
          onClick={toggle}
          aria-label={t("shell.notFound.playTune")}
          className={`h-14 cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ps-accent motion-reduce:animate-none ${
            isPlaying ? "animate-[spin_7s_linear_infinite]" : ""
          }`}
        >
          <img
            src="/crackpipe.png"
            alt={t("shell.notFound.signAlt")}
            width={56}
            height={56}
          />
        </button>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("shell.notFound.title")}
        </h1>
        <h2 className="mb-4 max-w-lg text-sm leading-7 text-ps-muted text-balance">
          {t("shell.notFound.quote")}
        </h2>
        <Button href="/">{t("shell.notFound.home")}</Button>
      </div>
    </div>
  );
}
