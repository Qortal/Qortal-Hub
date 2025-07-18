// wallet-storage.ts
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

const filePath = path.join(app.getPath('userData'), 'wallet-storage.json');

function readData(): Record<string, any> {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeData(data: Record<string, any>) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function getValue<T = any>(key: string): T | undefined {
  const data = readData();
  return data[key];
}

export function setValue(key: string, value: any): void {
  const data = readData();
  data[key] = value;
  writeData(data);
}

export function deleteValue(key: string): void {
  const data = readData();
  delete data[key];
  writeData(data);
}
