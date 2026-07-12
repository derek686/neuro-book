# NeuroBook Manager

NeuroBook 的安装、更新、Runtime 与工具链管理器。

```bash
bunx --bun @notnotype/neuro-book-manager@canary install
```

不要使用 `bunx run @notnotype/neuro-book-manager`；`bunx run` 会把包名按本地脚本或路径解析，Manager 不会被启动。

公开命令为 `neuro-book`。应用源码、Product、Runtime、Toolchain、Deployment State 与用户状态使用独立组件合同。
