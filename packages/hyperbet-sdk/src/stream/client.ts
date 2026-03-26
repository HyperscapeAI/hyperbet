type WebSocketLike = {
  on: (
    event: "message" | "error" | "close",
    listener: (...args: any[]) => void,
  ) => void;
  close: () => void;
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
        const ctor = (globalThis as unknown as GlobalWithWebSocket).WebSocket;
        if (!ctor) {
            throw new Error("WebSocket is not available in this environment.");
        }

        this.ws = new ctor(this.url);
        
        this.ws.on("message", (data) => {
            try {
                const parsed = JSON.parse(data.toString());
                this.callbacks.forEach(cb => cb(parsed));
            } catch (e) {
                console.error("HyperbetStreamClient parse error:", e);
            }
        });

        this.ws.on("error", (err) => {
            console.error("HyperbetStreamClient ws error:", err);
        });

        this.ws.on("close", () => {
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
