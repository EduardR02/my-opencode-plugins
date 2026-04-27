import { execFile } from "node:child_process";
import { platform } from "node:os";

const TAG = "[sfx]";

/**
 * Play a sound file. Fire-and-forget, non-blocking.
 * All errors are caught and logged — the caller never receives a rejection.
 *
 * Cross-platform support:
 * - macOS:   afplay
 * - Linux:   paplay (PulseAudio), aplay (ALSA), fallback to terminal bell
 * - Windows: powershell + Media.SoundPlayer, fallback to terminal bell
 */
export function playSound(filePath: string): void {
  const os = platform();

  try {
    if (os === "darwin") {
      execFile("afplay", [filePath], (err) => {
        if (err) {
          console.error(`${TAG} afplay failed for "${filePath}":`, err.message);
        }
      });
    } else if (os === "linux") {
      // Try PulseAudio first, then ALSA, then terminal bell
      tryPlayLinux(filePath);
    } else if (os === "win32") {
      tryPlayWindows(filePath);
    } else {
      console.error(`${TAG} unsupported platform: ${os}`);
    }
  } catch (err: any) {
    console.error(
      `${TAG} error spawning sound player for "${filePath}":`,
      err?.message ?? err,
    );
  }
}

function tryPlayLinux(filePath: string): void {
  // Try PulseAudio first
  execFile("paplay", [filePath], (paErr) => {
    if (paErr) {
      // Fall back to ALSA
      execFile("aplay", [filePath], (alsaErr) => {
        if (alsaErr) {
          // Final fallback: terminal bell
          console.error(
            `${TAG} neither paplay nor aplay available for "${filePath}" — falling back to terminal bell`,
          );
          process.stderr.write("\x07");
        }
      });
    }
  });
}

function tryPlayWindows(filePath: string): void {
  // Try PowerShell + Media.SoundPlayer
  const psCommand = `(New-Object Media.SoundPlayer '${filePath}').PlaySync()`;
  execFile(
    "powershell",
    ["-c", psCommand],
    (psErr) => {
      if (psErr) {
        // Fallback: terminal bell
        console.error(
          `${TAG} powershell sound player failed for "${filePath}" — falling back to terminal bell`,
        );
        process.stderr.write("\x07");
      }
    },
  );
}
