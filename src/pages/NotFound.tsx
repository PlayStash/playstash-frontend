import { Button } from "@tw/button";
import { useSound } from "@/hooks/useSound";
import { useTranslation } from "@/i18n";

export default function NotFound() {
  const { isPlaying, toggle } = useSound("wellerman");
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center h-dvh w-dvw">
      <img
        src="/ships.png"
        alt={t("shell.notFound.backgroundAlt")}
        className={`absolute inset-0 w-full h-full object-cover ${
          isPlaying
            ? "opacity-100 transition-opacity duration-10000"
            : "opacity-0"
        }`}
      />
      <div className="relative z-10 flex flex-col items-center text-center px-4">
        <button
          type="button"
          onClick={toggle}
          aria-label={t("shell.notFound.playTune")}
          className={`mb-4 h-40 cursor-pointer motion-reduce:animate-none ${
            isPlaying ? "animate-[spin_7s_linear_infinite]" : ""
          }`}
        >
          <img
            src="/crackpipe.png"
            alt={t("shell.notFound.signAlt")}
            width={160}
            height={160}
          />
        </button>
        <h1 className="text-xl">{t("shell.notFound.title")}</h1>
        <h2 className="text-2xl sm:text-4xl mb-4 font-bold text-balance">
          {t("shell.notFound.quote")}
        </h2>
        <Button href="/">{t("shell.notFound.home")}</Button>
      </div>
    </div>
  );
}
