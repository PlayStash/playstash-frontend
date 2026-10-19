export const ROM_PLACEHOLDER = "$ROM";

/** Emulator arguments with `$ROM` replaced by the quoted absolute ROM path. */
export function buildEmulatorParameters(
  argumentsTemplate: string,
  romPath: string,
): string {
  return argumentsTemplate.split(ROM_PLACEHOLDER).join(`"${romPath}"`);
}
