import { beforeEach, describe, expect, it } from "vitest";
import { aisShipTypeToCategory } from "./ais-ship-type";
import { getCachedVessels, ingestAisMessage } from "./ais-stream";

const pos = (mmsi: number, lat = 1, lon = 2) => ({
    MessageType: "PositionReport",
    MetaData: { ShipName: " TEST SHIP ", time_utc: "2026-10-28 15:00:00.000000000 +0000 UTC" },
    Message: { PositionReport: { UserID: mmsi, Latitude: lat, Longitude: lon, Sog: 10, Cog: 90 } },
});
const stat = (mmsi: number, Type: unknown) => ({
    MessageType: "ShipStaticData",
    MetaData: { ShipName: "TEST SHIP" },
    Message: { ShipStaticData: { UserID: mmsi, Type } },
});

type AisTestState = {
    vesselCache: Map<number, unknown>;
    typeCache: Map<number, unknown>;
    pendingTypeCache: Map<number, unknown>;
};

function getAisTestState(): AisTestState {
    const s = (globalThis as { __aisState?: AisTestState }).__aisState;
    expect(s).toBeDefined();
    return s!;
}

function assertCacheKeysAligned(): void {
    const s = getAisTestState();
    const vesselKeys = [...s.vesselCache.keys()].sort((a, b) => a - b);
    const typeKeys = [...s.typeCache.keys()].sort((a, b) => a - b);
    expect(vesselKeys).toEqual(typeKeys);
}

describe("aisShipTypeToCategory", () => {
    it.each([
        [30, "fishing"],
        [31, "tug"],
        [32, "tug"],
        [52, "tug"],
        [35, "military"],
        [36, "sailing"],
        [60, "passenger"],
        [69, "passenger"],
        [70, "cargo"],
        [79, "cargo"],
        [80, "tanker"],
        [89, "tanker"],
        [0, "other"],
        [37, "other"],
        [55, "other"],
        [90, "other"],
        [99, "other"],
    ])("maps %i to %s", (code, cat) => {
        expect(aisShipTypeToCategory(code)).toBe(cat);
    });

    it.each([undefined, null, "70", 70.5, NaN])("treats %s as other", (code) => {
        expect(aisShipTypeToCategory(code)).toBe("other");
    });
});

