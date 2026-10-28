# 鍏憡琛ㄧ鐞?+ role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 鍦ㄨ繙绔?`app_config` 涓诲共涓婃柊澧?`announcements` 琛ㄤ笌绠＄悊鍛?CRUD锛屽叕寮€ list 浠嶈繑鍥?`{ notices, safetyTips }`銆?

**Architecture:** 杩佺Щ鍔?`users.role` + 鍏憡琛ㄥ苟瀵煎叆閰嶇疆涓殑 notices锛沗routes/announcements.js` 鎻愪緵鍏紑 list锛堣〃鎷?notices + config 璇?tips锛変笌 admin CRUD锛涘墠绔?Profile 鍏ュ彛 + 绠＄悊椤碉紱Home 濂戠害涓嶅彉銆?

**Tech Stack:** Hono Worker銆丏1銆丷eact 19銆丮UI銆丷eact Query

## Global Constraints

- 鍏紑濂戠害锛歚POST /api/announcements/list` 鈫?`{ notices: string[], safetyTips: [{ icon, text }] }`
- `safetyTips` 鍙 `app_config` / FALLBACK锛涚鐞嗛〉涓嶇 tips
- 琛ㄦ棤鍚敤琛屾椂 `notices` 鐢?`ANNOUNCEMENTS_FALLBACK.notices`
- 绠＄悊閴存潈锛氭瘡娆℃煡搴?`role === 'admin'`锛?01/403
- `content` 鈮?200锛涙椂闂存埑 INTEGER 姣
- **涓嶅仛** contact 鍔犲瘑銆乻afetyTips 绠＄悊銆乻tash 鏁村寘鎭㈠
- 楠岃瘉锛歚cd neighbor-help/worker && npm test`锛沗cd neighbor-help/frontend && npm run lint`
- 涓嶈嚜鍔?git commit锛堥櫎闈炵敤鎴锋槑纭姹傦級

---

## File map

| 鏂囦欢 | 鑱岃矗 |
|---|---|
| Create: `worker/migrations/0010_announcements_admin.sql` | role + 琛?+ 浠?app_config 瀵煎叆 notices |
| Modify: `worker/schema.sql` | 鍚屾蹇収 |
| Modify: `worker/src/response.js` | `CODE.FORBIDDEN = 403` |
| Modify: `worker/src/validate.js` + `test/validate.test.js` | `LIMITS.announcement = 200` |
| Modify: `worker/src/config.js` | 瀵煎嚭 FALLBACK锛涘彲閫?`getSafetyTips` |
| Create: `worker/src/routes/announcements.js` | 鍏紑 list + admin CRUD |
| Modify: `worker/src/routes/posts.js` | 鍒犻櫎鏃?list 璺敱锛沗me/get` 鍚?role |
| Modify: `worker/src/routes/auth.js` | 娉ㄥ唽 SELECT 鍚?role |
| Modify: `worker/src/index.js` | 鎸傝浇 announcements锛堝湪 messages/reports 鍓嶏級 |
| Modify: `worker/src/logger.js` | 鍏憡璺敱涓枃鎻忚堪 |
| Modify: `frontend/src/api.js` | admin 鍥涗釜鏂规硶 |
| Create: `frontend/src/pages/AnnouncementsManage.jsx` | 绠＄悊椤?|
| Modify: `frontend/src/App.jsx` / `Profile.jsx` | 璺敱涓庡叆鍙?|

---

### Task 1: 杩佺Щ 0010 + schema

**Files:**
- Create: `neighbor-help/worker/migrations/0010_announcements_admin.sql`
- Modify: `neighbor-help/worker/schema.sql`

**Interfaces:**
- Produces: `users.role`锛涜〃 `announcements`锛涘鍏ラ€昏緫瑙?SQL

- [x] **Step 1: 鍐欒縼绉?*

```sql
-- 0010_announcements_admin.sql 鈥斺€?鐢ㄦ埛瑙掕壊 + 婊氬姩鍏憡琛?浠?app_config.notices 瀵煎叆)
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_announcements_enabled_sort
  ON announcements(enabled, sort DESC, updated_at DESC);

UPDATE users SET role = 'admin' WHERE username = 'admin';

