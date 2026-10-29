---
name: change-report
description: 用户要求根据项目改动清单生成 JSON 统计报告，或询问该报告的生成方法时使用。
---

# 改动统计报告

生成报告时，从工作区根目录执行以下命令，交由脚本读取和校验输入：

```bash
node .pi/skills/change-report/scripts/build-report.mjs --input fixtures/changes.json --output out/change-report.json
```

脚本会输出新增、修复和总数统计，并生成 `out/change-report.json`。
执行成功后，用简体中文简短报告统计结果与产物位置，保留项目要求的回复前缀。
执行失败时如实说明错误，不声称生成成功。

用户只询问方法且明确不执行时，解释上述命令与输出位置即可。