describe("ingestAisMessage", () => {
    beforeEach(() => {
        delete (globalThis as { __aisState?: unknown }).__aisState;
    });

    it("defaults to other until static data arrives", () => {
        ingestAisMessage(pos(1));
        expect(getCachedVessels()[0]).toMatchObject({ mmsi: 1, type: "other", name: "TEST SHIP" });
    });

    it("updates an already-cached vessel when static data arrives", () => {
        ingestAisMessage(pos(1));
        ingestAisMessage(stat(1, 80));
        expect(getCachedVessels()[0].type).toBe("tanker");
    });

    it("keeps the type across later position reports", () => {
        ingestAisMessage(stat(2, 70));
        ingestAisMessage(pos(2));
        ingestAisMessage(pos(2, 3, 4));
        expect(getCachedVessels()).toHaveLength(1);
        expect(getCachedVessels()[0]).toMatchObject({ type: "cargo", lat: 3, lon: 4 });
    });

    it("does not create a vessel from static data alone", () => {
        ingestAisMessage(stat(3, 60));
        expect(getCachedVessels()).toHaveLength(0);
    });

    it("ignores out-of-range positions, malformed static data and other message types", () => {
        ingestAisMessage(pos(4, 91, 0));
        ingestAisMessage({ MessageType: "ShipStaticData", Message: {} });
        ingestAisMessage({ MessageType: "BaseStationReport", Message: {} });
        expect(getCachedVessels()).toHaveLength(0);
    });

    it("ignores PositionReport without PositionReport payload or UserID", () => {
        expect(() =>
            ingestAisMessage({ MessageType: "PositionReport", Message: {}, MetaData: {} }),
        ).not.toThrow();
        expect(() =>
            ingestAisMessage({
                MessageType: "PositionReport",
                Message: { PositionReport: { Latitude: 0, Longitude: 0 } },
                MetaData: {},
            }),
        ).not.toThrow();
        expect(getCachedVessels()).toHaveLength(0);
    });

    it("rejects non-finite lat/lon on PositionReport", () => {
        ingestAisMessage({
            MessageType: "PositionReport",
            MetaData: { ShipName: "X" },
            Message: { PositionReport: { UserID: 9, Latitude: NaN, Longitude: 0, Sog: 0, Cog: 0 } },
        });
        ingestAisMessage({
            MessageType: "PositionReport",
            MetaData: { ShipName: "X" },
            Message: { PositionReport: { UserID: 10, Latitude: 0, Longitude: Infinity, Sog: 0, Cog: 0 } },
        });
        expect(getCachedVessels()).toHaveLength(0);
    });

    it.each([
        ["position UserID 0", pos(0)],
        ["position negative MMSI", pos(-1)],
        ["position fractional MMSI", pos(1.5)],
        ["position string MMSI", {
            MessageType: "PositionReport",
            MetaData: { ShipName: "X" },
            Message: { PositionReport: { UserID: "70" as unknown as number, Latitude: 0, Longitude: 0, Sog: 0, Cog: 0 } },
        }],
        ["position Infinity MMSI", {
            MessageType: "PositionReport",
            MetaData: { ShipName: "X" },
            Message: { PositionReport: { UserID: Infinity, Latitude: 0, Longitude: 0, Sog: 0, Cog: 0 } },
        }],
        ["position huge integer MMSI", {
            MessageType: "PositionReport",
            MetaData: { ShipName: "X" },
            Message: { PositionReport: { UserID: 1_000_000_000, Latitude: 0, Longitude: 0, Sog: 0, Cog: 0 } },
        }],
        ["static UserID 0", stat(0, 70)],
        ["static negative MMSI", stat(-2, 70)],
        ["static string MMSI", {
            MessageType: "ShipStaticData",
            MetaData: {},
            Message: { ShipStaticData: { UserID: "70" as unknown as number, Type: 70 } },
        }],
        ["static Infinity MMSI", {
            MessageType: "ShipStaticData",
            MetaData: {},
            Message: { ShipStaticData: { UserID: Infinity, Type: 70 } },
        }],
        ["static huge integer MMSI", {
            MessageType: "ShipStaticData",
            MetaData: {},
            Message: { ShipStaticData: { UserID: 9_007_199_254_740_993, Type: 70 } },
        }],
    ])("rejects invalid MMSI: %s", (_label, msg) => {
        ingestAisMessage(msg);
        expect(getCachedVessels()).toHaveLength(0);
        assertCacheKeysAligned();
    });

    it("stores static-only types in pendingTypeCache, not typeCache", () => {
        ingestAisMessage(stat(99, 80));
        const s = getAisTestState();
        expect(s.typeCache.has(99)).toBe(false);
        expect(s.pendingTypeCache.get(99)).toBe("tanker");
        assertCacheKeysAligned();
        ingestAisMessage(pos(99));
        expect(getCachedVessels()[0]).toMatchObject({ mmsi: 99, type: "tanker" });
        expect(s.pendingTypeCache.has(99)).toBe(false);
        expect(s.typeCache.get(99)).toBe("tanker");
    });

    it("caps pendingTypeCache and evicts oldest static-only entries", () => {
        const opt = { maxCacheSize: 2 };
        for (let m = 1; m <= 4; m++) {
            ingestAisMessage(stat(m, 70), opt);
        }
        const s = getAisTestState();
        expect(s.pendingTypeCache.size).toBeLessThanOrEqual(2);
        expect([...s.pendingTypeCache.keys()]).toEqual([3, 4]);
        expect(s.typeCache.size).toBe(0);
        ingestAisMessage(pos(4), opt);
        expect(getCachedVessels()[0]).toMatchObject({ mmsi: 4, type: "cargo" });
        ingestAisMessage(pos(3), opt);
        expect(getCachedVessels().find((v) => v.mmsi === 3)).toMatchObject({ type: "cargo" });
    });

    it("regression: joint cap keeps vessel/type keys aligned through evictions", () => {
        const opt = { maxCacheSize: 2 };
        const types = [80, 70, 60, 70, 80] as const; // tanker, cargo, passenger, cargo, tanker
        const labels = ["tanker", "cargo", "passenger", "cargo", "tanker"] as const;

        for (let i = 0; i < 5; i++) {
            const mmsi = i + 1;
            ingestAisMessage(stat(mmsi, types[i]), opt);
            ingestAisMessage(pos(mmsi, mmsi, mmsi), opt);
            assertCacheKeysAligned();
            if (mmsi >= 3) {
                expect(getCachedVessels().find((v) => v.mmsi === mmsi)?.type).toBe(labels[i]);
            }
        }

        expect(getCachedVessels().map((v) => v.mmsi).sort()).toEqual([4, 5]);
        ingestAisMessage(pos(4, 40, 41), opt);
        ingestAisMessage(pos(5, 50, 51), opt);
        assertCacheKeysAligned();
        expect(getCachedVessels().find((v) => v.mmsi === 4)).toMatchObject({ type: "cargo", lat: 40, lon: 41 });
        expect(getCachedVessels().find((v) => v.mmsi === 5)).toMatchObject({ type: "tanker", lat: 50, lon: 51 });
    });

    it("survives a pre-existing state object without typeCache (hot reload)", () => {
        (globalThis as { __aisState?: unknown }).__aisState = {
            vesselCache: new Map(),
            typeCache: new Map(),
            pendingTypeCache: new Map(),
            ws: null,
            reconnectTimeout: null,
            isConnecting: false,
            connectionStartTime: 0,
        };
        ingestAisMessage(stat(5, 30));
        ingestAisMessage(pos(5));
        expect(getCachedVessels()[0].type).toBe("fishing");
    });
});
