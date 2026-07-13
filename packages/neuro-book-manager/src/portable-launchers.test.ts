import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {portableLaunchers, writePortableLaunchers} from "#manager/portable-launchers";

const temporaryRoots: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Windows Portable Launcher", () => {
    it("六个入口都只委托Manager并显式传递Installation Root和退出码", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-portable-launchers-"));
        temporaryRoots.push(root);

        await writePortableLaunchers(root);

        const launchers = portableLaunchers();
        expect(launchers.map((launcher) => launcher.name)).toEqual([
            "Start Neuro Book.cmd",
            "Start Neuro Book.ps1",
            "Update Neuro Book.cmd",
            "Update Neuro Book.ps1",
            "Create Admin.cmd",
            "Create Admin.ps1",
        ]);
        for (const launcher of launchers) {
            const content = await readFile(join(root, launcher.name), "utf8");
            expect(content).toBe(launcher.content);
            expect(content).toContain("neuro-book.cmd");
            expect(content).toContain("--root");
            expect(content).not.toContain("Set-Location");
            if (launcher.name.endsWith(".cmd")) expect(content).toContain("exit /b %ERRORLEVEL%");
            else expect(content).toContain("exit $LASTEXITCODE");
        }
    });
});
