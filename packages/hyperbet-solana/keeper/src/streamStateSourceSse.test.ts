import { describe, expect, it } from "bun:test";

import {
  extractStreamStateSourceEvents,
  resolveStreamStateEventsUrl,
} from "./streamStateSourceSse";

describe("stream state source SSE", () => {
  it("derives only the canonical events path and bounded replay cursor", () => {
    expect(
      resolveStreamStateEventsUrl(
        "https://game.example/api/streaming/state",
        42,
      ).toString(),
    ).toBe("https://game.example/api/streaming/state/events?since=42");
    expect(
      resolveStreamStateEventsUrl(
        "http://127.0.0.1:5555/api/streaming/state",
        null,
      ).toString(),
    ).toBe("http://127.0.0.1:5555/api/streaming/state/events");
  });

  it("extracts sequenced state/reset frames across LF and CRLF boundaries", () => {
    const parsed = extractStreamStateSourceEvents(
      ": heartbeat\n\n" +
        'id: 7\nevent: state\ndata: {"cycle":\ndata: {"phase":"FIGHTING"}}\n\n' +
        'id: 8\r\nevent: reset\r\ndata: {"cycle":{}}\r\n\r\npartial',
    );

    expect(parsed.events).toEqual([
      {
        event: "state",
        id: 7,
        data: '{"cycle":\n{"phase":"FIGHTING"}}',
      },
      { event: "reset", id: 8, data: '{"cycle":{}}' },
    ]);
    expect(parsed.remainder).toBe("partial");
  });

  it("ignores comments and data-free control frames", () => {
    expect(
      extractStreamStateSourceEvents(
        "retry: 2000\n\n: keepalive\n\nevent: state\ndata: {}\n\n",
      ),
    ).toEqual({
      events: [{ event: "state", id: null, data: "{}" }],
      remainder: "",
    });
  });
});
