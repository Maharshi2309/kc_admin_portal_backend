import { env, type LogLevel } from '@/config/env';

/**
 * Structured JSON logs on stdout/stderr, one object per line, so any host
 * (container, VM, serverless) can collect them without an agent.
 *
 * Never pass passwords, tokens, request bodies or other secrets as fields.
 */

const severity: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds [fields] to every entry (e.g. a request id). */
  child(fields: LogFields): Logger;
}

type Sink = (level: LogLevel, line: string) => void;

const consoleSink: Sink = (level, line) => {
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
};

export function createLogger(
  options: { level: LogLevel; base?: LogFields; sink?: Sink } = { level: env().LOG_LEVEL },
): Logger {
  const { level: minLevel, base = {}, sink = consoleSink } = options;

  const write = (level: LogLevel, message: string, fields?: LogFields) => {
    if (severity[level] < severity[minLevel]) return;
    const entry = {
      time: new Date().toISOString(),
      level,
      message,
      ...base,
      ...(fields ? serializeErrors(fields) : {}),
    };
    sink(level, JSON.stringify(entry));
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (fields) => createLogger({ level: minLevel, base: { ...base, ...fields }, sink }),
  };
}

/** `Error` objects don't serialise to JSON; keep name, message and stack. */
function serializeErrors(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] =
      value instanceof Error
        ? { name: value.name, message: value.message, stack: value.stack }
        : value;
  }
  return out;
}

let shared: Logger | undefined;

/** The application logger, created on first use from the configured level. */
export function logger(): Logger {
  shared ??= createLogger({ level: env().LOG_LEVEL });
  return shared;
}
