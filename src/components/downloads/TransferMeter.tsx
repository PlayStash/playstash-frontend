import "@/styles/downloads.css";
import clsx from "clsx";

type TransferMeterProps = {
  /** Current progress, 0–100. Null/undefined renders an empty, indeterminate track. */
  value: number | null | undefined;
  /** Left-side caption, e.g. "Extraction". */
  label?: string;
  /** Right-side value, e.g. "45.2%". Rendered with tabular numerals. */
  valueText?: string;
  /** Current file path rendered below the bar; its file name stays visible. */
  currentFile?: string;
  /** Plain detail line (e.g. transferred bytes) when there is no file. */
  detail?: string;
  /** A paused transfer keeps its fill but drops the accent. */
  paused?: boolean;
  className?: string;
};

/**
 * A file path that keeps its file name visible: only the folder part is
 * truncated, because paths of one archive differ at the end, not the start.
 */
function CurrentFile({ path }: Readonly<{ path: string }>) {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
  const folder = path.slice(0, cut);
  const name = path.slice(cut);
  return (
    <p className="transfer-meter-file" title={path}>
      {folder && <span className="transfer-meter-folder">{folder}</span>}
      <span className="transfer-meter-name">{name || path}</span>
    </p>
  );
}

/**
 * Progress of one download, extraction or copy step.
 *
 * The fill is scaled with `transform: scaleX()` and a linear transition that
 * matches the download context's 500 ms UI throttle, so the bar glides at a
 * constant rate between ticks instead of stepping (and never triggers layout).
 */
export function TransferMeter({
  value,
  label,
  valueText,
  currentFile,
  detail,
  paused = false,
  className,
}: Readonly<TransferMeterProps>) {
  const determinate = typeof value === "number" && Number.isFinite(value);
  const percent = determinate ? Math.min(100, Math.max(0, value)) : 0;

  return (
    <div
      className={clsx("transfer-meter", className)}
      data-paused={paused || undefined}
    >
      {(label || valueText) && (
        <div className="transfer-meter-caption">
          <span className="truncate">{label}</span>
          {valueText && (
            <span className="transfer-meter-value">{valueText}</span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? Math.round(percent) : undefined}
        aria-valuetext={valueText}
        className="transfer-meter-track"
      >
        <span
          className="transfer-meter-fill"
          style={{ transform: `scaleX(${percent / 100})` }}
        />
      </div>
      {currentFile ? (
        <CurrentFile path={currentFile} />
      ) : (
        detail && (
          <p className="transfer-meter-file" title={detail}>
            <span className="transfer-meter-folder">{detail}</span>
          </p>
        )
      )}
    </div>
  );
}
