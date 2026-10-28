/**
 * AIS Stream Manager
 * Connects to aisstream.io via native WebSocket and caches vessel positions.
 * Uses globalThis to survive Next.js hot-reloads in dev mode.
 */

import { aisShipTypeToCategory, type VesselCategory } from './ais-ship-type';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface AisState {
    vesselCache: Map<number, any>;
    typeCache: Map<number, VesselCategory>;
    ws: WebSocket | null;
    reconnectTimeout: ReturnType<typeof setTimeout> | null;
    isConnecting: boolean;
    connectionStartTime: number;
}

const MAX_CACHE = 50_000;
const MAX_AGE_MS = 60 * 60 * 1000;   // 1 hour
const TIMEOUT_MS = 60_000;           // 60s generous handshake window
const RECONNECT_MS = 5_000;

function getState(): AisState {
    const g = globalThis as any;
    if (!g.__aisState) {
        g.__aisState = {
            vesselCache: new Map(),
            typeCache: new Map(),
            ws: null,
            reconnectTimeout: null,
            isConnecting: false,
            connectionStartTime: 0,
        };
    }
    // State may predate typeCache across a dev hot-reload.
    g.__aisState.typeCache ||= new Map();
    return g.__aisState;
}

export function getCachedVessels(): any[] {
    return Array.from(getState().vesselCache.values());
}

function capCache(m: Map<number, unknown>): void {
    if (m.size > MAX_CACHE) {
        const k = m.keys().next().value;
        if (k !== undefined) m.delete(k);
    }
}

/** Apply one parsed aisstream.io message to the vessel cache. */
export function ingestAisMessage(msg: any): void {
    const s = getState();

    if (msg?.MessageType === 'ShipStaticData') {
        const sd = msg.Message?.ShipStaticData;
        if (!sd || typeof sd.UserID !== 'number') return;
        const type = aisShipTypeToCategory(sd.Type);
        s.typeCache.set(sd.UserID, type);
        capCache(s.typeCache);
        const v = s.vesselCache.get(sd.UserID);
        if (v) v.type = type;
        return;
    }

    if (msg?.MessageType !== 'PositionReport') return;

    const rpt = msg.Message.PositionReport;
    const meta = msg.MetaData;
    const mmsi: number = rpt.UserID;

    if (Math.abs(rpt.Latitude) > 90 || Math.abs(rpt.Longitude) > 180) return;

    s.vesselCache.set(mmsi, {
        mmsi,
        name: meta.ShipName?.trim() || `MMSI ${mmsi}`,
        type: s.typeCache.get(mmsi) ?? 'other',
        lat: rpt.Latitude,
        lon: rpt.Longitude,
        speed: rpt.Sog === 1023 ? 0 : rpt.Sog,
        heading: rpt.Cog === 3600 ? 0 : rpt.Cog,
        timestamp: meta.time_utc,
    });
    capCache(s.vesselCache);
}

export function startAisStream(): void {
    const s = getState();

    if (s.ws || s.isConnecting) {
        if (s.ws && Date.now() - s.connectionStartTime > MAX_AGE_MS) {
            console.log('[AIS] Stale connection, cycling…');
            s.ws.close();
        }
        return;
    }

    const apiKey = process.env.MARITIME_API_KEY;
    if (!apiKey) {
        console.warn('[AIS] MARITIME_API_KEY not set.');
        return;
    }

    s.isConnecting = true;
    console.log('[AIS] Connecting…');

    try {
        s.ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    } catch (e) {
        console.error('[AIS] Constructor failed:', e);
        s.isConnecting = false;
        scheduleReconnect();
        return;
    }

    const timer = setTimeout(() => {
        if (s.isConnecting && s.ws) {
            console.warn('[AIS] Timeout after 60 s, closing.');
            s.ws.close();
        }
    }, TIMEOUT_MS);

    s.ws.onopen = () => {
        clearTimeout(timer);
        s.isConnecting = false;
        s.connectionStartTime = Date.now();
        console.log('[AIS] Connected');

        s.ws?.send(JSON.stringify({
            APIKey: apiKey,
            BoundingBoxes: [[[-90, -180], [90, 180]]],
            FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
        }));
        console.log('[AIS] Subscribed to PositionReport + ShipStaticData');
    };

    s.ws.onmessage = async (event) => {
        try {
            // Native Node WebSocket returns Blob, not string
            const raw = event.data instanceof Blob
                ? await event.data.text()
                : String(event.data);
            ingestAisMessage(JSON.parse(raw));
        } catch { /* skip */ }
    };

    s.ws.onclose = () => {
        console.log('[AIS] Closed, reconnecting in 5 s…');
        s.ws = null;
        s.isConnecting = false;
        scheduleReconnect();
    };

    s.ws.onerror = () => { /* onclose fires next */ };
}

function scheduleReconnect(): void {
    const s = getState();
    if (s.reconnectTimeout) clearTimeout(s.reconnectTimeout);
    s.reconnectTimeout = setTimeout(startAisStream, RECONNECT_MS);
}
