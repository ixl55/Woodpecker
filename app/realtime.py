"""In-memory WebSocket hub for challenges (one process, which is what the free hosting runs).

Also owns the timers a live duel needs: the end-of-clock finaliser and the 30-second
reconnect grace after a player drops.
"""
import asyncio
from collections import defaultdict
from datetime import datetime

from fastapi import WebSocket

from . import challenge_engine as engine
from .db import SessionLocal
from .models import Challenge, utcnow


class Hub:
    def __init__(self) -> None:
        self.rooms: dict[int, dict[WebSocket, int]] = defaultdict(dict)
        self.timers: dict[int, asyncio.Task] = {}
        self.grace: dict[tuple[int, int], asyncio.Task] = {}

    def users_in(self, cid: int) -> set[int]:
        return set(self.rooms.get(cid, {}).values())

    async def join(self, cid: int, ws: WebSocket, user_id: int) -> None:
        self.rooms[cid][ws] = user_id
        task = self.grace.pop((cid, user_id), None)
        if task:
            task.cancel()

    def leave(self, cid: int, ws: WebSocket) -> int | None:
        user_id = self.rooms.get(cid, {}).pop(ws, None)
        if cid in self.rooms and not self.rooms[cid]:
            del self.rooms[cid]
        return user_id

    async def broadcast(self, cid: int, payload: dict) -> None:
        for ws in list(self.rooms.get(cid, {})):
            try:
                await ws.send_json(payload)
            except Exception:  # noqa: BLE001 - a dead socket is simply dropped
                self.leave(cid, ws)

    # ---------------------------------------------------------- timers
    def schedule_end(self, cid: int, ends_at: datetime, on_change) -> None:
        """Finalise a live duel exactly when its clock runs out, then notify both players."""
        old = self.timers.pop(cid, None)
        if old:
            old.cancel()

        async def run():
            await asyncio.sleep(max(0.0, (ends_at - utcnow()).total_seconds()) + 0.05)
            with SessionLocal() as db:
                ch = db.get(Challenge, cid)
                if ch and engine.refresh(db, ch):
                    db.commit()
            await on_change(cid)

        self.timers[cid] = asyncio.get_running_loop().create_task(run())

    def schedule_grace(self, cid: int, user_id: int, on_change) -> None:
        """If a duel player stays disconnected for GRACE_S seconds, they forfeit."""
        async def run():
            await asyncio.sleep(engine.GRACE_S)
            if user_id in self.users_in(cid):
                return
            with SessionLocal() as db:
                ch = db.get(Challenge, cid)
                if ch and ch.status == "active" and ch.mode == "live":
                    other = ch.opponent_id if user_id == ch.creator_id else ch.creator_id
                    engine.finalize(ch, other, "forfeit", utcnow())
                    db.commit()
            await on_change(cid)

        key = (cid, user_id)
        if key in self.grace:
            self.grace[key].cancel()
        self.grace[key] = asyncio.get_running_loop().create_task(run())


hub = Hub()
