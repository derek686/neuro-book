import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {afterEach, describe, expect, it, vi} from "vitest";

const dockerMocks = vi.hoisted(() => ({resolveContainerEngine: vi.fn()}));

vi.mock("#manager/docker", () => ({resolveContainerEngine: dockerMocks.resolveContainerEngine}));
vi.mock("#manager/app-commands", () => ({commandStatus: vi.fn(async () => ({available: false, version: null}))}));
vi.mock("#manager/health", () => ({statePort: vi.fn(async () => 3000)}));

import {doctor} from "#manager/maintenance";
import type {InstallationManifest} from "#manager/types";

const roots: string[] = [];

afterEach(async () => {
    dockerMocks.resolveContainerEngine.mockReset();
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("doctor Container Engine合同", () => {
    it("原生Profile保持Manifest中的null且不重新探测", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-native-doctor-"));
        roots.push(root);
        const result = await doctor(root, nativeManifest()) as {containerEngine: string | null};

        expect(result.containerEngine).toBeNull();
        expect(dockerMocks.resolveContainerEngine).not.toHaveBeenCalled();
    });
});

function nativeManifest(): InstallationManifest {
    const revision = "a".repeat(40);
    const now = "2026-07-16T00:00:00.000Z";
    return {
        schemaVersion: 4,
        profile: "product-bun",
        containerEngine: null,
        managerVersion: "0.1.0-canary.14",
        appVersion: "0.8.0",
        channel: "canary",
        sourceRevision: revision,
        stateRoot: ".",
        components: {
            source: {provider: "release", version: "0.8.0", revision, path: ".", archiveSha256: "b".repeat(64), files: [], sourceUrl: "https://example.com/source.zip", license: "AGPL-3.0-only", redistribution: "test"},
            product: {provider: "release", version: "0.8.0", revision, path: ".output", archiveSha256: "c".repeat(64), platform: "windows-x64", sourceUrl: "https://example.com/product.zip", license: "AGPL-3.0-only", redistribution: "test"},
            manager: {provider: "managed", version: "0.1.0-canary.14", path: ".runtime/manager/0.1.0-canary.14/neuro-book.mjs", bundleSha256: "d".repeat(64)},
            managerRuntime: {provider: "system", version: "1.3.14", executable: "bun"},
            applicationRuntime: {provider: "system", version: "1.3.14", executable: "bun"},
            tools: {},
        },
        installedAt: now,
        updatedAt: now,
    };
}
