export const truncateNumber = (value: string | number, sigDigits: number) => {
  return Number(value).toFixed(sigDigits);
};

export const removeTrailingZeros = (s: string) => {
  return Number(s).toString();
};

export const setNumberWithinBounds = (
  num: number,
  minValue: number,
  maxValue: number
) => {
  if (num > maxValue) return maxValue;
  if (num < minValue) return minValue;
  return num;
};

export const numberToInt = (num: number) => {
  return Math.floor(num);
};

type ByteFormat = "Decimal" | "Binary";
export function formatBytes(
  bytes: number,
  decimals = 2,
  format: ByteFormat = "Binary"
) {
  if (bytes === 0) return "0 Bytes";

  const k = format === "Binary" ? 1024 : 1000;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

export function formatTime(seconds: number): string {
  seconds = Math.floor(seconds);
  const minutes: number | string = Math.floor(seconds / 60);
  let hours: number | string = Math.floor(minutes / 60);

  let remainingSeconds: number | string = seconds % 60;
  let remainingMinutes: number | string = minutes % 60;

  if (remainingSeconds < 10) {
    remainingSeconds = "0" + remainingSeconds;
  }

  if (remainingMinutes < 10) {
    remainingMinutes = "0" + remainingMinutes;
  }

  if (hours === 0) {
    hours = "";
  } else {
    hours = hours + ":";
  }

  return hours + remainingMinutes + ":" + remainingSeconds;
}
