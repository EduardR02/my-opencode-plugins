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
 * - Windows: powershell + Media.SoundPlayer (.wav), fallback to terminal bell
 */
export function playSound(filePath: string): void {
  const os = platform();

  // Windows SoundPlayer only handles .wav, so use the wav variant when available.
  if (os === "win32" && filePath.endsWith(".mp3")) {
    filePath = filePath.replace(/\.mp3$/, ".wav");
  }

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
  const psCommand = `(New-Object Media.SoundPlayer '${filePath.replace(/'/g, "''")}').PlaySync()`;

  execFile(
    "powershell",
    ["-NoProfile", "-Command", psCommand],
    (psErr) => {
      if (psErr) {
        console.error(
          `${TAG} powershell sound player failed for "${filePath}" — falling back to terminal bell`,
        );
        process.stderr.write("\x07");
      }
    },
  );
}
