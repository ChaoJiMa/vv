# 数据库迁移

使用 Cloudflare D1 内置迁移机制管理表结构变更。D1 会维护 `d1_migrations` 表，
记录已应用的迁移,因此重复执行是安全的(已应用的不会再跑)。

## 约定

- 迁移文件放在本目录,命名 `NNNN_描述.sql`(四位编号,递增),如 `0002_add_likes.sql`
- 编号顺序即执行顺序,**只增不改**:已应用的迁移不要修改,新变更一律新建文件
- `../schema.sql` 保留为最新的完整建表快照(便于一眼看全结构),变更时同步更新

## 常用命令

```bash
# 查看待应用的迁移
npx wrangler d1 migrations list neighbor-help-db --remote

# 应用迁移(本地开发库去掉 --remote)
npx wrangler d1 migrations apply neighbor-help-db --remote

# 新建迁移(可选,也可手动创建文件)
npx wrangler d1 migrations create neighbor-help-db add_some_column
```

## 注意

生产库此前是用 `d1 execute --file=schema.sql` 手动建的,首次切换到迁移机制时,
`0001_init.sql` 全部用 `IF NOT EXISTS`,对已存在的表/索引无副作用,可安全 apply。
