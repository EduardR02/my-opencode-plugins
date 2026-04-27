import { execFile } from "node:child_process";
import { platform, tmpdir } from "node:os";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

const TAG = "[sfx]";

/**
 * Play a sound file. Fire-and-forget, non-blocking.
 * All errors are caught and logged — the caller never receives a rejection.
 *
 * Cross-platform support:
 * - macOS:   afplay (with optional -v volume)
 * - Linux:   paplay (PulseAudio, with optional --volume)
 * - Windows: powershell + System.Media.SoundPlayer (.wav, volume via WAV sample adjustment)
 */
export function playSound(filePath: string, volume: number): void {
  const os = platform();

  // Windows SoundPlayer only handles .wav — swap to .wav variant when available.
  if (os === "win32" && filePath.toLowerCase().endsWith(".mp3")) {
    const wavPath = filePath.replace(/\.mp3$/i, ".wav");
    if (!existsSync(wavPath)) {
      console.error(
        `${TAG} .wav fallback not found for "${filePath}" — expected at "${wavPath}"`,
      );
      return;
    }
    filePath = wavPath;
  }

  try {
    if (os === "darwin") {
      tryPlayDarwin(filePath, volume);
    } else if (os === "linux") {
      tryPlayLinux(filePath, volume);
    } else if (os === "win32") {
      tryPlayWindows(filePath, volume);
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

function tryPlayDarwin(filePath: string, volume: number): void {
  const args = volume < 1.0 ? ["-v", String(volume), filePath] : [filePath];
  execFile("afplay", args, (err) => {
    if (err) {
      console.error(`${TAG} afplay failed for "${filePath}":`, err.message);
    }
  });
}

function tryPlayLinux(filePath: string, volume: number): void {
  const args = [filePath];
  if (volume < 1.0) {
    args.unshift(`--volume=${Math.round(volume * 65536)}`);
  }
  execFile("paplay", args, (err) => {
    if (err) {
      console.error(
        `${TAG} paplay failed for "${filePath}":`,
        err.message,
      );
    }
  });
}

function tryPlayWindows(filePath: string, volume: number): void {
  let playPath = filePath;
  let tempPath: string | null = null;

  if (volume < 1.0) {
    try {
      tempPath = adjustWavVolume(filePath, volume);
      playPath = tempPath;
    } catch (err: any) {
      console.error(
        `${TAG} WAV volume adjustment failed for "${filePath}":`,
        err?.message ?? err,
      );
      return;
    }
  }

  const psCommand = `(New-Object System.Media.SoundPlayer '${playPath.replace(/'/g, "''")}').PlaySync()`;

  execFile(
    "powershell",
    ["-NoProfile", "-Command", psCommand],
    (psErr) => {
      if (tempPath) {
        try {
          unlinkSync(tempPath);
        } catch {
          // Best-effort cleanup — ignore errors
        }
      }
      if (psErr) {
        console.error(
          `${TAG} powershell sound player failed for "${playPath}":`,
          psErr.message,
        );
      }
    },
  );
}

/**
 * Adjust the volume of a WAV file by modifying sample amplitudes in-place.
 * Returns the path to a temporary adjusted copy of the file.
 *
 * Supports 8-bit and 16-bit uncompressed PCM WAV files.
 */
function adjustWavVolume(filePath: string, volume: number): string {
  const buf = readFileSync(filePath);

  // Parse RIFF/WAV header
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("Not a valid WAV file (missing RIFF header)");
  }

  let fmtOffset = -1;
  let audioFormat = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;

  let offset = 12; // Skip "RIFF" (4) + fileSize (4) + "WAVE" (4)
  while (offset <= buf.length - 8) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);

    if (chunkId === "fmt ") {
      fmtOffset = offset + 8;
      audioFormat = buf.readUInt16LE(fmtOffset);
      // bitsPerSample is at byte 14 of the fmt chunk data
      bitsPerSample = buf.readUInt16LE(fmtOffset + 14);
    } else if (chunkId === "data") {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  if (fmtOffset === -1) {
    throw new Error("Invalid WAV file: missing fmt chunk");
  }
  if (dataOffset === -1) {
    throw new Error("Invalid WAV file: missing data chunk");
  }
  if (audioFormat !== 1) {
    throw new Error(
      `Unsupported WAV audio format: ${audioFormat} (only PCM=1 is supported)`,
    );
  }

  if (bitsPerSample === 16) {
    // Signed 16-bit little-endian PCM
    for (let i = dataOffset; i < dataOffset + dataSize; i += 2) {
      let sample = buf.readInt16LE(i);
      sample = Math.round(sample * volume);
      if (sample > 32767) sample = 32767;
      if (sample < -32768) sample = -32768;
      buf.writeInt16LE(sample, i);
    }
  } else if (bitsPerSample === 8) {
    // Unsigned 8-bit PCM (0–255, centered at 128)
    for (let i = dataOffset; i < dataOffset + dataSize; i++) {
      let sample = buf[i] - 128;
      sample = Math.round(sample * volume);
      if (sample > 127) sample = 127;
      if (sample < -128) sample = -128;
      buf[i] = sample + 128;
    }
  } else {
    throw new Error(
      `Unsupported bits per sample: ${bitsPerSample} (only 8 and 16 are supported)`,
    );
  }

  const tmpPath = path.join(tmpdir(), `sfx-${randomUUID()}.wav`);
  writeFileSync(tmpPath, buf);
  return tmpPath;
}
