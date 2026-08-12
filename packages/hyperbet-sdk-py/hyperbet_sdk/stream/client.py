import asyncio
import json
from collections.abc import Callable

import websockets


class HyperbetStreamClient:
    def __init__(self, url: str):
        self.url = url
        self.callbacks: list[Callable[[dict], None]] = []
        self._ws: websockets.WebSocketClientProtocol | None = None
        self._task: asyncio.Task | None = None

    def subscribe(self, cb: Callable[[dict], None]):
        self.callbacks.append(cb)

    async def connect(self):
        self._ws = await websockets.connect(self.url)
        self._task = asyncio.create_task(self._listen())

    async def _listen(self):
        if not self._ws:
            return

        try:
            async for message in self._ws:
                try:
                    data = json.loads(message)
                    for cb in self.callbacks:
                        cb(data)
                except json.JSONDecodeError:
                    print("HyperbetStreamClient parse error: invalid JSON")
                except Exception as e:
                    print(f"HyperbetStreamClient callback error: {e}")
        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            print(f"HyperbetStreamClient ws error: {e}")

    async def disconnect(self):
        if self._task:
            self._task.cancel()
        if self._ws:
            await self._ws.close()
            self._ws = None
