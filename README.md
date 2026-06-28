# PureHub Demo

面向投资人／合作方的简体中文博主会员平台互动 Demo。

## 启动

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:3000`。

## 推荐演示路径

1. 首页浏览推荐作品。
2. 打开会员限定作品并进入会员方案。
3. 使用演示卡号完成模拟订阅。
4. 前往 `/demo` 切换为博主。
5. 在工作台查看收入，并发布一篇新作品。
6. 在钱包页面测试提现验证。

## 说明

- 无真实后端、支付、KYC 或 Web3。
- 所有交互状态保存在 localStorage。
- `/demo` 可一键重置全部本地状态。
- 主视觉由 OpenAI 内置 imagegen 生成，项目内保存于 `public/purehub-hero.png`。
