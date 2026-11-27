# G3 归类诊断（NR-DLV-20261127-3F66291309FB-0038）

依据：平台给出的脚本结果（scriptResults 第 1 阶段，15:28:42～15:32:59，测试脚本第 2 版，报告 46 个场景，通过 46，未通过 0）、平台记录的本轮开发者检查（developerChecks）、测试环境服务日志 `logs.jsonl`（status=ok，gaps=[]，871 行，没有 error 或异常记录）。没有对测试环境做写操作，也没有补测。

## 脚本场景

测试计划中由测试脚本验证的 46 个场景（TS-01～TS-47，TS-16 未使用）全部报告且全部通过，没有未报告的场景（包括带测试等待上限的 TS-22、TS-24、TS-36、TS-44、TS-47）。上一轮的测试脚本问题（TS-21、TS-32）与未报告的 TS-36 本轮均通过。

## 引用开发者检查的场景

平台算出 AC-6～AC-11、AC-13～AC-15 为无法验证，原因只是引用开发者检查的场景（DC-01～DC-08）尚未关联到本轮检查；这些标准的脚本场景全部通过。本轮构建执行的开发者检查：

| 检查 | step | 退出码 |
|---|---|---|
| `npm run test:unit` | developerTests[0] | 0 |
| `npm run test:integration` | integrationTests[0] | 0 |

| 场景 | 引用 | 对应 step | 覆盖标准 |
|---|---|---|---|
| DC-01 | developerTests | developerTests[0] | AC-6 |
| DC-02 | developerTests | developerTests[0] | AC-7、AC-14 |
| DC-03 | developerTests | developerTests[0] | AC-8、AC-9、AC-10 |
| DC-04 | developerTests | developerTests[0] | AC-11 |
| DC-05 | developerTests、integrationTests | developerTests[0]、integrationTests[0] | AC-13 |
| DC-06 | developerTests、integrationTests | developerTests[0]、integrationTests[0] | AC-13 |
| DC-07 | developerTests、integrationTests | developerTests[0]、integrationTests[0] | AC-14 |
| DC-08 | developerTests | developerTests[0] | AC-14、AC-15 |

结果中每条只能写一个 `developerCheck.step`，写 `developerTests[0]`；AC-13、AC-14 另引用的 `integrationTests[0]` 本轮同样执行并以退出码 0 通过，在该条 `note` 中写明。检查内容是否覆盖测试计划写明的范围，由代码审查核对（测试计划第 41 行）。

## 假设与测试缺口

测试计划声明没有依赖假设的场景；G2 没有按测试缺口处理的标准。
