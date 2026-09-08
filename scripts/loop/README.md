# scripts/loop — 本地手动宿主（A0 试跑期）

## 总目的（主人指令，2026-09-08）

> 之后的所有工作目的都是为了**优化 Loop**。每个任务（真实 issue、合成用例、
> 冒烟）都是打磨 Loop 的载体：验证 run 契约、暴露工具/skill/流程缺陷、
> 沉淀规则。任务完成只是副产品，Loop 变好才是验收。

据此，每轮试跑收尾时应自问：这轮暴露了什么 Loop 缺陷/改进点？→ 记入下方
清单或直接改本目录文件。

## 日常命令
```bash
pnpm loop start --issue <n>                 # 真实 issue 导入 + 领取（stage 缺省 triage）
pnpm loop start --task <n> [--stage <s>]    # 领取已存在任务（waiting-info 补全后重跑用这个）
pnpm loop start --new --title "..."         # 本地合成任务
pnpm loop checkpoint --run <r-xxx> --note "..."   # 过程记录
pnpm loop end --run <r-xxx> --outcome <o> [--comment ".."] [--label <name>] [--no-github]
pnpm loop summary | view                    # 摘要 / 任务列表
```

## 真实远程流程（主人期望，2026-09-08 定稿并实现）

处理真实 issue 时，`end` 收尾自动写 GitHub（`run.mjs` `syncGithub`）：

- **自动打 label**：outcome → 五角色标签（triaged→`ready-for-agent`，
  needs-info→`needs-info`，needs-triage/failed→`needs-triage`，
  pr-opened→`ready-for-human`；closed 可 `--label wontfix` 等）。
- **需人工确认的信息直接评论进 issue**：`end --comment "…正文…"` 评论
  issue；`outcome=closed` 时该正文作为关闭理由（`gh issue close --comment`）。
- 本地合成任务（无 url）自动跳过 GitHub 写；`--no-github` 强制跳过；
  gh 写失败仅 warn 不回滚本地状态。

## 完整闭环流程（主人定稿，2026-09-08）

> agent 修改完代码后**自己 review**，然后 commit、推送、开 PR；人工审核意见
> 在 PR 评论给出；需修改 → agent 自动继续修改；同意 → 人工合并。

落地步骤（feature/bugfix run 内，maker=agent）：

1. 修改 → `verify` skill 五门绿 → `review` skill（双评审，无第二 agent 时自检 + 人终审）
2. `git checkout -b loop/<issueNo>-<slug>` → commit（body 含 `Closes #<n>`）→ push
3. `gh pr create`（body 含 `Closes #<n>` + `loop-task: #<n>` + 需求/改动/验证）
4. `end --outcome pr-opened --pr <prNo>` → 自动打 `ready-for-human` + 记录 task.prs
5. 人工在 PR 评论给意见；request-changes → 领 `--task <n>` 续改 → commit/push
   （PR 自动更新）→ 循环；approve → 人工合并 → 评测链记 accepted

写边界（2026-09-08 升级）：**放开到 commit/push/开 PR + 打标/评论**；
合并 PR / npm 发布仍人工（认知守卫不变）。

- [x] D9 GitHub 重开的终态任务无法领取：本地 status=closed/rejected 时
      `start --task` 直接拒领，而 ops.md 触发映射要求 reopened → triage →
      `start --issue` 又会被 D3 防重拦下。现于领取时自动 `gh issue view` 校验：
      GitHub 侧 OPEN → 重置 ready + 清 decision + timeline 记 reopened 后放行；
      GitHub 侧仍关闭 → 维持拒领（回归：closed+gh=CLOSED 拒 / closed+gh=OPEN 放行）。
- [x] D6 `start` 输出指引偏弱：开场仪式要求读 AGENTS.md + ops.md + 对应 skill，
      但脚本没把这些路径打出来 → 应把三件套路径与 runId 一起打印。
- [x] D3 issue 补全后重跑：`start --issue` 遇已存在任务直接拒绝（正确防重），
      但提示未给替代路径 `start --task <n>` → 错误信息应带出指引。
- [x] D2 `end` 需手抄 runId；丢 runId 只能 view 找 → 支持 `--task <n>` 反查
      未收尾 run。
- [x] D5 `end` 的 outcome 与 stage 无耦合校验（bugfix 收 closed 语义存疑）→
      防呆可选。
- [x] D4 帮助/指引文本仍写 `node scripts/loop/run.mjs` 长命令，未提 `pnpm loop`。

全部于 2026-09-08 修复并回归（合成任务 + #27/#28 只读实测）。另修：
D8（syncGithub 打标前清理旧五角色标签，防 needs-info+ready-for-agent 叠加）。
新增：stage→outcome 白名单（STAGE_OUTCOMES，未知 stage 全放行）。

## 环境事实（A0 相关）
- 阶段（2026-09-08）：**手动执行期**——无自动触发，人发起每轮 run；
  agent 收到指令后按 ops.md + 对应 skill 执行（本会话=引擎）。每天可核对
  `state/SUMMARY.md` 与 `state/runs/`；每周做一次 sweep/retro 练习沉淀规则。

- 引擎 = 本会话（opencode omp）；gh 已认证（Alex1990, repo+workflow scope）。
- GitHub 直连不稳（曾超时）；代理 127.0.0.1:10809 未运行。
- open issue 现为 #28（PR #29 待审）；triage/feature 收尾自动写 GitHub。
- 写边界（闭环版，2026-09-08）：真实 issue 自动打标+评论+commit/push/开 PR；
  合并 PR 与 npm 发布仍人工。
