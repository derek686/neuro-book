import {randomUUID} from "node:crypto";
import {join} from "node:path";

export {doctor, installationStatus} from "#manager/installation-health";

import {withInstallLock} from "#manager/lock";
import {writeInstallationManifest} from "#manager/manifest-store";
import {backupRuntimeWrappers, commitOperation, createOperation, recoverInterruptedOperations, updateOperation} from "#manager/operation";
import {installationPaths} from "#manager/paths";
import {assertInstallationHostCompatible} from "#manager/platform";
import {parseInstallationManifest} from "#manager/schema";
import {assertManagerUpgrade, installManagerExecutable, installManagedBun, writeManagerWrapper, writeRuntimeWrapper} from "#manager/runtime";
import {installManagedTool, type ManagedToolName, writeManagedToolWrappers} from "#manager/tools";
import type {InstallationManifest, ManagedGitToolComponent, ManagedToolComponent} from "#manager/types";
import {MANAGER_VERSION} from "#manager/version-info";

/** 安装或更新托管 Bun，同时刷新 Manager/Application Runtime 与稳定 wrapper。 */
export async function maintainRuntime(root: string, manifest: InstallationManifest, managerExecutable: string, version?: string): Promise<InstallationManifest> {
    assertInstallationHostCompatible(manifest);
    const paths = installationPaths(root, manifest.profile === "windows-portable");
    return withInstallLock(join(paths.deploy, "install.lock"), async () => {
        await recoverInterruptedOperations(root);
        await assertManagerUpgrade(MANAGER_VERSION, manifest.managerVersion, manifest.components.manager.bundleSha256, managerExecutable);
        const createdPaths: string[] = [];
        const retiredPaths: string[] = [];
        let journal = await createOperation({id: randomUUID(), action: "update", root, containerEngine: manifest.containerEngine, createdPaths, retiredPaths, backupRoot: join(paths.backups, randomUUID()), previousManifest: manifest, nextManifest: null});
        try {
            const recordCreated = async (path: string): Promise<void> => {
                journal = await updateOperation(journal, journal.phase, {createdPaths: [...new Set([...journal.createdPaths, path])]});
            };
            const recordRetired = async (path: string): Promise<void> => {
                journal = await updateOperation(journal, journal.phase, {retiredPaths: [...new Set([...(journal.retiredPaths ?? []), path])]});
            };
            const runtime = await installManagedBun(root, {
                requestedVersion: version,
                trustedIdentity: manifest.components.managerRuntime.provider === "managed" ? manifest.components.managerRuntime : undefined,
                createdPaths,
                recordCreated,
                retiredPaths,
                recordRetired,
            });
            const manager = await installManagerExecutable(root, MANAGER_VERSION, managerExecutable, createdPaths, recordCreated);
            const next: InstallationManifest = {...manifest, managerVersion: MANAGER_VERSION, components: {...manifest.components, manager, managerRuntime: runtime, applicationRuntime: manifest.components.applicationRuntime.provider === "container" ? manifest.components.applicationRuntime : runtime}, updatedAt: new Date().toISOString()};
            parseInstallationManifest(next);
            journal = await updateOperation(journal, "validated", {createdPaths, retiredPaths, nextManifest: next});
            const wrapperBackup = await backupRuntimeWrappers(root, journal.backupRoot);
            journal = await updateOperation(journal, "healthy", {manager: {wrapperBackup, wrappersChanged: true}});
            await writeRuntimeWrapper(root, runtime);
            await writeManagedToolWrappers(root, next.components.tools);
            await writeManagerWrapper(root, manager, runtime);
            await writeInstallationManifest(paths.manifest, next);
            await commitOperation(journal);
            return next;
        } catch (error) {
            await recoverInterruptedOperations(root).catch(() => undefined);
            throw error;
        }
    });
}

/** 安装或更新托管工具，并更新固定 tools 组件。 */
export async function maintainTool(root: string, manifest: InstallationManifest, tool: ManagedToolName, managerExecutable: string): Promise<InstallationManifest> {
    assertInstallationHostCompatible(manifest);
    const paths = installationPaths(root, manifest.profile === "windows-portable");
    return withInstallLock(join(paths.deploy, "install.lock"), async () => {
        if (manifest.profile === "ghcr" || manifest.profile === "source-docker") {
            throw new Error("GHCR/Source Docker 的应用工具由容器提供，不在宿主管理。");
        }
        await recoverInterruptedOperations(root);
        await assertManagerUpgrade(MANAGER_VERSION, manifest.managerVersion, manifest.components.manager.bundleSha256, managerExecutable);
        const createdPaths: string[] = [];
        const retiredPaths: string[] = [];
        let journal = await createOperation({id: randomUUID(), action: "update", root, containerEngine: manifest.containerEngine, createdPaths, retiredPaths, backupRoot: join(paths.backups, randomUUID()), previousManifest: manifest, nextManifest: null});
        try {
            const recordCreated = async (path: string): Promise<void> => {
                journal = await updateOperation(journal, journal.phase, {createdPaths: [...new Set([...journal.createdPaths, path])]});
            };
            const recordRetired = async (path: string): Promise<void> => {
                journal = await updateOperation(journal, journal.phase, {retiredPaths: [...new Set([...(journal.retiredPaths ?? []), path])]});
            };
            let installed: ManagedToolComponent | ManagedGitToolComponent;
            const currentTool = manifest.components.tools[tool];
            const trustedIdentity = currentTool?.provider === "managed" ? currentTool : undefined;
            if (tool === "git") installed = await installManagedTool(root, "git", {trustedIdentity, createdPaths, recordCreated, retiredPaths, recordRetired});
            else installed = await installManagedTool(root, "rg", {trustedIdentity, createdPaths, recordCreated, retiredPaths, recordRetired});
            const manager = await installManagerExecutable(root, MANAGER_VERSION, managerExecutable, createdPaths, recordCreated);
            const next: InstallationManifest = {...manifest, managerVersion: MANAGER_VERSION, components: {...manifest.components, manager, tools: {...manifest.components.tools, [tool]: installed}}, updatedAt: new Date().toISOString()};
            parseInstallationManifest(next);
            journal = await updateOperation(journal, "validated", {createdPaths, retiredPaths, nextManifest: next});
            const wrapperBackup = await backupRuntimeWrappers(root, journal.backupRoot);
            journal = await updateOperation(journal, "healthy", {manager: {wrapperBackup, wrappersChanged: true}});
            if (next.components.managerRuntime.provider === "managed") await writeRuntimeWrapper(root, next.components.managerRuntime);
            await writeManagedToolWrappers(root, next.components.tools);
            await writeManagerWrapper(root, manager, next.components.managerRuntime);
            await writeInstallationManifest(paths.manifest, next);
            await commitOperation(journal);
            return next;
        } catch (error) {
            await recoverInterruptedOperations(root).catch(() => undefined);
            throw error;
        }
    });
}
