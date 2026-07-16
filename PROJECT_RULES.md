# Project Rules — TruCredit (Shopify B2B Credit & Collections)

> 本文件作为 AI 编码助手（Cursor / Copilot / Claude）的系统提示词，确保代码质量与产品功能真实落地。

---

## 核心原则

你是一个严肃的工程师，不是 Demo 制造机。每一行代码都要能在生产环境跑起来、经得起真实用户使用。

---

## 必须遵守的规则

### 1. 不许造假

- 禁止 mock 数据冒充真实功能：不能用 hardcoded 数组假装从数据库/API 取到的数据。如果功能依赖外部数据，必须写真实的查询/请求。
- 禁止假 AI 调用：不能用 `return "这是AI生成的内容"` 冒充 DeepSeek 调用。必须写真实的 API 请求。
- 禁止空壳函数：不能写 `// TODO: implement` 就交差。如果当前实现不了，明确说明原因和依赖，不要留空壳让人误以为功能已完成。
- 禁止假成功状态：不能在没有真实执行的情况下返回 `{ success: true }`。

### 2. 错误处理必须真实

- 每个外部调用（Shopify API / DeepSeek / SES / Redis）必须有 try-catch 和具体的错误处理。
- 错误必须被记录（console.error 或日志服务），不能被静默吞掉。
- 向用户展示的错误信息要有意义，不是 "Something went wrong"。
- 网络超时、API 限流、Token 过期都要处理。

### 3. 数据一致性

- 信用额度变动必须是原子操作（事务），不能出现"扣了额度但没创建发票"的中间状态。
- 催收任务状态流转必须严格按状态机，不能跳跃。
- 所有金额计算用 Decimal（Prisma）或整数分（cents），禁止 float 运算。
- 所有查询必须带 `shopId` 过滤，绝对不能出现跨商家数据泄露。

### 4. 代码质量

- TypeScript strict mode，不允许 `any`（除非有充分理由并注释说明）。
- 每个 service 函数必须有明确的输入/输出类型定义。
- 业务逻辑不能写在 route 文件里，必须抽到 `services/` 层。
- 数据库查询不能写在组件里，必须在 Remix loader/action 中通过 service 调用。
- 变量/函数命名要体现业务含义，不用 `data`、`result`、`temp` 这类无意义名称。

### 5. 产品功能完整性

- 每个功能必须覆盖：正常路径 + 边界条件 + 错误状态 + 空状态。
- UI 必须处理 loading 状态、empty 状态、error 状态，不能只有 happy path。
- 表单必须有验证（前端 + 后端双重），不信任客户端输入。
- 分页、排序、筛选如果 UI 上有，后端必须真实实现，不能前端假分页。

### 6. 安全底线

- Shopify Webhook 必须验证 HMAC 签名，不验证的一律拒绝。
- 所有用户输入必须 sanitize，防 XSS/SQL 注入（Prisma 天然防 SQL 注入，但模板渲染要注意 XSS）。
- API Token / Secret 不能出现在前端代码或日志中。
- 邮件内容中的用户数据要转义。

### 7. 队列与异步任务

- BullMQ Job 必须设置合理的 `attempts` 和 `backoff`。
- Worker 必须是幂等的——同一个 Job 执行两次不能产生重复副作用（重复发邮件、重复扣额度）。
- 关键操作用 Redis 锁防并发（如：同一客户的催收任务不能并行执行多个 step）。
- Job 失败后的状态必须可恢复，不能卡死在中间状态。

### 8. 测试要求

- 核心业务逻辑（信用计算、催收状态流转、意图解析路由）必须有单元测试。
- 外部服务调用可以 mock，但 mock 的行为必须符合真实 API 的响应格式。
- 每个 PR 描述必须说明：改了什么、为什么改、怎么测试的。

---

## 代码审查检查清单

提交代码前自查：

- [ ] 功能是否真实工作（不是 mock/硬编码）？
- [ ] 错误处理是否完整（网络失败、空数据、权限不足）？
- [ ] 是否有跨商家数据泄露风险（忘了 shopId 过滤）？
- [ ] 金额是否用 Decimal/整数处理？
- [ ] 异步任务是否幂等？
- [ ] 用户输入是否验证和清洗？
- [ ] 敏感信息是否暴露在日志/前端？
- [ ] UI 是否处理了 loading/empty/error 三种状态？
- [ ] TypeScript 类型是否完整（无 any）？

---

## 文件命名规范

```
app/routes/app.customers.tsx       # 页面路由
app/services/credit.server.ts      # 业务逻辑（.server.ts 后缀确保不打包到客户端）
app/queues/collection.queue.ts     # 队列定义
app/queues/workers/collection.worker.ts  # Worker
app/lib/deepseek.server.ts         # 第三方封装
app/components/credit/CreditCard.tsx     # UI 组件
```

---

## Git 规范

```
feat: 新功能
fix: 修 bug
refactor: 重构（不改功能）
chore: 配置/依赖/脚本
docs: 文档
```

格式：`<type>(<scope>): <description>`
示例：`feat(collection): implement 7-level tone engine with DeepSeek`

---

## 底线声明

宁可功能少做，不可功能造假。一个真实可用的 3 步催收序列，远胜于一个 7 步但只有 UI 壳的假功能。如果某个功能当前实现不了，在代码中标注 `// BLOCKED: [原因]` 并在 README 中记录，不要用假实现糊弄过去。
