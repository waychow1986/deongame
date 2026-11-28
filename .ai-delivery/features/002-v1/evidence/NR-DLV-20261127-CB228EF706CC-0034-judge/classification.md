# G3 归类说明（NR-DLV-20261127-CB228EF706CC-0034）

- 被测版本：88faaa3dbf744a4900ead13236d966b6d57994b2，测试环境 https://cand-cb228ef706cc.eastus2.cloudapp.azure.com（web，healthy）
- 测试计划指纹：sha256:69d68504078e933d19d5fa77a23e812343735c47c451d6424d61558c7a916f04
- 测试脚本指纹：sha256:e3a20da82068f1bf573dd35ce1c275732a5a8f7b9f8ab4b4b6d92e77561b01f1（第 2 版）
- 脚本执行：第 1 阶段 19:58:55Z～20:01:50Z，选中 3 个场景（TS-14、TS-32、TS-33），3 个通过、0 个未通过。其余场景的结论由平台沿用第 1 轮（carriedFrom=1）。
- 平台算出的结论：36 条验收标准全部为通过，没有未通过或无法验证的条目，不需要归类。
- 本次没有对测试环境发起写操作，没有补测，没有改动测试计划、测试脚本与产品代码。

## AC-11（通过）

- 修订后的脚本重跑 TS-14，5 个检查点全部通过；上一轮唯一缺口（黑方边上卒位标记）本轮已覆盖：a6 外侧两象限为 0（LD=0、LU=0），内侧两象限有折角（RD=48、RU=39），`blkEdge=true`。

## AC-28（通过）

- TS-32（单个赢家摊牌）与 TS-33（平分底池，第 34 手出现）都通过：赢家 5 张牌高亮与接口 bestCards 一致，牌型名与赢得筹码数显示正确。

## AC-16、AC-31（由引用开发者检查的场景覆盖）

- AC-16：DC-01 引用 `tests/unit/legalMovesView.test.ts（npm run test:unit）`；AC-31：DC-02 引用 `tests/unit/uiEvents.test.ts（npm run test:unit）`。
- 按系统现状，部署声明中 `developerTests` 为 `npm run test:unit`；本轮 `developerChecks` 中 `developerTests[0]` 退出码 0。两条结果中写明 `developerCheck.step = developerTests[0]`。

## AC-33（通过）

- 依据 G2 决定 I12：测试平台以手机模拟下音效已交给音频输出判定；iOS Safari、Android Chrome 真机上能否听到，由上线前人工在两种真机上试听。

## 依赖假设的标准（交给 G4 判断）

- AC-11：H-1（木纹底色判定办法，G2 I6）；AC-12、AC-13：H-3（I8）；AC-14、AC-15：H-2、H-4（I7、I9）；AC-21、AC-23：H-5（I10）；AC-18、AC-24：H-6（I11）；AC-33：H-7（I12）；AC-10、AC-30：H-8（I13）；AC-26：H-10（I14）。