-- 浠?app_config 瀵煎叆 notices(浠呭綋鍏憡琛ㄤ负绌轰笖閰嶇疆瀛樺湪鏃?
-- D1/SQLite: json_each 灞曞紑鏁扮粍; id 鐢ㄥ浐瀹氬墠缂€+key 淇濊瘉鍙噸璺戝幓閲?
INSERT INTO announcements (id, content, sort, enabled, created_at, updated_at)
SELECT
  printf('seed-%03d', je.key),
  je.value,
  (1000 - CAST(je.key AS INTEGER)),
  1,
  1760000000000,
  1760000000000
FROM app_config ac, json_each(json_extract(ac.value, '$.notices')) AS je
WHERE ac.key = 'announcements'
  AND NOT EXISTS (SELECT 1 FROM announcements LIMIT 1);
```

鑻ユ湰鍦?`json_each` 琛屼负寮傚父锛氭敼涓虹‖缂栫爜鎻掑叆涓?FALLBACK 涓夋潯涓€鑷寸殑绉嶅瓙锛堜粛甯?`WHERE NOT EXISTS`锛夈€?

- [x] **Step 2: 鍚屾 schema.sql**锛坲sers.role + announcements 琛紱涓嶅惈 UPDATE/瀵煎叆锛?

- [x] **Step 3: 鏈湴 apply**

`cd neighbor-help/worker; npx wrangler d1 migrations apply neighbor-help-db`

Expected: `0010` applied锛沗SELECT role FROM users WHERE username='admin'` 鈫?`admin`锛沘nnouncements 鏈夎鎴栫┖锛堣瀵煎叆锛夈€?

---

### Task 2: LIMITS.announcement + 鍗曟祴

**Files:**
- Modify: `neighbor-help/worker/src/validate.js`
- Modify: `neighbor-help/worker/test/validate.test.js`

- [x] **Step 1:** 娴嬭瘯 `LIMITS.announcement === 200` 涓庤秴闀?`requireText` 澶辫触  
- [x] **Step 2:** `npm test -- test/validate.test.js` RED  
- [x] **Step 3:** 鍔犲叆 `announcement: 200`  
- [x] **Step 4:** 鍐嶈窇 GREEN  

---

### Task 3: FORBIDDEN + announcements 璺敱 + 鎸傝浇

**Files:**
- Modify: `neighbor-help/worker/src/response.js`锛坄FORBIDDEN: 403` + HTTP_STATUS锛?
- Modify: `neighbor-help/worker/src/config.js`锛堝鍑?`ANNOUNCEMENTS_FALLBACK` 鎴?`getSafetyTips(env)`锛?
- Create: `neighbor-help/worker/src/routes/announcements.js`
- Modify: `neighbor-help/worker/src/routes/posts.js`锛堝垹闄ゅ師 `/announcements/list` 涓庡浣?import锛?
- Modify: `neighbor-help/worker/src/index.js`
- Modify: `neighbor-help/worker/src/logger.js`锛堝叕寮€ + admin 浜旀潯鎻忚堪锛?

**Interfaces:**
- `requireAdmin(c)` 鈫?鏌ュ簱 role锛屽け璐ヨ繑鍥?`fail(CODE.FORBIDDEN, ...)`
- 鍏紑 list 缁勮锛歚{ notices, safetyTips }`
- Admin CRUD 鍚岃鏍?

- [x] **Step 1:** 鍔?`CODE.FORBIDDEN`  
- [x] **Step 2:** 瀹炵幇 `announcements.js`锛堝叕寮€ list锛氭煡鍚敤 content锛涚┖鍒?FALLBACK.notices锛泃ips 鐢ㄧ幇鏈?loadConfig/FALLBACK锛? 
- [x] **Step 3:** 浠?`posts.js` 绉婚櫎鏃?list  
- [x] **Step 4:** `app.route('/api', announcementRoutes)` 鏀惧湪 `messageRoutes`/`reportRoutes` **涔嬪墠**  
- [x] **Step 5:** curl 鍏紑 list 褰㈢姸姝ｇ‘锛涙湭鐧诲綍 admin/list 鈫?401  

---

### Task 4: 鐢ㄦ埛瀵硅薄杩斿洖 role

**Files:**
- Modify: `neighbor-help/worker/src/routes/posts.js` 鈥?`me/get` SELECT 鍔?`role`
- Modify: `neighbor-help/worker/src/routes/auth.js` 鈥?娉ㄥ唽鍚?SELECT 鍔?`role`锛坙ogin `SELECT *` 宸插甫锛?

- [x] **Step 1鈥?:** 鏀?SELECT  
- [x] **Step 3:** admin 鐧诲綍鍚?`me/get` 鈫?`data.role === 'admin'`  

---

### Task 5: 鍓嶇 api + 绠＄悊椤?+ 鍏ュ彛

**Files:**
- Modify: `neighbor-help/frontend/src/api.js`
- Create: `neighbor-help/frontend/src/pages/AnnouncementsManage.jsx`
- Modify: `neighbor-help/frontend/src/App.jsx`
- Modify: `neighbor-help/frontend/src/pages/Profile.jsx`

**Interfaces:**
- 淇濇寔 `getAnnouncements`
- 鏂板 `adminListAnnouncements` / `adminCreateAnnouncement` / `adminUpdateAnnouncement` / `adminDeleteAnnouncement`
- 绠＄悊椤碉細PageShell/BottomSheet/toast 椋庢牸瀵归綈 Profile锛沗maxLength: 200`锛涢潪 admin 鍗曟 toast + `/profile`

- [x] **Step 1:** api 鏂规硶  
- [x] **Step 2:** AnnouncementsManage 椤? 
- [x] **Step 3:** 璺敱 `/announcements/manage`锛圧equireAuth 鍐咃級  
- [x] **Step 4:** Profile 鑿滃崟 admin 鍏ュ彛  
- [x] **Step 5:** `npm run lint`  

---

### Task 6: 绔埌绔獙鏀?

- [x] 鍙屾湇鍔★紱`admin`/`admin123`锛堟垨鐜拌处鍙凤級鐧诲綍  
- [x] 绠＄悊椤靛 2 鏉′笉鍚?sort 鈫?棣栭〉婊氬姩椤哄簭姝ｇ‘  
- [x] 鍋滅敤涓€鏉?鈫?鍏紑 notices 鍙樺皯锛泃ips 浠嶅湪  
- [x] 闈?admin 鏃犲叆鍙ｏ紱鐩撮摼绠＄悊椤佃涪鍥烇紱API 403  
- [x] `npm test`锛沗npm run lint`  

---

## Spec coverage锛堣鍒掕嚜妫€锛?

| 瑙勬牸椤?| 浠诲姟 |
|---|---|
| role + 绉嶅瓙 admin | Task 1 |
| announcements 琛?+ 瀵煎叆 notices | Task 1 |
| 鍏紑 list 濂戠害 + FALLBACK | Task 3 |
| safetyTips 浠嶉厤缃?| Task 3 |
| admin CRUD + 鏌ュ簱閴存潈 | Task 3 |
| me/鐧诲綍 role | Task 4 |
| Home 灏戞敼 / 绠＄悊椤?/ Profile | Task 5 |
| 楠屾敹 1鈥? | Task 6 |
| contact 鍔犲瘑 | 鏄庣‘涓嶅湪璁″垝鍐?|
| FORBIDDEN 鐮?| Task 3锛堣鏍奸殣鍚?403锛?|

## 鏍稿缁撹

- **瑕嗙洊瀹屾暣**锛氳鏍肩洰鏍?楠屾敹鍧囨湁瀵瑰簲 Task锛涢潪鐩爣鏈贩鍏ャ€? 
- **椋庨櫓鐐瑰凡鍐欏叆璁″垝**锛歚json_each` 瀵煎叆澶辫触鏃剁殑纭紪鐮佺瀛愬悗澶囷紱鎸傝浇椤哄簭锛涗笉鑷姩 commit銆? 
- **涓庢棫 stash/鏃?0007 鏃犲叧**锛氳縼绉诲彿浠?`0010` 璧凤紝鎺ヨ繙绔?`0009`銆? 
- **寰呭疄鐜?*锛氭湰鏂囦欢浠呬负璁″垝锛屼唬鐮佸皻鏈敼锛堥櫎鏃㈡湁鏈彁浜?`CLAUDE.md`锛夈€?


