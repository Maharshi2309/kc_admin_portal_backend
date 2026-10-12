import type { z } from 'zod';
import '@/lib/validation'; // installs the plain-English default messages
import { BadRequestError, PayloadTooLargeError, fromZodError } from '@/lib/errors';

/** The largest JSON body accepted. The app's biggest request is a few KB. */
export const MAX_JSON_BODY_BYTES = 100 * 1024;

/**
 * Reads and validates a JSON body. Throws 413 if it's too large, 400 if it
 * isn't JSON, 422 with field errors if it doesn't match [schema].
 */
export async function readJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.output<S>> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_JSON_BODY_BYTES) throw new PayloadTooLargeError();

  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_JSON_BODY_BYTES) throw new PayloadTooLargeError();

  let body: unknown;
  try {
    body = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new BadRequestError('The request body is not valid JSON.');
  }
  return parseWith(schema, body);
}

/**
 * Validates query parameters. Repeated keys keep their last value; schemas
 * receive strings and coerce them (e.g. `page`).
 */
export function readQuery<S extends z.ZodType>(request: Request, schema: S): z.output<S> {
  const query = Object.fromEntries(new URL(request.url).searchParams.entries());
  return parseWith(schema, query);
}

function parseWith<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw fromZodError(result.error);
  return result.data;
}
