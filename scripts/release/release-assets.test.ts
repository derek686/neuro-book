import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

import {afterEach, describe, expect, it} from "vitest";
import {parse} from "yaml";

import {currentProductPlatform, PRODUCT_ASSET_NAMES} from "nbook/packages/neuro-book-manager/src/platform";
import {PRODUCT_PLATFORMS} from "nbook/packages/neuro-book-manager/src/types";
import {runCapture} from "nbook/scripts/utils/process.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const roots: string[] = [];

type WorkflowStep = {
    name?: string;
    run?: string;
};

type WorkflowJob = {
    needs?: string | string[];
    steps: WorkflowStep[];
};

type ReleaseWorkflow = {
    jobs: {
        "verify-manager": WorkflowJob;
        "build-and-push": WorkflowJob;
        source: WorkflowJob;
        "product-linux": WorkflowJob;
        "product-linux-aarch64": WorkflowJob;
    };
};

type ProductWorkflow = {
    jobs: {
        product: WorkflowJob & {
            strategy: {
                matrix: {
                    include: Array<{platform: string; browser: string}>;
                };
            };
        };
    };
};

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Product Release宿主合同", () => {
    it("拒绝把当前.output包装成其他平台资产", async () => {
        const current = currentProductPlatform();
        const foreign = PRODUCT_PLATFORMS.find((platform) => platform !== current)!;
        const outputRoot = await mkdtemp(join(tmpdir(), "nbook-product-platform-"));
        roots.push(outputRoot);

        await expect(runCapture("bun", [
            "scripts/release/release-assets.ts",
            "product",
            "--platform", foreign,
            "--output", join(outputRoot, PRODUCT_ASSET_NAMES[foreign]),
        ], {cwd: ROOT})).rejects.toThrow(`当前宿主${current}不能包装${foreign}`);
    });

    it("在任何GHCR或资产构建前验证公开Manager bundle", async () => {
        const workflow = parse(await readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8")) as ReleaseWorkflow;
        expect(workflow.jobs["verify-manager"].steps).toContainEqual(
            expect.objectContaining({run: "bun run manager:verify-public"}),
        );
        expect(workflow.jobs["build-and-push"].needs).toBe("verify-manager");
        expect(workflow.jobs.source.needs).toBe("verify-manager");
        expect(workflow.jobs["product-linux"].needs).toBe("verify-manager");
        expect(workflow.jobs["product-linux-aarch64"].needs).toBe("source");
    });

    it("Linux AArch64 Product必须安装并执行真实浏览器smoke", async () => {
        const workflow = parse(await readFile(resolve(ROOT, ".github/workflows/product-platforms.yml"), "utf8")) as ProductWorkflow;
        const releaseWorkflow = parse(await readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8")) as ReleaseWorkflow;
        const linuxArm = workflow.jobs.product.strategy.matrix.include.find(({platform}) => platform === "linux-aarch64-glibc");
        expect(linuxArm?.browser).toBe("playwright");
        expect(workflow.jobs.product.steps).toContainEqual(
            expect.objectContaining({run: "bunx playwright-core install --with-deps chromium"}),
        );
        expect(releaseWorkflow.jobs["product-linux-aarch64"].steps).toContainEqual(
            expect.objectContaining({run: "bunx playwright-core install --with-deps chromium"}),
        );
        expect(releaseWorkflow.jobs["product-linux-aarch64"].steps.some(
            ({run}) => run?.includes("verify-posix-product.sh") && run.includes("playwright"),
        )).toBe(true);
    });
});
