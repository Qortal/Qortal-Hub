/**
 * Safe Console Wrapper
 * 
 * Prevents EIO (Input/Output) errors when running from AppImage or other
 * environments where stdout/stderr may be closed or unavailable.
 * 
 * This is particularly important for AppImage builds where the app is mounted
 * in a temporary location and console streams may not be writable.
 */

class SafeConsole {
  private safeWrite(stream: NodeJS.WriteStream, args: any[]): void {
    try {
      if (stream && stream.writable) {
        const message = args.map(arg => {
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg, null, 2);
            } catch {
              return String(arg);
            }
          }
          return String(arg);
        }).join(' ');
        
        stream.write(message + '\n');
      }
    } catch (e) {
      // Silently ignore write errors - prevents crashes from EIO errors
    }
  }

  log(...args: any[]): void {
    this.safeWrite(process.stdout, args);
  }

  error(...args: any[]): void {
    this.safeWrite(process.stderr, args);
  }

  warn(...args: any[]): void {
    this.safeWrite(process.stderr, args);
  }

  info(...args: any[]): void {
    this.safeWrite(process.stdout, args);
  }

  debug(...args: any[]): void {
    this.safeWrite(process.stdout, args);
  }

  trace(...args: any[]): void {
    this.safeWrite(process.stdout, args);
  }
}

// Create singleton instance
const safeConsoleInstance = new SafeConsole();

// Export a console-compatible object
export const safeConsole = {
  log: (...args: any[]) => safeConsoleInstance.log(...args),
  error: (...args: any[]) => safeConsoleInstance.error(...args),
  warn: (...args: any[]) => safeConsoleInstance.warn(...args),
  info: (...args: any[]) => safeConsoleInstance.info(...args),
  debug: (...args: any[]) => safeConsoleInstance.debug(...args),
  trace: (...args: any[]) => safeConsoleInstance.trace(...args),
};

// Function to replace global console
export function replaceGlobalConsole(): void {
  console.log = safeConsole.log;
  console.error = safeConsole.error;
  console.warn = safeConsole.warn;
  console.info = safeConsole.info;
  console.debug = safeConsole.debug;
  console.trace = safeConsole.trace;
}

export default safeConsole;

