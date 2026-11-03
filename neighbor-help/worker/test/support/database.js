import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'

// 在真实 SQLite 上执行路由 SQL，保留 D1 的异步接口与查询计数。
export function createDatabase() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'))
  const queries = []
  const db = {
    sqlite,
    queries,
    prepare(sql) {
      let values = []
      return {
        bind(...args) { values = args; return this },
        async all() {
          queries.push(sql)
          return { results: sqlite.prepare(sql).all(...values) }
        },
        async first() {
          queries.push(sql)
          return sqlite.prepare(sql).get(...values) ?? null
        },
        async run() {
          queries.push(sql)
          if (/\bRETURNING\b/i.test(sql)) {
            const results = sqlite.prepare(sql).all(...values)
            return { results, meta: { changes: results.length } }
          }
          const result = sqlite.prepare(sql).run(...values)
          return { meta: { changes: Number(result.changes) } }
        },
      }
    },
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
  return db
}
