import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

import {describe, expect, it, vi} from "vitest";

const processMocks = vi.hoisted(() => ({
    run: vi.fn(async (_command: string, _args: string[]) => undefined),
}));

vi.mock("#manager/process", () => ({
    commandAvailable: vi.fn(),
    run: processMocks.run,
    runCapture: vi.fn(),
}));
vi.mock("#manager/tools", () => ({activateManagedTools: vi.fn()}));

import {createAdmin} from "#manager/app-commands";
import type {ContainerEngine, InstallationManifest} from "#manager/types";

describe("容器管理员命令", () => {
    it.each(["docker", "podman"] as const)("%s只使用持久化engine和公共Compose参数", async (engine) => {
        processMocks.run.mockClear();
        const root = join(tmpdir(), "neuro-book-container-admin");
        await createAdmin(root, containerManifest(engine), "admin");

        expect(processMocks.run).toHaveBeenCalledWith(engine, [
            "compose",
            "--env-file", join(resolve(root), ".env"),
            "-f", join(root, ".deploy", "docker-compose.generated.yml"),
            "exec", "app", "bun", ".output/server/scripts/cli/create-admin.ts", "admin",
        ], {cwd: root});
    });
});

function containerManifest(engine: ContainerEngine): InstallationManifest {
    const revision = "a".repeat(40);
    const now = "2026-07-16T00:00:00.000Z";
    return {
        schemaVersion: 4,
        profile: "source-docker",
        containerEngine: engine,
        managerVersion: "0.1.0-canary.14",
        appVersion: "0.8.0",
        channel: "canary",
        sourceRevision: revision,
        stateRoot: ".",
        components: {
            source: {provider: "git", version: "0.8.0", revision, path: ".", repository: "https://github.com/notnotype/neuro-book.git", branch: "master"},
            product: {provider: "container", version: "0.8.0", revision, image: "neuro-book-source:test"},
            manager: {provider: "managed", version: "0.1.0-canary.14", path: ".runtime/manager/0.1.0-canary.14/neuro-book.mjs", bundleSha256: "b".repeat(64)},
            managerRuntime: {provider: "system", version: "1.3.14", executable: "bun"},
            applicationRuntime: {provider: "container", version: "0.8.0"},
            tools: {
                rg: {provider: "container", version: "source-docker"},
                git: {provider: "container", version: "source-docker"},
                python: {provider: "container", version: "source-docker"},
            },
        },
        installedAt: now,
        updatedAt: now,
    };
}
