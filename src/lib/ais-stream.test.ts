import { beforeEach, describe, expect, it } from "vitest";
import { aisShipTypeToCategory } from "./ais-ship-type";
import {
    getCachedVessels,
    ingestAisMessage,
    resetAisMaxCacheSizeForTests,
    setAisMaxCacheSizeForTests,
} from "./ais-stream";

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
        resetAisMaxCacheSizeForTests();
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

    it("keeps vessel type aligned with typeCache when cache cap evicts other MMSIs", () => {
        setAisMaxCacheSizeForTests(2);
        ingestAisMessage(stat(1, 80));
        ingestAisMessage(pos(1));
        ingestAisMessage(stat(2, 70));
        ingestAisMessage(pos(2));
        ingestAisMessage(pos(3));
        expect(getCachedVessels().find((v) => v.mmsi === 2)).toMatchObject({ type: "cargo" });
        ingestAisMessage(pos(2, 5, 6));
        expect(getCachedVessels().find((v) => v.mmsi === 2)).toMatchObject({
            type: "cargo",
            lat: 5,
            lon: 6,
        });
    });

    it("survives a pre-existing state object without typeCache (hot reload)", () => {
        (globalThis as { __aisState?: unknown }).__aisState = {
            vesselCache: new Map(), ws: null, reconnectTimeout: null, isConnecting: false, connectionStartTime: 0,
        };
        ingestAisMessage(stat(5, 30));
        ingestAisMessage(pos(5));
        expect(getCachedVessels()[0].type).toBe("fishing");
    });
});
