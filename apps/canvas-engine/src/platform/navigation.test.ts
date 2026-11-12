import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("./rpc", () => ({ platformRequest: request }));

import { openPlatformAction, platformActionForPath } from "./navigation";

beforeEach(() => request.mockReset());

describe("embedded canvas navigation", () => {
    it("distinguishes the host home from the project picker and current canvas", () => {
        expect(platformActionForPath("/", "project-one")).toBe("home");
        expect(platformActionForPath("/canvas/", "project-one")).toBe("projects");
        expect(platformActionForPath("/canvas/project-one", "project-one")).toBeNull();
        expect(platformActionForPath("/canvas/project-two", "project-one")).toBe("projects");
    });

    it("maps built-in destinations to host panels without forwarding arbitrary paths", () => {
        expect(platformActionForPath("/skills", "project-one")).toBe("skills");
        expect(platformActionForPath("/pool", "project-one")).toBe("pool");
        expect(platformActionForPath("/config", "project-one")).toBe("settings");
        expect(platformActionForPath("/settings", "project-one")).toBe("settings");
        expect(platformActionForPath("https://example.invalid/", "project-one")).toBe("projects");
    });

    it("keeps nested and foreign project routes inside the host project picker", () => {
        expect(platformActionForPath("/canvas/project-one/settings", "project-one")).toBe("projects");
        expect(platformActionForPath("/canvas/project%2Fone", "project-one")).toBe("projects");
        expect(platformActionForPath("/pool/other", "project-one")).toBe("projects");
    });

    it("requests the host home action and propagates a failure to the caller", async () => {
        request.mockResolvedValueOnce({ ok: true });
        await openPlatformAction("home");
        expect(request).toHaveBeenCalledWith("platform.action", { action: "home" });
        request.mockRejectedValueOnce(new Error("项目已切换"));
        await expect(openPlatformAction("skills")).rejects.toThrow("项目已切换");
    });
});
