import {join} from "node:path";

import {writeTextAtomic} from "#manager/files";

export type PortableLauncher = {
    name: string;
    content: string;
};

const actions = [
    {name: "Start Neuro Book", command: "start"},
    {name: "Update Neuro Book", command: "update"},
    {name: "Create Admin", command: "admin create"},
] as const;

/** 返回Windows Portable的薄启动壳；所有部署逻辑继续由Manager命令承担。 */
export function portableLaunchers(): PortableLauncher[] {
    return actions.flatMap(({name, command}) => [
        {
            name: `${name}.cmd`,
            content: `@echo off\r\ncall "%~dp0.runtime\\bin\\neuro-book.cmd" --root "%~dp0" ${command}\r\nexit /b %ERRORLEVEL%\r\n`,
        },
        {
            name: `${name}.ps1`,
            content: `& (Join-Path $PSScriptRoot ".runtime\\bin\\neuro-book.cmd") --root $PSScriptRoot ${command}\nexit $LASTEXITCODE\n`,
        },
    ]);
}

/** 原子写入Windows Portable入口文件。 */
export async function writePortableLaunchers(root: string): Promise<void> {
    for (const launcher of portableLaunchers()) {
        await writeTextAtomic(join(root, launcher.name), launcher.content);
    }
}
