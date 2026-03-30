type WebSocketLike = {
  addEventListener(
    event: string,
    listener: (event: any) => void,
  ): void;
  close(): void;
  readyState: number;
};

type WebSocketCtor = new (url: string) => WebSocketLike;

type GlobalWithWebSocket = {
  WebSocket?: WebSocketCtor;
};

export class HyperbetStreamClient {
    private ws: WebSocketLike | null = null;
    public callbacks: Array<(data: any) => void> = [];

    constructor(public url: string) {}

    public connect() {
        if (this.ws) {
            this.disconnect();
        }
        const ctor = (globalThis as unknown as GlobalWithWebSocket).WebSocket;
        if (!ctor) {
            throw new Error("WebSocket is not available in this environment.");
        }

        this.ws = new ctor(this.url);

        this.ws.addEventListener("message", (event: any) => {
            try {
                // Browser MessageEvent wraps payload in .data; Node.js ws may
                // pass the raw buffer directly depending on version.
                const raw =
                    typeof event === "string"
                        ? event
                        : typeof event.data === "string"
                          ? event.data
                          : event.data?.toString?.() ?? String(event);
                const parsed = JSON.parse(raw);
                this.callbacks.forEach(cb => cb(parsed));
            } catch (e) {
                console.error("HyperbetStreamClient parse error:", e);
            }
        });

        this.ws.addEventListener("error", (err: any) => {
            console.error("HyperbetStreamClient ws error:", err);
        });

        this.ws.addEventListener("close", () => {
             // Optional auto-reconnect logic could go here
        });
    }

    public subscribe(cb: (data: any) => void) {
        this.callbacks.push(cb);
    }

    public disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
