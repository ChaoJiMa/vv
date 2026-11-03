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

# 应用迁移(本地开发库使用 --local)
npx wrangler d1 migrations apply neighbor-help-db --remote

# 新建迁移(可选,也可手动创建文件)
npx wrangler d1 migrations create neighbor-help-db add_some_column
```

## 注意

新建的空数据库可以按顺序应用全部迁移。已有数据库升级前先检查待应用列表，确认与已部署结构一致。

旧生产库曾用 `d1 execute --file=schema.sql` 手动建表，没有完整迁移记录。虽然 `0001_init.sql` 使用 `IF NOT EXISTS`，历史 `0002_uuid_ms.sql` 会 `DROP` 用户、帖子和评论表，不能因此认为整个迁移链都可安全重跑。若已有业务数据且待应用列表仍包含 `0001`/`0002`，不要直接执行完整的 `migrations apply`。

本次升级要求已有结构包含 `0013` 的功能。对于上述手动建库环境，仅应用新增的图片删除声明表，再部署新 Worker：

```bash
npx wrangler d1 execute neighbor-help-db --remote --file=migrations/0014_image_deletions.sql
npx wrangler d1 execute neighbor-help-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name='image_deletions'"
npx wrangler deploy
```

`0014` 使用 `CREATE TABLE IF NOT EXISTS`，可重复执行；该方式不补写历史迁移记录，后续升级仍需按实际结构选择增量文件。已有正常迁移记录并已应用到 `0013` 的环境，按常规 `migrations list` / `migrations apply` 应用 `0014` 即可。
