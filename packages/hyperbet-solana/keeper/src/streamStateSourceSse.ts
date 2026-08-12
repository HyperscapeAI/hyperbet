export interface ParsedStreamStateSourceEvent {
  event: string;
  id: number | null;
  data: string;
}

export interface ExtractedStreamStateSourceEvents {
  events: ParsedStreamStateSourceEvent[];
  remainder: string;
}

export function resolveStreamStateEventsUrl(
  sourceStateUrl: string,
  lastEventId: number | null,
): URL {
  const url = new URL(sourceStateUrl);
  url.pathname = "/api/streaming/state/events";
  url.search = "";
  url.hash = "";
  if (Number.isSafeInteger(lastEventId) && (lastEventId ?? 0) > 0) {
    url.searchParams.set("since", String(lastEventId));
  }
  return url;
}

function parseEventFrame(frame: string): ParsedStreamStateSourceEvent | null {
  let event = "message";
  let id: number | null = null;
  const data: string[] = [];

  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator >= 0 ? line.slice(0, separator) : line;
    let value = separator >= 0 ? line.slice(separator + 1) : "";
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event" && value) {
      event = value;
    } else if (field === "id") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isSafeInteger(parsed) && parsed >= 0) id = parsed;
    } else if (field === "data") {
      data.push(value);
    }
  }

  if (data.length === 0) return null;
  return { event, id, data: data.join("\n") };
}

export function extractStreamStateSourceEvents(
  input: string,
): ExtractedStreamStateSourceEvents {
  const events: ParsedStreamStateSourceEvent[] = [];
  let cursor = 0;
  const boundary = /\r?\n\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(input)) !== null) {
    const frame = input.slice(cursor, match.index);
    const parsed = parseEventFrame(frame);
    if (parsed) events.push(parsed);
    cursor = match.index + match[0].length;
  }
  return { events, remainder: input.slice(cursor) };
}
